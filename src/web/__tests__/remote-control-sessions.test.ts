// The person's Remote Control sessions on their other machines
// (remote-control-sessions.mjs), read over ssh with one fixed, read-only
// script, and drawn as links out to claude.ai. The script itself runs here
// under /bin/sh against a fake `claude` and a fake projects folder, so the
// shell quoting is exercised for real.
import { describe, expect, it, afterAll } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTempDir } from "./rm-temp-dir";
import { remoteRows } from "../components/RemoteControlList";

// @ts-expect-error — .mjs server module, no types
const rc = await import("../../server/remote-control-sessions.mjs");
const {
  REMOTE_SCRIPT, createRemoteControl, parseRemoteListing, remoteControlVetoed, remoteHosts, sessionUrl, sshArgs,
} = rc;

const ROOT = mkdtempSync(join(tmpdir(), "ccdeck-remote-control-"));
afterAll(() => rmTempDir(ROOT));

const CSE_A = "017qTQaqZeJyUajDPq4EXcHs";
const CSE_B = "017qTQasRKovGctU1BmLGauh";
const CSE_C = "017qTQapXy4o8s8LLfZfNfMD";
const AGENTS = [
  { sessionId: "9b13d2c9-4e9b-50a1-8c47-3f0fb01f8c70", name: "ITDR refactor", status: "idle", kind: "interactive", startedAt: 3, cwd: `/home/h/saas-platform/.claude/worktrees/bridge-cse_${CSE_A}` },
  { sessionId: "1b13d2c9-4e9b-50a1-8c47-3f0fb01f8c71", name: `bridge-cse-${CSE_B.toLowerCase()}-86`, status: "busy", kind: "interactive", startedAt: 5, cwd: `/home/h/saas-platform/.claude/worktrees/bridge-cse_${CSE_B}` },
  { sessionId: "2b13d2c9-4e9b-50a1-8c47-3f0fb01f8c72", name: `bridge-cse-${CSE_C.toLowerCase()}-25`, status: "idle", kind: "interactive", startedAt: 1, cwd: `/home/h/saas-platform/.claude/worktrees/bridge-cse_${CSE_C}` },
  // A terminal someone opened there: not Remote Control's, left out.
  { sessionId: "3b13d2c9-4e9b-50a1-8c47-3f0fb01f8c73", name: "local", status: "idle", kind: "interactive", startedAt: 9, cwd: "/home/h/saas-platform" },
];

/** A machine as the script finds it: a `claude` that prints AGENTS, and the
 *  transcripts in folders named after the cloud ids. */
function fakeMachine() {
  const home = join(ROOT, `home-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const claude = join(home, ".local", "bin", "claude");
  writeFileSync(join(home, "agents.json"), JSON.stringify(AGENTS));
  writeFileSync(claude, `#!/bin/sh\n[ "$1 $2" = "agents --json" ] && cat "$HOME/agents.json"\n`);
  chmodSync(claude, 0o755);
  const project = (cse: string) => {
    const d = join(home, ".claude", "projects", `-home-h-saas-platform--claude-worktrees-bridge-cse-${cse}`);
    mkdirSync(d, { recursive: true });
    return d;
  };
  // A: a Claude title, renamed once — the newest wins.
  writeFileSync(join(project(CSE_A), "f1.jsonl"), [
    JSON.stringify({ type: "user", message: { role: "user", content: "refactor the ITDR code" } }),
    JSON.stringify({ type: "custom-title", customTitle: "ITDR" }),
    JSON.stringify({ type: "custom-title", customTitle: "ITDR refactor" }),
  ].join("\n") + "\n");
  // B: no title line — its first prompt, a link with a key in its query string.
  writeFileSync(join(project(CSE_B), "f2.jsonl"), [
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "https://claude.ai/artifact/QZCh?sk=secret-key look at this" }] } }),
    JSON.stringify({ type: "assistant", message: { content: "ok" } }),
  ].join("\n") + "\n");
  // C: no transcript at all.
  return home;
}

