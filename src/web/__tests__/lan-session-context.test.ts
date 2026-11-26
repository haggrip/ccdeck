// A paired deck's sessions in this deck's brief, Todo list and Mission, with
// what they say (lan-session-context.mjs, lan-sessions.mjs, paired-sessions.mjs).
//
// Pinned here: the second switch is off until the owner turns it on, rides on
// the first, and the machine can hold it off; what it adds is four fields, cut
// to their caps, and still never a tool's input, a transcript or a path; the end
// of a turn is one shape, the desktop app's call where a row has it, else the
// Stop hook's last words, retired by the next prompt; the asking deck keeps
// those fields only from a deck whose manifest said it shares them; and this
// deck's brief, Todo list and Mission take a paired deck's sessions down the
// paths its own take, marked with their machine.
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomBytes } from "node:crypto";
// @ts-expect-error — plain .mjs server module, no types
import { DEFAULTS, lanSessionContextVetoed, normalise, pagePatch } from "../../server/deck-prefs.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { lanApplyFields } from "../../server/lan-deck.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { contextOf, sessionContexts, withSessionContext } from "../../server/lan-session-context.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { createRemoteSessions, shareRows, shareWrap } from "../../server/lan-sessions.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { createServe } from "../../server/lan-serve.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { summarizeSessions } from "../../server/session-summary.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { SETTING_VARS } from "../../server/login-service.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { pairedRows, pairedSignature, peerSessionId, remoteIdOfProject, withPairedRows } from "../../server/paired-sessions.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { buildPrompt, sessionDigest } from "../../server/status-brief.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { normaliseStore, reconcileDeck } from "../../server/status-todo.mjs";
import { announce, rigDeck, stopAll } from "./lan-engine-rig";
import { missionRemote, readRemoteMachines, remoteOpeners } from "../remote-sessions";
import { MissionPage } from "../components/MissionView";
import type { StatusBriefHandle } from "../use-status-brief";
import type { TodoView } from "../status-todo";

afterEach(stopAll);

const CWD = "/home/hagai/saas-platform/.claude/worktrees/bridge-cse_017qTQaoVZgLuZVFFpGJDBSv";
const TOOL_SECRET = "cat /etc/TOOL-SECRET";
const SECRETS = ["TOOL-SECRET", "/home/hagai", "saas-platform/.claude"];
const noLeak = (value: unknown) => {
  const s = JSON.stringify(value);
  for (const secret of SECRETS) expect(s, secret).not.toContain(secret);
};

/** A Remote Control session's ring: a prompt, a tool, a turn that ends with
 *  its last words; a second session asking a question it has no answer to. */
function ring(t: number) {
  let seq = 0;
  const env = (dt: number, payload: Record<string, unknown>) => ({ seq: ++seq, receivedAt: t + dt, payload });
  return [
    env(0, { hook_event_name: "SessionStart", session_id: "rc1", cwd: CWD }),
    env(1, { hook_event_name: "UserPromptSubmit", session_id: "rc1", cwd: CWD, prompt: "Which Linear issues are in this cycle?" }),
    env(2, { hook_event_name: "PreToolUse", session_id: "rc1", tool_use_id: "tu1", tool_name: "Bash", tool_input: { command: TOOL_SECRET } }),
    env(3, { hook_event_name: "PostToolUse", session_id: "rc1", tool_use_id: "tu1", tool_name: "Bash", tool_response: TOOL_SECRET }),
    // A subagent's last words are its own.
    env(4, { hook_event_name: "Stop", session_id: "rc1", agent_id: "a1", last_assistant_message: "subagent words" }),
    env(5, { hook_event_name: "Stop", session_id: "rc1", last_assistant_message: "Three issues are open.\nShould I start on DIS-1?" }),
    env(6, { hook_event_name: "UserPromptSubmit", session_id: "rc2", cwd: "/srv/api", prompt: "migrate" }),
    env(7, { hook_event_name: "PreToolUse", session_id: "rc2", tool_use_id: "q1", tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: "Which schema?", header: "Schema", options: [{ label: "v1" }, { label: "v2" }] }] } }),
  ];
}

