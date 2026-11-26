// The desktop app's end-of-turn call (src/server/session-wrap.mjs): every one of
// its sessions ends a turn with `mcp__ccd_turn__wrap_up`, saying where things
// stand and, when the turn leaves the person a decision, the question and
// whether the session stopped on it. On 2026-11-25 a session sat on "Which Jira
// key should the Splunk batching PR carry?" while Mission said nothing waited
// on its owner (owner, 2026-11-25: build it). These pin the parse, both roads
// in, the Todo list's "decide" item, the brief's session lines and the page.
import { describe, it, expect } from "vitest";
import { foldWrapLine, isPromptLine, normaliseWrap, WRAP_TOOL, wrapFromInput, wrapKey, wrapOf } from "../../server/session-wrap.mjs";
import { normaliseStore, reconcileDeck } from "../../server/status-todo.mjs";
import { buildPrompt, sessionDigest } from "../../server/status-brief.mjs";
import { applyEvent, initialState } from "../reducer";
import { wrapShown } from "../session-recap";
import { buildRows } from "../components/SessionList";
import { liveState } from "../components/MissionView";
import type { HookEnvelope, HookPayload } from "../types";
// @ts-expect-error — plain .mjs module, no types
const { summarizeSessions } = await import("../../server/session-summary.mjs");

const SID = "ee40b54e-608b-48ca-b742-5c062e4c957d";
const CALL = "toolu_01SplunkBatching";
const INPUT = {
  recap: "Splunk batching is built on a main-based branch. Alerts now go as one HEC request per batch, and 99 tests pass. Nothing is committed or pushed yet.",
  ask: "Which Jira key should the Splunk batching PR carry?",
  actions: [{ label: "New batching ticket" }, { label: "Use DIS-25544" }],
  blocked: true,
};
const T0 = Date.parse("2026-11-25T18:30:00.000Z");
const SEC = 1000;
const MIN = 60 * SEC;

/** The transcript line the desktop app writes for the call. */
const callLine = (input: object = INPUT, over: object = {}) => JSON.stringify({
  type: "assistant", isSidechain: false, timestamp: new Date(T0).toISOString(), sessionId: SID,
  message: { role: "assistant", content: [{ type: "tool_use", id: CALL, name: WRAP_TOOL, input }] },
  ...over,
});
const userLine = (content: unknown, over: object = {}) => JSON.stringify({
  type: "user", isSidechain: false, timestamp: new Date(T0 + MIN).toISOString(), message: { role: "user", content }, ...over,
});

describe("the call, read", () => {
  it("keeps the recap, the question, its answers and whether the session stopped", () => {
    expect(wrapFromInput(INPUT, CALL, T0)).toEqual({
      id: CALL, at: T0, recap: INPUT.recap,
      ask: { question: INPUT.ask, choices: ["New batching ticket", "Use DIS-25544"], blocked: true },
    });
  });

  it("has no ask when the turn leaves none, and is nothing when it says nothing", () => {
    expect(wrapFromInput({ recap: "Merged and deployed." }, CALL, T0)?.ask).toBeNull();
    expect(wrapFromInput({}, CALL, T0)).toBeNull();
    expect(wrapFromInput(INPUT, CALL, Number.NaN)).toBeNull();
    expect(wrapFromInput(null, CALL, T0)).toBeNull();
  });

  it("is an ask when blocked, though the question went into the closing message", () => {
    expect(wrapFromInput({ recap: "Stuck on access.", blocked: true }, CALL, T0)?.ask).toEqual({ question: null, choices: [], blocked: true });
  });

  it("bounds what a malformed call could put on the page", () => {
    const w = wrapFromInput({ recap: "x".repeat(5000), ask: "y".repeat(5000), actions: Array.from({ length: 9 }, (_, i) => ({ label: `a${i}` })) }, CALL, T0)!;
    expect(w.recap!.length).toBeLessThanOrEqual(600);
    expect(w.ask!.question!.length).toBeLessThanOrEqual(300);
    expect(w.ask!.choices).toHaveLength(4);
  });

  it("reads the same off the transcript line, main chain only", () => {
    expect(wrapOf(callLine())).toEqual(wrapFromInput(INPUT, CALL, T0));
    expect(wrapOf(callLine(INPUT, { isSidechain: true }))).toBeNull();
    expect(wrapOf('{"type":"assistant", broken')).toBeNull();
    expect(wrapOf(userLine("what does mcp__ccd_turn__wrap_up do?"))).toBeNull();
  });

  it("checks a wrap handed over on an event again", () => {
    const w = wrapFromInput(INPUT, CALL, T0);
    expect(normaliseWrap(w)).toEqual(w);
    expect(normaliseWrap({ at: "soon" })).toBeNull();
    expect(wrapKey(w)).toBe(CALL);
    expect(wrapKey({ ...w!, id: null })).toBe(String(T0));
  });
});

