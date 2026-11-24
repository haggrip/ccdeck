// A session reads by the title Claude gave it (owner, 2026-11-24).
//
// Claude Desktop titles each of its sessions ("Splunk IP", "Acme Netskope PR
// resurrection") and writes that title into the session's transcript as a
// `custom-title` line beside an `agent-name` one; Claude Code adds `ai-title`
// and `/rename`'s `custom-title`. The deck reads those already. What it lacked:
//
//   - THE ORDER. A session Claude never titled (a CLI session the deck runs in
//     tmux writes no title line) read by its folder, "saas-platform" over
//     "saas-platform", although the goal titler had a title for its group. The
//     order is now: the name typed in the deck, Claude's name, Claude's title,
//     the group's title (typed, then the goal titler's), the folder — on the
//     page (sessionListName) and in GET /api/sessions alike.
//   - A RENAME BETWEEN HOOK EVENTS. A title line fires no hook, so a resting
//     session renamed in Claude Desktop kept its old name until its next tool
//     call. The output watch, which reads new transcript bytes between hook
//     events, now has the cursor fold a naming line it sees and says it.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rmTempDir } from "./rm-temp-dir";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionListName } from "../session-display";
import { sessionNames } from "../rail-row-copy";
import type { AgentNodeData } from "../types";

const DIR = mkdtempSync(join(tmpdir(), "ccdeck-claude-titles-"));
const prevEnv = { ...process.env };
process.env.HOME = DIR;
process.env.USERPROFILE = DIR;
process.env.CLAUDE_CONFIG_DIR = join(DIR, "claude");
process.env.CODEX_HOME = join(DIR, "codex");

// @ts-expect-error — .mjs server module, no types
const { hookToken, startServer } = await import("../../server/index.mjs");
// @ts-expect-error — .mjs server module, no types
const { tailNamesSession } = await import("../../server/session-enrichment.mjs");
// @ts-expect-error — .mjs server module, no types
const { summarizeSessions } = await import("../../server/session-summary.mjs");

const PROJECTS = join(DIR, "claude", "projects", "-tmp-claude-titles");
const SID = "4d7c7265-b274-41dc-92d7-6b331aa94ec9";
const TRANSCRIPT = join(PROJECTS, `${SID}.jsonl`);

let server: Server;
let port = 0;
let token = "";

beforeAll(async () => {
  mkdirSync(PROJECTS, { recursive: true });
  // What Claude Desktop writes when it titles a session: the pair, by the
  // session's id.
  writeFileSync(TRANSCRIPT, [
    JSON.stringify({ type: "user", message: { role: "user", content: "look at the splunk ip" }, sessionId: SID }),
    JSON.stringify({ type: "custom-title", customTitle: "Splunk IP", sessionId: SID }),
    JSON.stringify({ type: "agent-name", agentName: "Splunk IP", sessionId: SID }),
  ].join("\n") + "\n");
  const started = await startServer({ port: 0, workspace: "", codex: false });
  server = started.server ?? started;
  token = hookToken();
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>(done => server.close(() => done()));
  for (const k of ["HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR", "CODEX_HOME"]) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
  rmTempDir(DIR);
});

function post(path: string, body: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      { host: "127.0.0.1", port, path, method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } },
      res => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); },
    );
    req.on("error", reject);
    req.end(data);
  });
}

type Envelope = { payload: { hook_event_name?: string; session_id?: string; sessionName?: string | null } };
function events(): Promise<Envelope[]> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/api/events", method: "GET", headers: { "x-ccdeck-token": token } }, res => {
      let raw = "";
      res.setEncoding("utf8").on("data", c => { raw += c; });
      res.on("end", () => { try { const v = JSON.parse(raw); resolve(v.events ?? v); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.end();
  });
}

const namesSaid = async () => (await events())
  .filter(e => e.payload?.hook_event_name === "SessionNamed" && e.payload?.session_id === SID && e.payload.sessionName)
  .map(e => e.payload.sessionName);

async function until(check: () => Promise<boolean>, ms: number, what: string) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`never: ${what}`);
}