describe("the second switch", () => {
  it("is off by default, only a real true turns it on, and it is the page's to write", () => {
    expect(DEFAULTS.lan.shareSessionContext).toBe(false);
    expect(normalise({}).lan.shareSessionContext).toBe(false);
    expect(normalise({ lan: { shareSessionContext: true } }).lan.shareSessionContext).toBe(true);
    expect(normalise({ lan: { shareSessionContext: "yes" } }).lan.shareSessionContext).toBe(false);
    expect(pagePatch({ lan: { shareSessionContext: true } })).toEqual({ lan: { shareSessionContext: true } });
  });

  it("can be held off by the machine, and a deck started at login carries the veto", () => {
    expect(lanSessionContextVetoed({})).toBe(false);
    expect(lanSessionContextVetoed({ AGENTS_DECK_NO_LAN_SESSION_CONTEXT: "1" })).toBe(true);
    const on = { lan: { shareSessions: true, shareSessionContext: true } };
    expect(lanApplyFields(on, { env: {} })).toMatchObject({ shareSessionContext: true, contextVetoed: false });
    expect(lanApplyFields(on, { env: { AGENTS_DECK_NO_LAN_SESSION_CONTEXT: "1" } })).toMatchObject({ contextVetoed: true });
    expect(SETTING_VARS).toContain("AGENTS_DECK_NO_LAN_SESSION_CONTEXT");
  });
});

describe("the end of a turn, one shape", () => {
  const t = 1_000_000;

  it("is the Stop hook's last words, as a wrap with no id and no ask, never a subagent's", () => {
    const rows = summarizeSessions(ring(t), { now: t + 10 });
    const rc1 = withSessionContext(rows, ring(t)).find((r: { id: string }) => r.id === "rc1");
    expect(rc1.context).toEqual({
      prompt: "Which Linear issues are in this cycle?", question: null, askedAt: null,
      wrap: { id: null, at: t + 5, recap: "Three issues are open. Should I start on DIS-1?", ask: null },
    });
  });

  it("is retired by the next prompt, and dropped when the session ends", () => {
    const more = [...ring(t), { seq: 99, receivedAt: t + 20, payload: { hook_event_name: "UserPromptSubmit", session_id: "rc1", prompt: "yes" } }];
    const ctx = sessionContexts(more).get("rc1");
    expect(contextOf({ id: "rc1", state: "working" }, ctx)).toMatchObject({ prompt: "yes", wrap: null });
    const ended = [...ring(t), { seq: 99, receivedAt: t + 20, payload: { hook_event_name: "SessionEnd", session_id: "rc1" } }];
    expect(sessionContexts(ended).has("rc1")).toBe(false);
    expect(contextOf({ id: "rc1", state: "ended" }, sessionContexts(ring(t)).get("rc1")).wrap).toBeNull();
  });

  it("is the row's own end-of-turn call where it has one (session-wrap.mjs)", () => {
    const call = { id: "toolu_1", at: t + 4, recap: "Opened the PR.", ask: { question: "Merge it?", choices: ["Merge"], blocked: true } };
    expect(contextOf({ id: "rc1", state: "idle", wrap: call }, sessionContexts(ring(t)).get("rc1")).wrap).toBe(call);
  });

  it("says the question standing: the row's wait, else an AskUserQuestion with no result yet", () => {
    const ctxs = sessionContexts(ring(t));
    expect(contextOf({ id: "rc2", state: "working" }, ctxs.get("rc2"))).toMatchObject({ question: "Which schema?", askedAt: t + 7 });
    const waiting = { id: "x", state: "waiting", waiting: { kind: "permission", message: "Claude needs your permission to use Bash", since: 42 } };
    expect(contextOf(waiting, null)).toMatchObject({ question: "Claude needs your permission to use Bash", askedAt: 42 });
    const answered = [...ring(t), { seq: 99, receivedAt: t + 9, payload: { hook_event_name: "PostToolUse", session_id: "rc2", tool_use_id: "q1", tool_name: "AskUserQuestion" } }];
    expect(contextOf({ id: "rc2", state: "working" }, sessionContexts(answered).get("rc2")).question).toBeNull();
  });
});