function runScript(home: string) {
  return execFileSync("/bin/sh", ["-c", REMOTE_SCRIPT], { env: { HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8" });
}

describe("which machines, and whether to ask at all", () => {
  it("takes ssh aliases from AGENTS_DECK_REMOTE_CONTROL_HOSTS and drops anything ssh could read as more", () => {
    expect(remoteHosts({ AGENTS_DECK_REMOTE_CONTROL_HOSTS: "hagai-thinkpad-p14s, me@box.lan  box2" })).toEqual(["hagai-thinkpad-p14s", "me@box.lan", "box2"]);
    expect(remoteHosts({ AGENTS_DECK_REMOTE_CONTROL_HOSTS: "-oProxyCommand=evil,a;b,$(x),ok" })).toEqual(["ok"]);
    expect(remoteHosts({})).toEqual([]);
  });

  it("is off under AGENTS_DECK_NO_REMOTE_CONTROL=1 or AGENTS_DECK_NO_AGENT=1, and asks no machine", async () => {
    expect(remoteControlVetoed({ AGENTS_DECK_NO_REMOTE_CONTROL: "1" })).toBe(true);
    expect(remoteControlVetoed({ AGENTS_DECK_NO_AGENT: "1" })).toBe(true);
    let asked = 0;
    const off = createRemoteControl({ env: { AGENTS_DECK_NO_REMOTE_CONTROL: "1", AGENTS_DECK_REMOTE_CONTROL_HOSTS: "box" }, run: async () => { asked++; return { ok: true, stdout: "[]" }; } });
    expect(await off.state()).toEqual({ vetoed: true, hosts: [], listedAt: null });
    expect(asked).toBe(0);
  });

  it("never lets ssh prompt, and puts the host after --, with the fixed script last", () => {
    const args: string[] = sshArgs("box");
    expect(args).toContain("BatchMode=yes");
    expect(args.indexOf("--")).toBe(args.indexOf("box") - 1);
    expect(args.at(-1)).toBe(REMOTE_SCRIPT);
  });
});

describe("what one machine says", () => {
  it("lists its Remote Control sessions with titles, state and claude.ai links, from the real script", () => {
    const sessions = parseRemoteListing(runScript(fakeMachine()));
    expect(sessions).toEqual([
      { id: CSE_B, title: "https://claude.ai/artifact/QZCh look at this", status: "busy", startedAt: 5, url: `https://claude.ai/code/session_${CSE_B}` },
      { id: CSE_A, title: "ITDR refactor", status: "idle", startedAt: 3, url: `https://claude.ai/code/session_${CSE_A}` },
      { id: CSE_C, title: "", status: "idle", startedAt: 1, url: `https://claude.ai/code/session_${CSE_C}` },
    ]);
    expect(JSON.stringify(sessions)).not.toContain("secret-key");
  });

  it("opens a session by Claude Code's own rule: cse_X is session_X", () => {
    expect(sessionUrl(CSE_A)).toBe(`https://claude.ai/code/session_${CSE_A}`);
  });

  it("cuts a long first prompt, skips a command for a title, and says null for an answer that is not a listing", () => {
    const long = "word ".repeat(40);
    const out = `${JSON.stringify([AGENTS[1]])}\n@@ccdeck-titles@@\n${CSE_B}\tprompt\t${JSON.stringify({ type: "user", message: { content: long } })}\n`;
    const [s] = parseRemoteListing(out);
    expect(s.title.length).toBe(60);
    expect(s.title.endsWith("…")).toBe(true);
    const cmd = `${JSON.stringify([AGENTS[1]])}\n@@ccdeck-titles@@\n${CSE_B}\tprompt\t${JSON.stringify({ type: "user", message: { content: "<command-name>/clear</command-name>" } })}\n`;
    expect(parseRemoteListing(cmd)[0].title).toBe("");
    expect(parseRemoteListing("bash: claude: command not found")).toBeNull();
  });
});

describe("asking", () => {
  const ok = { ok: true, stdout: `${JSON.stringify([AGENTS[0]])}\n@@ccdeck-titles@@\n` };

  it("asks each machine once per 30 s, and a second ask while one runs shares it", async () => {
    let calls = 0, t = 0;
    const r = createRemoteControl({ env: { AGENTS_DECK_REMOTE_CONTROL_HOSTS: "a b" }, now: () => t, run: async () => { calls++; return ok; } });
    const [x, y] = await Promise.all([r.state(), r.state()]);
    expect(calls).toBe(2);
    expect(x).toEqual(y);
    expect(x.hosts.map((h: { host: string }) => h.host)).toEqual(["a", "b"]);
    t = 29_000; await r.state(); expect(calls).toBe(2);
    t = 31_000; await r.state(); expect(calls).toBe(4);
  });

  it("says why a machine could not be read in its own words, never ssh's", async () => {
    const answers: Record<string, object> = {
      gone: { ok: false, code: "ENOENT", stderr: "" },
      slow: { ok: false, timedOut: true, stderr: "" },
      locked: { ok: false, stderr: "hagai@box: Permission denied (publickey) /home/hagai/.ssh/id_ed25519" },
      off: { ok: false, stderr: "ssh: connect to host box port 22: Connection refused" },
      odd: { ok: true, stdout: "not json" },
    };
    const r = createRemoteControl({ env: { AGENTS_DECK_REMOTE_CONTROL_HOSTS: Object.keys(answers).join(",") }, run: async (_: string, args: string[]) => answers[args[args.indexOf("--") + 1]] });
    const s = await r.state();
    expect(s.hosts.map((h: { host: string; reason: string }) => [h.host, h.reason])).toEqual([
      ["gone", "ssh_missing"], ["slow", "timeout"], ["locked", "ssh_refused"], ["off", "unreachable"], ["odd", "bad_answer"],
    ]);
    expect(JSON.stringify(s)).not.toContain(".ssh");
  });
});

describe("the route and the page", () => {
  const server = (p: string) => readFileSync(new URL(`../../server/${p}`, import.meta.url), "utf8");

  it("is a guarded read, this computer only, and its switches travel with the login item and the desktop shell", () => {
    expect(server("request-gates.mjs")).toContain('"/api/remote-control"');
    expect(server("index.mjs")).toMatch(/GET".*\/api\/remote-control".*handleRemoteControlRead/);
    expect(server("remote-control-routes.mjs")).toMatch(/loopback\(req\)/);
    for (const v of ["AGENTS_DECK_NO_REMOTE_CONTROL", "AGENTS_DECK_REMOTE_CONTROL_HOSTS"]) {
      expect(server("login-service.mjs")).toContain(`"${v}"`);
      expect(readFileSync(new URL("../../../desktop/deck-host.mjs", import.meta.url), "utf8")).toContain(`"${v}"`);
      expect(readFileSync(new URL("../../../README.md", import.meta.url), "utf8")).toContain(v);
    }
  });

  it("draws only claude.ai links, notes a machine it could not read, and nothing while off", () => {
    const rows = remoteRows({ ok: true, hosts: [
      { host: "pad", ok: true, sessions: [
        { id: "a", title: "A", status: "idle", startedAt: 1, url: "https://claude.ai/code/session_abc" },
        { id: "b", title: "B", status: "idle", startedAt: 1, url: "https://evil.example/code/session_abc" },
      ] },
      { host: "box", ok: false, reason: "unreachable", sessions: [] },
    ] });
    expect(rows.sessions.map(s => [s.host, s.title])).toEqual([["pad", "A"]]);
    expect(rows.failed.map(h => h.host)).toEqual(["box"]);
    expect(remoteRows({ ok: true, vetoed: true, hosts: [] })).toEqual({ sessions: [], failed: [] });
    expect(remoteRows(null)).toEqual({ sessions: [], failed: [] });
  });
});
