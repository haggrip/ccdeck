// /resume typed inside a deck terminal, replayed from what this machine
// recorded on 2026-11-24 (events.jsonl seq 4171–4175, tmux and Claude Code's
// session records read the same afternoon), with the prompts and paths cut:
//
//   14:21:22.882  SessionStart  9521d6c1  source startup                (pane ccdeck-claude-680fc02c, launch)
//   14:21:28.030  SessionEnd    9521d6c1  reason resume  prompt 3d3808c6
//   14:21:28.076  SessionStart  1eeaf1b7  source resume  prompt 3d3808c6
//
// with 1eeaf1b7 still open, idle, in ccdeck-claude-c3c01284, the pane the
// deck had resumed it in three hours before. What the deck has to do: the
// pane follows the new id, the empty card it left goes, and the two
// terminals now holding 1eeaf1b7 are said, and closed only when asked.
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "reactflow";
import { join } from "node:path";
import {
  createResumePairer, createResumeRebind, parseOwnPanes, recordedSession, tmuxCandidates, twinGroups,
} from "../../server/resume-rebind.mjs";
import { handleTerminalTwins, handleTerminalTwinsClose } from "../../server/resume-rebind-routes.mjs";
import { applyEvent, initialState, type GraphState } from "../reducer";
import type { HookEnvelope, HookPayload } from "../types";
import AgentNode from "../components/AgentNode";
import { resetTwins, twinsFrom } from "../use-twin-terminals";

const LEFT = "9521d6c1-5205-493c-a269-535cd61f1eca";
const PICKED = "1eeaf1b7-f88c-48eb-aec2-b264c4a88c16";
const PROMPT = "3d3808c6-30be-499e-95c0-4ba13cb0e597";
const CWD = "/work/saas-platform";
const T0 = 1795522882900;
const CLAUDE_DIR = "/home/u/.claude";

/** The recorded sequence, as the hook posts it. */
const RECORDED: { at: number; payload: HookPayload }[] = [
  { at: T0, payload: { hook_event_name: "SessionStart", session_id: LEFT, source: "startup", cwd: CWD, provider: "claude" } as HookPayload },
  { at: T0 + 5_148, payload: { hook_event_name: "SessionEnd", session_id: LEFT, reason: "resume", prompt_id: PROMPT, cwd: CWD, provider: "claude" } as HookPayload },
  { at: T0 + 5_194, payload: { hook_event_name: "SessionStart", session_id: PICKED, source: "resume", prompt_id: PROMPT, cwd: CWD, session_title: "ACME performance", provider: "claude" } as HookPayload },
];

// ---------------------------------------------------------------------------
// A tmux server and a sessions folder, in memory.

interface FakePane { name: string; pid: number; dead: boolean; created: number; agent: string; kind: string; label: string }