describe("what goes out", () => {
  const t = Date.now() - 60_000;
  const rows = () => withSessionContext(summarizeSessions(ring(t), { now: t + 10 }), ring(t));

  it("without the second switch, is the first tier only, whatever the rows carry", () => {
    const out = shareRows(rows());
    for (const r of out) expect(Object.keys(r).sort()).toEqual(["id", "lastEventAt", "name", "project", "provider", "since", "state", "waiting"]);
    expect(JSON.stringify(out)).not.toContain("Three issues");
  });

  it("with it, four fields more, cut, and still no tool input or path", () => {
    const out = shareRows(rows(), { context: true });
    noLeak(out);
    const rc1 = out.find((r: { id: string }) => r.id === "rc1");
    expect(Object.keys(rc1).sort()).toEqual(["askedAt", "id", "lastEventAt", "name", "project", "prompt", "provider", "question", "since", "state", "waiting", "wrap"]);
    expect(rc1).toMatchObject({ project: "bridge-cse_017qTQaoVZgLuZVFFpGJDBSv", prompt: "Which Linear issues are in this cycle?" });
    expect(rc1.wrap).toEqual({ id: null, at: t + 5, recap: "Three issues are open. Should I start on DIS-1?", ask: null });
    expect(out.find((r: { id: string }) => r.id === "rc2")).toMatchObject({ question: "Which schema?", askedAt: t + 7 });
  });

  it("cuts every field to its cap, and a wrap that says nothing to nothing", () => {
    const [r] = shareRows([{ id: "s", state: "idle", context: {
      prompt: "p".repeat(900), question: "q".repeat(900), askedAt: 5,
      wrap: { id: "i".repeat(300), at: 9, recap: "r".repeat(900), ask: { question: "a".repeat(900), choices: Array(9).fill("c".repeat(90)), blocked: true } },
    } }], { context: true });
    expect(r.prompt.length).toBe(240);
    expect(r.question.length).toBe(200);
    expect(r.wrap.recap.length).toBe(600);
    expect(r.wrap.id.length).toBe(128);
    expect(r.wrap.ask.question.length).toBe(300);
    expect(r.wrap.ask.choices).toHaveLength(4);
    expect(r.wrap.ask.choices[0].length).toBe(60);
    expect(shareWrap({ at: 5, recap: " ", ask: null })).toBeNull();
    expect(shareWrap({ recap: "no time" })).toBeNull();
  });
});

describe("who is told what", () => {
  const PEER = "fp-peer";
  function rig(cfg: Record<string, unknown>) {
    const asked: unknown[] = [];
    const { serve } = createServe({
      settings: () => ({ enabled: true, trusted: [{ fp: PEER }], shared: [], shareSessions: true, ...cfg }),
      serverNow: () => ({}), myFp: () => "fp-me",
      inbound: { spoke() {} }, learnCaller() {}, keepManifest() {}, manifestFrame: () => ({}),
      localAccounts: async () => [], liveLogin: null, exportAccount: async () => null,
      localSessions: async (opts: { context?: boolean } = {}) => {
        asked.push(opts);
        const t = Date.now() - 1_000;
        const rows = summarizeSessions(ring(t), { now: t + 10 });
        return opts.context ? withSessionContext(rows, ring(t)) : rows;
      },
      mayTalkTo: () => true, onError() {},
    });
    const sent: Array<Record<string, unknown>> = [];
    const ctx = { peerFp: PEER, peerAddr: "100.86.23.45", key: randomBytes(32), send: (f: Record<string, unknown>) => { sent.push(f); } };
    return { asked, ask: async () => { await serve({ t: "sessions" }, ctx); return sent.at(-1)! as { t: string; rows: Array<Record<string, unknown>> }; } };
  }

  it("tells what the sessions say only while the second switch is on and not vetoed", async () => {
    const on = rig({ shareSessionContext: true });
    expect((await on.ask()).rows.some(r => "wrap" in r)).toBe(true);
    expect(on.asked).toEqual([{ context: true }]);
    for (const cfg of [{}, { shareSessionContext: true, contextVetoed: true }]) {
      const off = rig(cfg);
      const got = await off.ask();
      expect(got.t).toBe("sessions");
      expect(got.rows.some(r => "wrap" in r || "prompt" in r)).toBe(false);
      expect(off.asked).toEqual([{ context: false }]);
    }
  });

  it("tells nothing at all while the sessions are not shared, the second switch notwithstanding", async () => {
    expect(await rig({ shareSessions: false, shareSessionContext: true }).ask()).toEqual({ t: "no", why: "not shared" });
  });
});