describe("a rename Claude writes between hook events", () => {
  it("reaches the page without waiting for the session's next hook", async () => {
    // One hook event: the deck learns the transcript and says the name.
    expect(await post("/api/event", { hook_event_name: "Stop", session_id: SID, cwd: DIR, transcript_path: TRANSCRIPT })).toBe(200);
    await until(async () => (await namesSaid()).includes("Splunk IP"), 5_000, "the first name");
    // The watch starts a newly heard transcript at its end (output-watch.mjs
    // `note`), on its first tick: let that tick pass, as any real rename does.
    await new Promise(r => setTimeout(r, 2_500));
    // Renamed in Claude Desktop while the session rests: two lines appended,
    // and no hook at all.
    appendFileSync(TRANSCRIPT, [
      JSON.stringify({ type: "custom-title", customTitle: "Splunk IP allowlist", sessionId: SID }),
      JSON.stringify({ type: "agent-name", agentName: "Splunk IP allowlist", sessionId: SID }),
    ].join("\n") + "\n");
    await until(async () => (await namesSaid()).includes("Splunk IP allowlist"), 8_000, "the new name, off the output watch");
    // Said once: the change gate holds for the watch's path as for the hook's.
    expect((await namesSaid()).filter(n => n === "Splunk IP allowlist")).toHaveLength(1);
  }, 15_000);

  it("knows a naming line in a tail, and nothing else for one", () => {
    expect(tailNamesSession('{"type":"custom-title","customTitle":"x"}\n')).toBe(true);
    expect(tailNamesSession('{"type":"ai-title","aiTitle":"x"}\n')).toBe(true);
    expect(tailNamesSession('{"type":"agent-name","agentName":"x"}\n')).toBe(true);
    expect(tailNamesSession('{"type":"assistant","message":{"content":"custom title"}}\n')).toBe(false);
    expect(tailNamesSession("")).toBe(false);
  });
});

describe("what a session is called", () => {
  const base = { label: "saas-platform", cwdBasename: "saas-platform" };

  it("is the name typed in the deck, then Claude's name, then its title, then the group's, then the folder", () => {
    // `sessionName` already holds the typed name over Claude's (applySessionNamed).
    expect(sessionListName({ ...base, sessionName: "mine", sessionTitle: "Claude's sentence", goalTitle: "Fix retry middleware" })).toBe("mine");
    expect(sessionListName({ ...base, sessionTitle: "Claude's sentence", goalTitle: "Fix retry middleware" })).toBe("Claude's sentence");
    expect(sessionListName({ ...base, groupName: "typed over the group", goalTitle: "Fix retry middleware" })).toBe("typed over the group");
    expect(sessionListName({ ...base, goalTitle: "Fix retry middleware" })).toBe("Fix retry middleware");
    expect(sessionListName({ ...base, goalTitle: "   " })).toBe("saas-platform");
    expect(sessionListName(base)).toBe("saas-platform");
  });

  it("keeps the folder on the second line when the row reads by the goal title", () => {
    const a = { ...base, goalTitle: "Fix retry middleware", prompts: [], firstPrompt: "DIS-25027 - A figma SSPM modal bug" } as unknown as AgentNodeData;
    expect(sessionNames(a)).toEqual({ title: "Fix retry middleware", folder: "saas-platform", task: "DIS-25027 - A figma SSPM modal bug" });
  });

  it("is the same order in GET /api/sessions, and clearing a name brings the next one back", () => {
    const at = 1_000;
    const ev = (payload: Record<string, unknown>, i: number) => ({ receivedAt: at + i, payload: { session_id: "s", ...payload } });
    const list = (extra: Record<string, unknown>[]) => summarizeSessions([
      ev({ hook_event_name: "SessionStart", cwd: "/w/saas-platform" }, 0),
      ...extra.map((p, i) => ev(p, i + 1)),
    ], { now: at + 100 })[0].name;
    expect(list([{ hook_event_name: "SessionNamed", goalTitle: "Fix retry middleware" }])).toBe("Fix retry middleware");
    expect(list([
      { hook_event_name: "SessionNamed", goalTitle: "Fix retry middleware" },
      { hook_event_name: "SessionNamed", sessionName: "Splunk IP", sessionTitle: null },
    ])).toBe("Splunk IP");
    expect(list([
      { hook_event_name: "SessionNamed", sessionName: "Splunk IP", sessionTitle: null },
      { hook_event_name: "SessionNamed", deckName: "mine" },
    ])).toBe("mine");
    expect(list([
      { hook_event_name: "SessionNamed", sessionName: "Splunk IP", sessionTitle: null },
      { hook_event_name: "SessionNamed", deckName: "mine" },
      { hook_event_name: "SessionNamed", deckName: null },
    ])).toBe("Splunk IP");
  });
});