describe("when the call stops being true, in the transcript", () => {
  it("is the next prompt, not the closing message the model writes after the call", () => {
    const out: { wrap?: unknown } = {};
    foldWrapLine(out, callLine());
    // The call's own result, then the closing message: the same turn.
    foldWrapLine(out, userLine([{ type: "tool_result", tool_use_id: CALL, content: "ok" }]));
    foldWrapLine(out, JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done. Which key?" }] } }));
    expect(out.wrap).toMatchObject({ id: CALL });
    foldWrapLine(out, userLine("Use DIS-25544"));
    expect(out.wrap).toBeNull();
  });

  it("tells a prompt from a meta note, a compaction summary and a subagent's line", () => {
    expect(isPromptLine(userLine("Use DIS-25544"))).toBe(true);
    expect(isPromptLine(userLine([{ type: "text", text: "Use DIS-25544" }]))).toBe(true);
    expect(isPromptLine(userLine([{ type: "tool_result", tool_use_id: CALL, content: "ok" }]))).toBe(false);
    expect(isPromptLine(userLine("<local-command-caveat>", { isMeta: true }))).toBe(false);
    expect(isPromptLine(userLine("This session is being continued…", { isCompactSummary: true }))).toBe(false);
    expect(isPromptLine(userLine("subagent task", { isSidechain: true }))).toBe(false);
    expect(isPromptLine(userLine("   "))).toBe(false);
  });
});

let seq = 0;
const env = (receivedAt: number, payload: Record<string, unknown>) =>
  ({ seq: ++seq, receivedAt, source: "hook", payload: { session_id: SID, cwd: "/Users/me/saas-platform", ...payload } });
const call = (at: number, input: object = INPUT, id = CALL, extra: object = {}) => [
  env(at - 200, { hook_event_name: "PreToolUse", tool_name: WRAP_TOOL, tool_use_id: id, tool_input: input, ...extra }),
  env(at, { hook_event_name: "PostToolUse", tool_name: WRAP_TOOL, tool_use_id: id, tool_input: input, ...extra }),
];
/** A turn that ended on the call: prompt, call, Stop. */
const stopped = (at = T0) => [
  env(at - 5 * MIN, { hook_event_name: "UserPromptSubmit", prompt: "batch the Splunk alerts" }),
  ...call(at),
  env(at + 3 * SEC, { hook_event_name: "Stop" }),
];
const rowOf = (events: unknown[], now = T0 + MIN) => summarizeSessions(events, { now }).find((r: { id: string }) => r.id === SID);

describe("a session's row on the deck", () => {
  it("carries the call the moment its hook lands", () => {
    const r = rowOf(stopped());
    expect(r.state).toBe("idle");
    expect(r.wrap).toEqual({ id: CALL, at: T0, recap: INPUT.recap, ask: { question: INPUT.ask, choices: ["New batching ticket", "Use DIS-25544"], blocked: true } });
  });

  it("drops it at the next prompt", () => {
    const r = rowOf([...stopped(), env(T0 + 2 * MIN, { hook_event_name: "UserPromptSubmit", prompt: "Use DIS-25544" })], T0 + 3 * MIN);
    expect(r.state).toBe("working");
    expect(r.wrap).toBeNull();
  });

  it("hears the transcript's copy of the same call as the same call, and keeps the hook's time", () => {
    const echo = env(T0 + 2 * SEC, { hook_event_name: "SessionRecapped", recap: null, wrap: wrapFromInput(INPUT, CALL, T0 - 400) });
    expect(rowOf([...stopped(), echo]).wrap.at).toBe(T0);
  });

  it("takes the transcript's road when the log no longer holds the hook", () => {
    const echo = env(T0 + 10 * MIN, { hook_event_name: "SessionRecapped", recap: null, wrap: wrapFromInput(INPUT, CALL, T0) });
    const events = [env(T0 + 9 * MIN, { hook_event_name: "SessionStart" }), echo];
    expect(rowOf(events, T0 + 11 * MIN).wrap).toMatchObject({ id: CALL, ask: { blocked: true } });
  });

  it("never takes back a call the person already answered", () => {
    const answered = [...stopped(), env(T0 + 2 * MIN, { hook_event_name: "UserPromptSubmit", prompt: "Use DIS-25544" })];
    const late = env(T0 + 3 * MIN, { hook_event_name: "SessionRecapped", recap: null, wrap: wrapFromInput(INPUT, CALL, T0) });
    expect(rowOf([...answered, late], T0 + 4 * MIN).wrap).toBeNull();
  });

  it("is the root's: a subagent's call says nothing", () => {
    const events = [
      env(T0 - 5 * MIN, { hook_event_name: "UserPromptSubmit", prompt: "go" }),
      ...call(T0, INPUT, "toolu_sub", { agent_id: "sub-1" }),
    ];
    expect(rowOf(events).wrap).toBeNull();
  });

  it("keeps it through a long silence, which answers nothing, but not past the session closing", () => {
    expect(rowOf(stopped(), T0 + 5 * 3600_000)).toMatchObject({ state: "ended", wrap: { id: CALL } });
    expect(rowOf([...stopped(), env(T0 + MIN, { hook_event_name: "SessionEnd" })], T0 + 2 * MIN)).toMatchObject({ state: "ended", wrap: null });
  });
});

describe("Waiting on you, for a session stopped on a question", () => {
  const row = (over: object = {}) => ({
    id: SID, name: "Kafka consumer for dashboard audit trail", cwd: "/Users/me/saas-platform", state: "idle", since: T0, lastEventAt: T0,
    waiting: null, wrap: wrapFromInput(INPUT, CALL, T0), ...over,
  });
  const key = `session:${SID}:ask:${CALL}`;

  it("is a decide item naming the question and its answers, linked to the session", () => {
    const s = normaliseStore(null);
    expect(reconcileDeck(s, [row()], [], T0 + MIN)).toBe(true);
    expect(s.items).toEqual([expect.objectContaining({
      key, origin: "deck", kind: "decide", state: "open", title: "Kafka consumer for dashboard audit trail",
      detail: "Which Jira key should the Splunk batching PR carry? (New batching ticket · Use DIS-25544)",
      link: expect.objectContaining({ sessionId: SID }),
    })]);
    // Said once.
    expect(reconcileDeck(s, [row()], [], T0 + 2 * MIN)).toBe(false);
  });

  it("is not one for a question that does not stop the session, nor while a turn runs", () => {
    const s = normaliseStore(null);
    reconcileDeck(s, [row({ wrap: wrapFromInput({ ...INPUT, blocked: false }, CALL, T0) })], [], T0 + MIN);
    reconcileDeck(s, [row({ state: "working" })], [], T0 + MIN);
    expect(s.items).toEqual([]);
  });

  it("falls back to the recap when the question went into the closing message", () => {
    const s = normaliseStore(null);
    reconcileDeck(s, [row({ wrap: wrapFromInput({ recap: "Stuck on Splunk access.", blocked: true }, CALL, T0) })], [], T0 + MIN);
    expect(s.items[0].detail).toBe("Stuck on Splunk access.");
  });

  it("closes when the person answers, and the next question is a new item", () => {
    const s = normaliseStore(null);
    reconcileDeck(s, [row()], [], T0 + MIN);
    expect(reconcileDeck(s, [row({ state: "working", wrap: null })], [], T0 + 2 * MIN)).toBe(true);
    expect(s.items[0]).toMatchObject({ state: "closed", closedBy: "deck", closedReason: "Answered: the session moved on" });
    const next = wrapFromInput({ ...INPUT, ask: "Open the PR now?" }, "toolu_02", T0 + 9 * MIN);
    reconcileDeck(s, [row({ wrap: next })], [], T0 + 10 * MIN);
    expect(s.items.map(i => [i.key, i.state])).toEqual([[key, "closed"], [`session:${SID}:ask:toolu_02`, "open"]]);
  });

  it("stays through a long silence, and closes when the session does", () => {
    const s = normaliseStore(null);
    reconcileDeck(s, [row()], [], T0 + MIN);
    expect(reconcileDeck(s, [row({ state: "ended" })], [], T0 + 5 * 3600_000)).toBe(false);
    expect(s.items[0].state).toBe("open");
    reconcileDeck(s, [row({ state: "ended", wrap: null })], [], T0 + 6 * 3600_000);
    expect(s.items[0]).toMatchObject({ state: "closed", closedReason: "The session ended" });
  });

  it("opens again when the session shows the same question after the deck lost it for a moment", () => {
    // A restart: the rows come back before the transcript has said what the
    // session asked, then it says.
    const s = normaliseStore(null);
    reconcileDeck(s, [row()], [], T0 + MIN);
    reconcileDeck(s, [], [], T0 + 2 * MIN);
    expect(s.items[0]).toMatchObject({ state: "closed", closedReason: "The session is no longer on the board" });
    expect(reconcileDeck(s, [row()], [], T0 + 3 * MIN)).toBe(true);
    expect(s.items).toHaveLength(1);
    expect(s.items[0].state).toBe("open");
  });

  it("stays closed once the person closed it", () => {
    const s = normaliseStore(null);
    reconcileDeck(s, [row()], [], T0 + MIN);
    Object.assign(s.items[0], { state: "closed", closedBy: "hagai", closedReason: "Dismissed", closedAt: T0 + 2 * MIN });
    expect(reconcileDeck(s, [row()], [], T0 + 3 * MIN)).toBe(false);
    expect(s.items[0].state).toBe("closed");
  });

  it("closes with the session archived in the desktop app", () => {
    const s = normaliseStore(null);
    reconcileDeck(s, [row()], [], T0 + MIN);
    reconcileDeck(s, [], [], T0 + 2 * MIN, { archived: new Set([SID]) });
    expect(s.items[0]).toMatchObject({ state: "closed", closedReason: "Archived in Claude Desktop" });
  });
});

describe("the brief's session lines", () => {
  const r = { id: SID, name: "Kafka consumer", project: "saas-platform", state: "idle", since: T0, lastEventAt: T0, waiting: null, wrap: wrapFromInput(INPUT, CALL, T0) };
  const envelopes = [{ payload: { session_id: SID, hook_event_name: "UserPromptSubmit", prompt: "batch the Splunk alerts" } }];

  it("say where the session stands, in its own words, and what it stopped on", () => {
    const [d] = sessionDigest([r], envelopes, { now: T0 + MIN });
    expect(d).toMatchObject({ question: INPUT.ask, recap: INPUT.recap, blocked: true });
    const prompt = buildPrompt({ sessions: [d], reach: { github: "off", slack: "off", jira: "off" }, since: null, now: T0 + MIN });
    expect(prompt).toContain(`stopped until I answer: ${JSON.stringify(INPUT.ask)}`);
    expect(prompt).toContain(`where it stands: ${JSON.stringify(INPUT.recap)}`);
    expect(prompt).not.toContain("last prompt:");
  });

  it("fall back to the last prompt for a session that wrote no call", () => {
    const [d] = sessionDigest([{ ...r, wrap: null }], envelopes, { now: T0 + MIN });
    const prompt = buildPrompt({ sessions: [d], reach: { github: "off", slack: "off", jira: "off" }, since: null, now: T0 + MIN });
    expect(prompt).toContain(`last prompt: ${JSON.stringify("batch the Splunk alerts")}`);
    expect(prompt).not.toContain("stopped until I answer");
  });
});

describe("the page", () => {
  const at = (receivedAt: number, payload: HookPayload): HookEnvelope => ({ seq: ++seq, receivedAt, source: "hook", payload });
  const P = (p: Record<string, unknown>) => ({ session_id: SID, cwd: "/Users/me/saas-platform", ...p }) as HookPayload;
  function resting() {
    let s = applyEvent(initialState(), at(T0 - 6 * MIN, P({ hook_event_name: "SessionStart" })));
    s = applyEvent(s, at(T0 - 5 * MIN, P({ hook_event_name: "UserPromptSubmit", prompt: "batch the Splunk alerts" })));
    s = applyEvent(s, at(T0 + 3 * SEC, P({ hook_event_name: "Stop" })));
    return applyEvent(s, at(T0 + 4 * SEC, P({ hook_event_name: "SessionRecapped", recap: null, wrap: wrapFromInput(INPUT, CALL, T0) })));
  }

  it("keeps the call on the session's root, and the row says it until a prompt answers it", () => {
    const s = resting();
    expect(wrapShown(s.agents.get(SID)!)).toMatchObject({ id: CALL, recap: INPUT.recap });
    const [row] = buildRows(s, T0 + MIN);
    expect(row.wrap?.ask?.question).toBe(INPUT.ask);
    expect(liveState(row)).toBe("waiting");
    const answered = applyEvent(s, at(T0 + 2 * MIN, P({ hook_event_name: "UserPromptSubmit", prompt: "Use DIS-25544" })));
    const [after] = buildRows(answered, T0 + 3 * MIN);
    expect(after.wrap).toBeUndefined();
    expect(liveState(after)).toBe("working");
  });

  it("ignores a malformed wrap and never goes backwards", () => {
    const s = resting();
    const bad = applyEvent(s, at(T0 + MIN, P({ hook_event_name: "SessionRecapped", recap: null, wrap: { at: "soon" } as never })));
    expect(bad.agents.get(SID)!.wrap?.id).toBe(CALL);
    const older = applyEvent(s, at(T0 + MIN, P({ hook_event_name: "SessionRecapped", recap: null, wrap: wrapFromInput({ recap: "older" }, "toolu_00", T0 - MIN) })));
    expect(older.agents.get(SID)!.wrap?.id).toBe(CALL);
  });

  it("does not call a session that left no question waiting", () => {
    let s = resting();
    s = applyEvent(s, at(T0 + MIN, P({ hook_event_name: "SessionRecapped", recap: null, wrap: wrapFromInput({ recap: "Merged." }, "toolu_03", T0 + 30 * SEC) })));
    const [row] = buildRows(s, T0 + 2 * MIN);
    expect(row.wrap?.recap).toBe("Merged.");
    expect(liveState(row)).not.toBe("waiting");
  });
});

describe("the page, after a restart", () => {
  // The deck replays its log into the page. A session resting on its turn
  // sends no hook after the restart, so the transcript cursor says nothing,
  // and the recap must come from the replayed hook (owner, 2026-11-26).
  const at = (receivedAt: number, payload: Record<string, unknown>): HookEnvelope =>
    ({ seq: ++seq, receivedAt, source: "hook", payload: { session_id: SID, cwd: "/Users/me/saas-platform", ...payload } as HookPayload });
  const replay = (extra: object = {}) => [
    at(T0 - 6 * MIN, { hook_event_name: "SessionStart" }),
    at(T0 - 5 * MIN, { hook_event_name: "UserPromptSubmit", prompt: "batch the Splunk alerts" }),
    at(T0 - 200, { hook_event_name: "PreToolUse", tool_name: WRAP_TOOL, tool_use_id: CALL, tool_input: INPUT, ...extra }),
    at(T0, { hook_event_name: "PostToolUse", tool_name: WRAP_TOOL, tool_use_id: CALL, tool_input: INPUT, tool_response: "ok", ...extra }),
    at(T0 + 3 * SEC, { hook_event_name: "Stop" }),
  ];
  const fold = (envs: HookEnvelope[]) => envs.reduce((s, e) => applyEvent(s, e), initialState());

  it("shows the recap and the question from the replayed hook alone", () => {
    const [row] = buildRows(fold(replay()), T0 + MIN);
    expect(row.wrap).toEqual({ id: CALL, at: T0, recap: INPUT.recap, ask: { question: INPUT.ask, choices: ["New batching ticket", "Use DIS-25544"], blocked: true } });
    expect(liveState(row)).toBe("waiting");
  });

  it("keeps the hook's copy when the transcript says the same call later", () => {
    const s = fold([...replay(), at(T0 + MIN, { hook_event_name: "SessionRecapped", recap: null, wrap: wrapFromInput(INPUT, CALL, T0 - 400) })]);
    expect(s.agents.get(SID)!.wrap?.at).toBe(T0);
  });

  it("lets the next prompt retire it, and a subagent's call say nothing", () => {
    const answered = fold([...replay(), at(T0 + 2 * MIN, { hook_event_name: "UserPromptSubmit", prompt: "Use DIS-25544" })]);
    expect(buildRows(answered, T0 + 3 * MIN)[0].wrap).toBeUndefined();
    const sub = fold(replay({ agent_id: "sub-1" }));
    expect(sub.agents.get(SID)!.wrap).toBeUndefined();
  });
});