describe("the asking side", () => {
  it("keeps what a deck's sessions say only when that deck said it shares it", () => {
    const mem = createRemoteSessions({ now: () => 1, staleMs: 1_000 });
    const rows = [{ id: "s1", state: "idle", prompt: "hello", question: null, wrap: { id: null, at: 5, recap: "done", ask: null } }];
    mem.keep("said", rows, { context: true });
    mem.keep("silent", rows);
    const [said, silent] = mem.list();
    expect(said.sessions[0]).toMatchObject({ prompt: "hello", wrap: { recap: "done" } });
    expect(silent.sessions[0]).not.toHaveProperty("prompt");
    expect(silent.sessions[0]).not.toHaveProperty("wrap");
  });
});

describe("two decks on loopback", () => {
  const SHIPPED = { autoAsk: true, autoAccept: true, pairingMode: "automatic" };

  async function pair(context: boolean) {
    const t = Date.now() - 60_000;
    const a = await rigDeck("Thinkpad", {
      settings: { ...SHIPPED, shareSessions: true, shareSessionContext: context },
      deps: { sessions: ({ context: c = false }: { context?: boolean } = {}) => {
        const rows = summarizeSessions(ring(t), { now: t + 10 });
        return c ? withSessionContext(rows, ring(t)) : rows;
      } },
    });
    const b = await rigDeck("Mac", { settings: SHIPPED, deps: { sessions: () => [] } });
    announce(a, { fp: b.id.fp, port: b.port, name: "Mac" });
    announce(b, { fp: a.id.fp, port: a.port, name: "Thinkpad" });
    for (let i = 0; i < 3; i++) { await a.e.round(); await b.e.round(); }
    return { a, b };
  }

  it("carry the sharing deck's words to the other, and stop at the next round once it is off", async () => {
    const { a, b } = await pair(true);
    const [m] = b.e.remoteSessions();
    const rc1 = m.sessions.find((s: { id: string }) => s.id === "rc1");
    expect(rc1).toMatchObject({ prompt: "Which Linear issues are in this cycle?", wrap: { recap: "Three issues are open. Should I start on DIS-1?" } });
    noLeak(m);
    expect(a.e.status()).toMatchObject({ shareSessions: true, shareSessionContext: true });
    await a.e.apply({ shareSessionContext: false });
    await b.e.round();
    expect(b.e.remoteSessions()[0].sessions.find((s: { id: string }) => s.id === "rc1")).not.toHaveProperty("wrap");
  }, 30_000);

  it("carry none while the sharing deck has not turned the second switch on", async () => {
    const { b } = await pair(false);
    const [m] = b.e.remoteSessions();
    expect(m.sessions.length).toBe(2);
    for (const s of m.sessions) { expect(s).not.toHaveProperty("prompt"); expect(s).not.toHaveProperty("wrap"); }
  }, 30_000);
});

// ── this deck's side: the brief, the Todo list, Mission ─────────────────────
const FP = "abc-def-123-456";
const machines = () => [{
  fp: FP, name: "hagai-thinkpad-p14s", via: "tailscale", at: 900, control: true,
  sessions: [
    { id: "rc1", name: "Linear cycle", project: "bridge-cse_017qTQaoVZgLuZVFFpGJDBSv", provider: "claude", state: "idle", since: 100, lastEventAt: 105, waiting: null,
      prompt: "Which Linear issues are in this cycle?", question: null, askedAt: null, wrap: { id: null, at: 105, recap: "Three issues are open.", ask: null } },
    { id: "rc2", name: null, project: "api", provider: "claude", state: "working", since: 200, lastEventAt: 207, waiting: null,
      prompt: "migrate", question: "Which schema?", askedAt: 207, wrap: null },
    { id: "rc3", name: "Build", project: "web", provider: "claude", state: "working", since: 300, lastEventAt: 310, waiting: null },
  ],
}];