function machine(panes: FakePane[], records: Record<number, string>) {
  const calls: string[][] = [];
  const tmux = {
    async run(args: string[]) {
      calls.push(args);
      if (args[0] === "list-panes") {
        const out = panes.map(p => [p.name, p.pid, p.dead ? 1 : 0, p.created / 1000, p.agent, p.kind, p.label].join("\t")).join("\n");
        return { ok: true, stdout: out, stderr: "", noServer: false };
      }
      if (args[0] === "set-option") {
        const p = panes.find(x => `=${x.name}:` === args[2]);
        if (!p) return { ok: false, stdout: "", stderr: "can't find session", noServer: false };
        p.label = args[4];
        return { ok: true, stdout: "", stderr: "", noServer: false };
      }
      if (args[0] === "kill-session") {
        const i = panes.findIndex(x => `=${x.name}` === args[2]);
        if (i < 0) return { ok: false, stdout: "", stderr: "can't find session", noServer: false };
        panes.splice(i, 1);
        return { ok: true, stdout: "", stderr: "", noServer: false };
      }
      return { ok: false, stdout: "", stderr: "unknown", noServer: false };
    },
  };
  const readFile = (path: string) => {
    const m = /\/sessions\/(\d+)\.json$/.exec(path);
    const pid = m ? Number(m[1]) : NaN;
    if (!path.startsWith(join(CLAUDE_DIR, "sessions")) || !(pid in records)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return JSON.stringify({ pid, sessionId: records[pid], cwd: CWD, kind: "interactive" });
  };
  return { panes, records, calls, tmux, readFile };
}

/** The afternoon's two panes: the one /resume was typed in, still labelled
 *  with the id it left, and the older one holding the picked id. */
function afternoon() {
  return machine([
    { name: "ccdeck-claude-680fc02c", pid: 32139, dead: false, created: T0 - 1_000, agent: "claude", kind: "launch", label: LEFT },
    { name: "ccdeck-claude-c3c01284", pid: 96873, dead: false, created: T0 - 3 * 3_600_000, agent: "claude", kind: "resume", label: PICKED },
  ], { 32139: PICKED, 96873: PICKED });
}

function rebinder(m: ReturnType<typeof machine>, extra: Record<string, unknown> = {}) {
  const lines: string[] = [];
  const r = createResumeRebind({
    platform: "darwin", tmux: m.tmux, claudeDir: CLAUDE_DIR, readFile: m.readFile,
    sleep: async () => {}, log: (l: string) => { lines.push(l); }, ...extra,
  });
  return { r, lines };
}

async function feed(r: ReturnType<typeof createResumeRebind>, events = RECORDED) {
  const out: string[] = [];
  for (const e of events) {
    const done = r.observe(e.payload, e.at);
    if (done) out.push(...await done);
  }
  return out;
}

describe("pairing the two halves of an in-process /resume", () => {
  it("pairs the recorded end and start by their prompt id", () => {
    const p = createResumePairer();
    expect(p.note(RECORDED[0].payload, RECORDED[0].at)).toBeNull();
    expect(p.note(RECORDED[1].payload, RECORDED[1].at)).toBeNull();
    expect(p.note(RECORDED[2].payload, RECORDED[2].at)).toEqual({ from: LEFT, to: PICKED, cwd: CWD });
  });

  it("pairs them in either order", () => {
    const p = createResumePairer();
    expect(p.note(RECORDED[2].payload, RECORDED[2].at)).toBeNull();
    expect(p.note(RECORDED[1].payload, RECORDED[1].at)).toEqual({ from: LEFT, to: PICKED, cwd: CWD });
  });

  it("leaves a claude --resume alone: its start carries no prompt id and follows no end", () => {
    const p = createResumePairer();
    const start = { ...RECORDED[2].payload } as Record<string, unknown>;
    delete start.prompt_id;
    expect(p.note(start as HookPayload, T0)).toBeNull();
    expect(p.note(RECORDED[1].payload, T0 + 10)).toBeNull();
  });

  it("does not pair a compaction, whose start also carries a prompt id", () => {
    const p = createResumePairer();
    p.note(RECORDED[1].payload, T0);
    expect(p.note({ ...RECORDED[2].payload, source: "compact" } as HookPayload, T0 + 40)).toBeNull();
  });

  it("forgets a half that waited past the window", () => {
    const p = createResumePairer({ windowMs: 1_000 });
    p.note(RECORDED[1].payload, T0);
    expect(p.note(RECORDED[2].payload, T0 + 5_000)).toBeNull();
  });
});

describe("the deck terminal follows /resume", () => {
  it("retags the pane /resume was typed in with the picked id", async () => {
    const m = afternoon();
    const { r, lines } = rebinder(m);
    expect(await feed(r)).toEqual(["ccdeck-claude-680fc02c"]);
    expect(m.panes.find(p => p.name === "ccdeck-claude-680fc02c")!.label).toBe(PICKED);
    // The older pane is not touched: it holds the picked id too, and is the
    // two-terminals warning's business, not the rebind's.
    expect(m.panes.find(p => p.name === "ccdeck-claude-c3c01284")!.label).toBe(PICKED);
    expect(m.calls.filter(c => c[0] === "set-option")).toEqual([["set-option", "-t", "=ccdeck-claude-680fc02c:", "@ccdeck-session", PICKED]]);
    expect(lines.join("\n")).toContain("9521d6c1 → 1eeaf1b7");
  });

  it("waits for Claude Code's record when it trails the hook", async () => {
    const m = afternoon();
    m.records[32139] = LEFT;
    let polls = 0;
    const { r } = rebinder(m, { sleep: async () => { if (++polls === 3) m.records[32139] = PICKED; } });
    expect(await feed(r)).toEqual(["ccdeck-claude-680fc02c"]);
    expect(polls).toBe(3);
  });

  it("believes the pane's own process, not the events: a forged pair retags nothing", async () => {
    const m = afternoon();
    m.records[32139] = LEFT; // the process never switched
    const { r } = rebinder(m, { recordWaitMs: 600, recordPollMs: 150 });
    expect(await feed(r)).toEqual([]);
    expect(m.panes[0].label).toBe(LEFT);
    expect(m.calls.some(c => c[0] === "set-option")).toBe(false);
  });

  it("covers a terminal the deck resumed (kind resume) the same way", async () => {
    const m = afternoon();
    m.panes[0].kind = "resume";
    const { r } = rebinder(m);
    expect(await feed(r)).toEqual(["ccdeck-claude-680fc02c"]);
  });

  it("does nothing with the Command Panel off, on Windows, or for panes that are not the deck's", async () => {
    for (const extra of [{ enabled: () => false }, { platform: "win32" }]) {
      const m = afternoon();
      const { r } = rebinder(m, extra);
      expect(await feed(r)).toEqual([]);
      expect(m.calls).toEqual([]);
    }
    const m = afternoon();
    m.panes[0].name = "work"; // somebody's own session on the deck's server
    const { r } = rebinder(m);
    expect(await feed(r)).toEqual([]);
  });

  it("reads a record only as its own process's", () => {
    const readFile = () => JSON.stringify({ pid: 4242, sessionId: PICKED });
    expect(recordedSession(32139, { claudeDir: CLAUDE_DIR, readFile })).toBe("");
    expect(recordedSession(4242, { claudeDir: CLAUDE_DIR, readFile })).toBe(PICKED);
  });
});

describe("one conversation in two deck terminals", () => {
  it("is said once the pane has followed, newest first", async () => {
    const m = afternoon();
    const { r } = rebinder(m);
    await feed(r);
    expect(await r.twins()).toEqual([{ sessionId: PICKED, count: 2, newestAt: T0 - 1_000, olderAt: T0 - 3 * 3_600_000 }]);
  });

  it("is seen through the processes' records even before any retag", async () => {
    const m = afternoon(); // 680fc02c still labelled LEFT, its process on PICKED
    const { r } = rebinder(m);
    expect((await r.twins()).map(t => t.sessionId)).toEqual([PICKED]);
  });

  it("closes the older terminal, and only that one, when asked", async () => {
    const m = afternoon();
    const { r, lines } = rebinder(m);
    await feed(r);
    expect(await r.closeOlder(PICKED)).toEqual({ ok: true, closed: 1 });
    expect(m.panes.map(p => p.name)).toEqual(["ccdeck-claude-680fc02c"]);
    expect(m.calls.filter(c => c[0] === "kill-session")).toEqual([["kill-session", "-t", "=ccdeck-claude-c3c01284"]]);
    expect(lines.join("\n")).toContain("closed ccdeck-claude-c3c01284");
    expect(await r.twins()).toEqual([]);
  });

  it("never closes anything on its own: following /resume kills nothing", async () => {
    const m = afternoon();
    const { r } = rebinder(m);
    await feed(r);
    await r.twins();
    expect(m.calls.some(c => c[0] === "kill-session")).toBe(false);
  });

  it("refuses a close when there is one terminal by now, and a non-id", async () => {
    const m = afternoon();
    m.panes.splice(1, 1);
    const { r } = rebinder(m);
    expect(await r.closeOlder(PICKED)).toEqual({ ok: false, code: "no-twins" });
    expect(await r.closeOlder("--all")).toEqual({ ok: false, code: "bad-request" });
    expect(m.calls.some(c => c[0] === "kill-session")).toBe(false);
  });

  it("counts live panes only, and never an attach wrapper", () => {
    const listing = [
      ["ccdeck-claude-aaaaaaaa", 10, 0, 100, "claude", "launch", PICKED],
      ["ccdeck-claude-bbbbbbbb", 11, 1, 200, "claude", "resume", PICKED],
      ["ccdeck-att-1eeaf1b7", 12, 0, 300, "claude", "attach", PICKED],
    ].map(f => f.join("\t")).join("\n");
    const panes = parseOwnPanes(listing);
    expect(panes.map(p => p.name)).toEqual(["ccdeck-claude-aaaaaaaa", "ccdeck-claude-bbbbbbbb"]);
    expect(twinGroups(panes, (p: { label: string }) => p.label)).toEqual([]);
  });
});

describe("the twins routes", () => {
  function res() {
    const out = { status: 0, body: null as unknown };
    const r = {
      writeHead(s: number) { out.status = s; return r; },
      setHeader() {}, getHeader() { return undefined; }, headersSent: false,
      end(b?: string) { out.body = b ? JSON.parse(b) : null; },
    };
    return { r, out };
  }
  const stubRebind = {
    twins: async () => [{ sessionId: PICKED, count: 2, newestAt: 2, olderAt: 1 }],
    closeOlder: async () => ({ ok: true, closed: 1 }),
  };

  it("answers 404 with the panel off, as a path with no route", async () => {
    const { r, out } = res();
    await handleTerminalTwins({} as never, r as never, { enabled: () => false, resumeRebind: stubRebind });
    expect(out).toEqual({ status: 404, body: { error: "not found" } });
  });

  it("names sessions, never panes", async () => {
    const { r, out } = res();
    await handleTerminalTwins({} as never, r as never, { enabled: () => true, resumeRebind: stubRebind });
    expect(out.status).toBe(200);
    expect(JSON.stringify(out.body)).not.toContain("ccdeck-");
  });

  it("closes on a body that names the session", async () => {
    const { Readable } = await import("node:stream");
    const req = Object.assign(Readable.from([JSON.stringify({ sessionId: PICKED })]), { headers: {} });
    const { r, out } = res();
    await handleTerminalTwinsClose(req as never, r as never, { enabled: () => true, resumeRebind: stubRebind });
    expect(out).toEqual({ status: 200, body: { ok: true, closed: 1 } });
  });
});

describe("tmux lookup on the product's path", () => {
  it("takes CCDECK_TMUX alone when it is set, as tmux.mjs does", () => {
    expect(tmuxCandidates({ env: { CCDECK_TMUX: "/opt/x/tmux", PATH: "" }, platform: "darwin", exists: () => true, managed: "/m/tmux" })).toEqual(["/opt/x/tmux"]);
  });
  it("falls back to the usual places and ccdeck's own build", () => {
    const got = tmuxCandidates({ env: { PATH: "" }, platform: "darwin", exists: (p: string) => p === "/opt/homebrew/bin/tmux" || p === "/m/tmux", managed: "/m/tmux" });
    expect(got).toEqual(["/opt/homebrew/bin/tmux", "/m/tmux"]);
  });
});

// ---------------------------------------------------------------------------
// The board.

let seq = 0;
function apply(state: GraphState, at: number, payload: HookPayload) {
  applyEvent(state, { seq: ++seq, receivedAt: at, source: "hook", payload } as HookEnvelope);
}

describe("the board after /resume inside a terminal", () => {
  afterEach(() => { resetTwins(); });

  it("folds the empty card the terminal left, and keeps the one it picked", () => {
    seq = 0;
    const state = initialState();
    for (const e of RECORDED) apply(state, e.at, e.payload);
    expect(state.agents.has(LEFT)).toBe(false);
    expect(state.agents.has(PICKED)).toBe(true);
    expect([...state.agents.values()].filter(a => a.kind === "root")).toHaveLength(1);
  });

  it("folds it whichever half lands first", () => {
    seq = 0;
    const state = initialState();
    apply(state, RECORDED[0].at, RECORDED[0].payload);
    apply(state, RECORDED[2].at, RECORDED[2].payload);
    apply(state, RECORDED[1].at, RECORDED[1].payload);
    expect(state.agents.has(LEFT)).toBe(false);
  });

  it("keeps the card of a session somebody worked in before switching", () => {
    seq = 0;
    const state = initialState();
    apply(state, T0, RECORDED[0].payload);
    apply(state, T0 + 1_000, { hook_event_name: "UserPromptSubmit", session_id: LEFT, prompt: "look at the perf numbers", provider: "claude" } as HookPayload);
    apply(state, RECORDED[1].at, RECORDED[1].payload);
    apply(state, RECORDED[2].at, RECORDED[2].payload);
    expect(state.agents.has(LEFT)).toBe(true);
    expect(state.agents.has(PICKED)).toBe(true);
  });

  it("warns on the picked card that two terminals hold it, with the close behind a button", () => {
    seq = 0;
    const state = initialState();
    for (const e of RECORDED) apply(state, e.at, e.payload);
    const a = state.agents.get(PICKED)!;
    const card = () => renderToStaticMarkup(createElement(ReactFlowProvider, null,
      createElement(AgentNode as never, { id: a.id, data: a, selected: false })));
    expect(card()).not.toContain("twin-row");
    resetTwins({ counts: twinsFrom({ ok: true, twins: [{ sessionId: PICKED, count: 2 }] }) });
    const html = card();
    expect(html).toContain("twin-row");
    expect(html).toContain("Open in 2 terminals");
    expect(html).toContain("Close the older terminal");
    // The question is asked first: no dialog is drawn until the button is pressed.
    expect(html).not.toContain("role=\"dialog\"");
  });

  it("reads the route's answer defensively", () => {
    expect(twinsFrom({ ok: true, twins: [{ sessionId: PICKED.toUpperCase(), count: 2 }, { sessionId: LEFT, count: 1 }, { count: 3 }] }))
      .toEqual(new Map([[PICKED, 2]]));
    expect(twinsFrom({ error: "not found" })).toEqual(new Map());
  });
});