describe("a paired deck's sessions as this deck's rows", () => {
  it("are known by an id of their own, with their machine and their Remote Control session", () => {
    const rows = pairedRows(machines());
    expect(rows.map((r: { id: string }) => r.id)).toEqual([`peer:${FP}:rc1`, `peer:${FP}:rc2`, `peer:${FP}:rc3`]);
    expect(rows[0]).toMatchObject({ machine: "hagai-thinkpad-p14s", remoteId: "session_017qTQaoVZgLuZVFFpGJDBSv", cwd: null, prompt: "Which Linear issues are in this cycle?", wrap: { recap: "Three issues are open." } });
    expect(rows[2]).toMatchObject({ remoteId: null, prompt: null, wrap: null });
    expect(peerSessionId(FP, "x".repeat(130))).toBeNull();
    expect(remoteIdOfProject("bridge-cse_short")).toBeNull();
  });

  it("wait on the person here when a question stands, though the far deck says working", () => {
    const rc2 = pairedRows(machines())[1];
    expect(rc2).toMatchObject({ state: "waiting", since: 207, waiting: { kind: "asked", message: "Which schema?", since: 207 } });
  });

  it("sort among this deck's own, the waiting first, and say when they moved", () => {
    const local = [{ id: "l1", state: "working", since: 1, lastEventAt: 1000 }, { id: "l2", state: "idle", since: 1, lastEventAt: 50 }];
    const all = withPairedRows(local, pairedRows(machines()));
    expect(all.map((r: { id: string }) => r.id)).toEqual([`peer:${FP}:rc2`, "l1", `peer:${FP}:rc3`, `peer:${FP}:rc1`, "l2"]);
    const before = pairedSignature(pairedRows(machines()));
    const m = machines();
    m[0].sessions[2].state = "idle";
    expect(pairedSignature(pairedRows(m))).not.toBe(before);
  });
});

describe("in the brief", () => {
  it("each says where it runs, its own newest prompt, and links by its id", () => {
    const digest = sessionDigest(pairedRows(machines()), [], { now: 1_000 });
    expect(digest[0]).toMatchObject({ id: `peer:${FP}:rc1`, project: "bridge-cse_017qTQaoVZgLuZVFFpGJDBSv on hagai-thinkpad-p14s", prompt: "Which Linear issues are in this cycle?" });
    expect(digest[1]).toMatchObject({ state: "waiting", question: "Which schema?" });
    const prompt = buildPrompt({ sessions: digest, reach: { github: "none", slack: "none", jira: "none" }, tools: [], since: 0, now: 1_000 });
    expect(prompt).toContain(`- [peer:${FP}:rc2] (unnamed) · api on hagai-thinkpad-p14s · waiting`);
    expect(prompt).toContain("runs on another of my machines");
    expect(buildPrompt({ sessions: [], reach: { github: "none", slack: "none", jira: "none" }, tools: [], since: 0, now: 1 })).not.toContain("another of my machines");
  });
});

describe("on the Todo list", () => {
  it("one waiting on the person is a task under its machine's name, closed when it moves on", () => {
    const store = normaliseStore(null);
    expect(reconcileDeck(store, pairedRows(machines()), [], 1_000)).toBe(true);
    const [task] = store.items;
    expect(task).toMatchObject({ state: "open", kind: "answer", origin: "deck", detail: "Which schema?", link: { sessionId: `peer:${FP}:rc2`, project: "hagai-thinkpad-p14s" } });
    // Its id holds colons of its own: the wait is still read off its key, and
    // the same wait keeps the task open.
    expect(reconcileDeck(store, pairedRows(machines()), [], 1_500)).toBe(false);
    expect(store.items[0].state).toBe("open");
    const m = machines();
    Object.assign(m[0].sessions[1], { question: null, askedAt: null });
    reconcileDeck(store, pairedRows(m), [], 2_000);
    expect(store.items[0]).toMatchObject({ state: "closed", closedBy: "deck", closedReason: "Answered: the session moved on" });
  });

  it("comes back when its machine does, still waiting: a sleep is not an answer", () => {
    const store = normaliseStore(null);
    reconcileDeck(store, pairedRows(machines()), [], 1_000);
    // The ThinkPad (or this Mac) slept: its rows went stale and left the board.
    reconcileDeck(store, [], [], 2_000);
    expect(store.items[0]).toMatchObject({ state: "closed", closedReason: "The session is no longer on the board" });
    expect(reconcileDeck(store, pairedRows(machines()), [], 3_000)).toBe(true);
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({ state: "open", detail: "Which schema?" });
    // One the person closed stays closed.
    Object.assign(store.items[0], { state: "closed", closedBy: "user", closedReason: "Closed" });
    reconcileDeck(store, [], [], 4_000);
    reconcileDeck(store, pairedRows(machines()), [], 5_000);
    expect(store.items[0]).toMatchObject({ state: "closed", closedBy: "user" });
  });
});

describe("on Mission", () => {
  const brief: StatusBriefHandle = { view: null, unreachable: false, refresh() {}, setSettings() {}, person() {} };

  it("reads what the deck relays, cut again", () => {
    const [m] = readRemoteMachines({ ok: true, machines: [{ ...machines()[0], sessions: [{ id: "s", state: "idle", prompt: "p".repeat(900), question: "q", askedAt: 3,
      wrap: { at: 4, recap: "r".repeat(900), ask: { question: "a", choices: ["x", 5], blocked: true } } }] }] })!;
    expect(m.sessions[0].prompt!.length).toBe(240);
    expect(m.sessions[0].wrap).toMatchObject({ recap: "r".repeat(600), ask: { question: "a", choices: ["x"], blocked: true } });
  });

  it("lists them in Live under their machine, waiting first, and opens a Remote Control one in the desktop app", () => {
    const live = missionRemote(readRemoteMachines({ machines: machines() })!);
    expect(live.map(x => [x.sessionId, x.live, x.detail])).toEqual([
      [`peer:${FP}:rc2`, "waiting", "Which schema?"],
      [`peer:${FP}:rc3`, "working", null],
    ]);
    const open = remoteOpeners(readRemoteMachines({ machines: machines() })!);
    expect(open.get(`peer:${FP}:rc1`)).toBe("session_017qTQaoVZgLuZVFFpGJDBSv");
    expect(open.has(`peer:${FP}:rc2`)).toBe(false);

    const view: TodoView = { ok: true, now: 1, closed: [], keeper: { lastRunAt: null, lastCostUsd: null, error: null }, open: [
      { id: "t_000009", title: "Linear cycle", kind: "decide", origin: "brief", state: "open", createdAt: 1, updatedAt: 1,
        link: { kind: "session", sessionId: `peer:${FP}:rc1`, project: "hagai-thinkpad-p14s" } },
    ] };
    const draw = (onOpenRemote?: (id: string) => void) => renderToStaticMarkup(createElement(MissionPage, {
      rows: [], now: 1, desktop: {}, brief, todo: { view, say() {}, act() {} },
      onOpenSession() {}, onOpenDesktop() {}, remote: readRemoteMachines({ machines: machines() })!, onOpenRemote,
    }));
    const html = draw(() => {});
    expect(html).toMatch(/data-live="waiting" data-far=""[\s\S]*?mi-live-machine">hagai-thinkpad-p14s[\s\S]*?Which schema\?/);
    expect(html).toMatch(/data-live="working" data-far=""/);
    // The task about the Remote Control session opens it in the desktop app.
    expect(html).toMatch(/<button type="button" class="mi-task-title"[^>]*title="Open in Claude Desktop">[\s\S]*?Linear cycle/);
    expect(html).not.toContain("claude://");
    // Without a way to open it, the task's title is words, not a button.
    expect(draw()).toMatch(/<span class="mi-task-title"><span class="mi-task-title-text">Linear cycle/);
  });
});
