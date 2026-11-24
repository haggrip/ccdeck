// The goal titler (goal-titler.mjs), driven with a fake runAgent that keeps
// the shared contract — `runAgent({ prompt, model, tools, timeoutMs })`
// resolving to `{ ok: true, json, text, usage }` or `{ ok: false, code, error }`
// — a fake clock and timers fired by hand. Nothing here spawns Claude Code.
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — plain .mjs server module, no types
import * as gt from "../../server/goal-titler.mjs";

const SID = "0b9a2f7e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const SID2 = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

type Entry = { name?: string; auto?: string; basis?: string };
type RunArgs = { prompt: string; model: string; tools: string[]; timeoutMs: number };

function rig({ answer = { ok: true, json: { title: "Fix billing retry loop" }, text: "", usage: {} } as unknown, enabled = true, perHour = 30, perDay = 150, branch = null as string | null } = {}) {
  let clock = 1_000_000;
  const timers: Array<{ fn: () => void; at: number; live: boolean }> = [];
  const held = new Map<string, Entry>();
  const ring: Array<{ payload: Record<string, unknown> }> = [];
  const announced: Array<[string, unknown]> = [];
  const runs: RunArgs[] = [];
  let reply = answer;
  let gate: Promise<void> | null = null;
  const run = vi.fn(async (args: RunArgs) => { runs.push(args); if (gate) await gate; return typeof reply === "function" ? (reply as (a: RunArgs) => unknown)(args) : reply; });
  const titler = gt.createGoalTitler({
    run,
    connectors: async () => [
      { server: "claude_ai_Atlassian", label: "Jira", tools: [{ name: "mcp__claude_ai_Atlassian__getJiraIssue", readOnly: true }, { name: "mcp__claude_ai_Atlassian__editJiraIssue", readOnly: false }] },
      { server: "github", label: "GitHub", tools: [{ name: "mcp__github__get_pull_request", readOnly: true }] },
      { server: "claude_ai_Slack", label: "Slack", tools: [{ name: "mcp__claude_ai_Slack__slack_read_thread", readOnly: true }, { name: "mcp__claude_ai_Slack__slack_send_message", readOnly: false }] },
    ],
    envelopes: () => ring,
    readBranch: async () => branch,
    enabled: () => enabled,
    titlesFor: (_p: string, sid: string) => held.get(sid),
    writeTitle: async (_p: string, sid: string, title: string, { basis }: { basis: string }) => { held.set(sid, { ...held.get(sid), auto: title, basis }); return title; },
    announce: (sid: string, fields: unknown) => announced.push([sid, fields]),
    now: () => clock,
    setTimer: (fn: () => void, ms: number) => { const t = { fn, at: clock + ms, live: true }; timers.push(t); return t; },
    clearTimer: (t: { live: boolean }) => { t.live = false; },
    perHour, perDay,
  });
  return {
    titler, run, runs, held, ring, announced,
    say(sid: string, prompt: string, extra: Record<string, unknown> = {}) {
      const p = { hook_event_name: "UserPromptSubmit", session_id: sid, prompt, cwd: "/dev/web-app", transcript_path: `/t/${sid}.jsonl`, ...extra };
      ring.push({ payload: p });
      titler.note(p, "claude");
    },
    /** Move the clock and fire every live timer that came due. */
    async advance(ms: number) {
      clock += ms;
      for (const t of timers) if (t.live && t.at <= clock) { t.live = false; t.fn(); }
      await titler.settle();
      await new Promise(r => setTimeout(r, 0));
      await titler.settle();
    },
    setReply(r: unknown) { reply = r; },
    hold() { let open!: () => void; gate = new Promise(r => { open = r; }); return () => { gate = null; open(); }; },
    pendingTimers: () => timers.filter(t => t.live).length,
  };
}

describe("a new group", () => {
  it("is titled once after the quiet, however many prompts arrived in the burst", async () => {
    const r = rig();
    r.say(SID, "Look at ABC-1234: billing retry loops forever");
    r.say(SID, "also check the invoice side");
    r.say(SID, "go");
    expect(r.pendingTimers()).toBe(1);
    await r.advance(gt.DEBOUNCE_MS - 1);
    expect(r.run).not.toHaveBeenCalled();
    await r.advance(1);
    expect(r.run).toHaveBeenCalledTimes(1);
    expect(r.runs[0].model).toBe("haiku");
    expect(r.runs[0].timeoutMs).toBe(gt.RUN_TIMEOUT_MS);
    expect(r.announced).toEqual([[SID, { goalTitle: "Fix billing retry loop" }]]);
    expect(r.held.get(SID)?.auto).toBe("Fix billing retry loop");
  });

  it("offers only the read-only tools of the connectors that can read what the session mentions", async () => {
    const r = rig();
    r.say(SID, "ABC-1234 and https://github.com/o/r/pull/9");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.runs[0].tools).toEqual(["mcp__claude_ai_Atlassian__getJiraIssue", "mcp__github__get_pull_request"]);
    expect(r.runs[0].prompt).toContain("Tickets mentioned: ABC-1234");
  });

  it("offers no tools at all to a session that mentions nothing to look up", async () => {
    const r = rig();
    r.say(SID, "explore the radar code");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.runs[0].tools).toEqual([]);
  });

  it("is told the branch Claude Code recorded, and a ticket in it", async () => {
    const r = rig({ branch: "abc-77-dark-mode" });
    r.say(SID, "keep going");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.runs[0].prompt).toContain("Git branch: abc-77-dark-mode");
    expect(r.runs[0].tools).toEqual(["mcp__claude_ai_Atlassian__getJiraIssue"]);
  });
});

describe("what keeps it from running", () => {
  it("never runs for a group a person has named: their title always wins", async () => {
    const r = rig();
    r.held.set(SID, { name: "Mine" });
    r.say(SID, "ABC-1");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.run).not.toHaveBeenCalled();
    expect(await r.titler.request("claude", SID)).toEqual({ ok: false, reason: "named" });
  });

  it("does not write again while the basis is the same, and does when the session moves to another ticket", async () => {
    const r = rig();
    r.say(SID, "Look at ABC-1234");
    await r.advance(gt.DEBOUNCE_MS);
    r.say(SID, "keep going on it");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.run).toHaveBeenCalledTimes(1);
    r.say(SID, "now WEB-9 instead");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.run).toHaveBeenCalledTimes(2);
  });

  it("stays off while the setting is off", async () => {
    const r = rig({ enabled: false });
    r.say(SID, "ABC-1");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.run).not.toHaveBeenCalled();
    expect(await r.titler.request("claude", SID)).toEqual({ ok: false, reason: "off" });
  });

  it("holds to its hourly budget whatever asks, and comes back an hour later", async () => {
    const r = rig({ perHour: 2 });
    const sids = [SID, SID2, "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a"];
    for (const sid of sids) r.say(sid, `work on ${sid}`);
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.run).toHaveBeenCalledTimes(2);
    expect(await r.titler.request("claude", sids[2])).toEqual({ ok: false, reason: "budget" });
    expect(r.titler.status().budget).toBe(0);
    await r.advance(3_600_000);
    expect((await r.titler.request("claude", sids[2])).ok).toBe(true);
  });

  it("stops the automatic runs when the bridge says it cannot run here, until a run works again", async () => {
    const r = rig({ answer: { ok: false, code: "unavailable", error: "no bridge" } });
    r.say(SID, "one");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.titler.status().available).toBe(false);
    r.say(SID2, "two");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.run).toHaveBeenCalledTimes(1);
    // A press still tries, and a run that works lifts the stop.
    r.setReply({ ok: true, json: { title: "Two" } });
    expect(await r.titler.request("claude", SID2)).toEqual({ ok: true, title: "Two" });
    expect(r.titler.status().available).toBe(true);
  });

  it("waits RETRY_MS before trying a failed session again by itself", async () => {
    const r = rig({ answer: { ok: false, code: "timeout", error: "slow" } });
    r.say(SID, "one");
    await r.advance(gt.DEBOUNCE_MS);
    r.say(SID, "two");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.run).toHaveBeenCalledTimes(1);
    await r.advance(gt.RETRY_MS);
    r.setReply({ ok: true, json: { title: "Fixed" } });
    r.say(SID, "three");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.run).toHaveBeenCalledTimes(2);
  });

  it("does not arm for the deck's own name announcements", () => {
    const r = rig();
    r.titler.note({ hook_event_name: "SessionNamed", session_id: SID, deckName: "x" }, "claude");
    r.titler.note({ hook_event_name: "SessionNamed", session_id: SID, goalTitle: "x" }, "claude");
    expect(r.pendingTimers()).toBe(0);
    r.titler.note({ hook_event_name: "SessionNamed", session_id: SID, sessionTitle: "Real title" }, "claude");
    expect(r.pendingTimers()).toBe(1);
  });
});

describe("on demand", () => {
  it("skips the wait and the basis check, and answers with the title once written", async () => {
    const r = rig();
    r.say(SID, "ABC-1");
    await r.advance(gt.DEBOUNCE_MS);
    r.setReply({ ok: true, json: { title: "Better title" } });
    expect(await r.titler.request("claude", SID)).toEqual({ ok: true, title: "Better title" });
    expect(r.run).toHaveBeenCalledTimes(2);
  });

  it("answers empty for a session the ring has nothing on", async () => {
    const r = rig();
    expect(await r.titler.request("claude", SID)).toEqual({ ok: false, reason: "empty" });
    expect(r.run).not.toHaveBeenCalled();
  });

  it("runs one at a time, and a second ask for a queued group joins the first", async () => {
    const r = rig();
    r.say(SID, "one");
    r.say(SID2, "two");
    const open = r.hold();
    const a = r.titler.request("claude", SID);
    const b = r.titler.request("claude", SID2);
    const b2 = r.titler.request("claude", SID2);
    await new Promise(res => setTimeout(res, 0));
    expect(r.run).toHaveBeenCalledTimes(1);
    expect(r.titler.status()).toMatchObject({ running: true, queued: 1 });
    open();
    expect((await a).ok).toBe(true);
    expect(await b).toEqual(await b2);
    expect(r.run).toHaveBeenCalledTimes(2);
  });

  it("titles every group no person has named, and leaves a named one alone", async () => {
    const r = rig();
    r.say(SID, "one");
    r.say(SID2, "two");
    r.held.set(SID2, { name: "Mine" });
    expect(r.titler.requestAll([{ provider: "claude", sid: SID }, { provider: "claude", sid: SID2 }, { provider: "opencode", sid: "x" }])).toEqual({ ok: true, queued: 1 });
    await r.advance(0);
    expect(r.run).toHaveBeenCalledTimes(1);
  });
});

describe("the answer", () => {
  it("reads the title off the JSON, or off a short line of text, and cleans it", () => {
    expect(gt.titleFromAnswer({ ok: true, json: { title: '"Ship dark mode."' } })).toBe("Ship dark mode");
    expect(gt.titleFromAnswer({ ok: true, text: '{"title":"From text"}' })).toBe("From text");
    expect(gt.titleFromAnswer({ ok: true, text: "Plain few words\n" })).toBe("Plain few words");
    expect(gt.titleFromAnswer({ ok: true, text: "a ".repeat(40) })).toBeNull();
    expect(gt.titleFromAnswer({ ok: true, json: { nope: 1 } })).toBeNull();
  });

  it("writes nothing for a run that answered no title", async () => {
    const r = rig({ answer: { ok: true, json: {}, text: "" } });
    r.say(SID, "one");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.held.get(SID)).toBeUndefined();
    expect(r.announced).toEqual([]);
  });
});

describe("on the bridge's contract", () => {
  it("asks for the title as a schema, with a cost cap and its own name in the ledger", async () => {
    const r = rig();
    r.say(SID, "one");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.run.mock.calls[0][0]).toMatchObject({ schema: gt.TITLE_SCHEMA, maxBudgetUsd: gt.RUN_BUDGET_USD, tag: "goal-titles" });
  });

  it("tries once more with no tools when the tools are refused, not the run", async () => {
    const r = rig({ answer: (a: RunArgs) => a.tools.length ? { ok: false, code: "tool_not_enabled", error: "turn it on" } : { ok: true, json: { title: "From words alone" } } });
    r.say(SID, "Look at ABC-1234");
    await r.advance(gt.DEBOUNCE_MS);
    expect(r.runs.map(x => x.tools.length > 0)).toEqual([true, false]);
    expect(r.held.get(SID)?.auto).toBe("From words alone");
  });

  it("takes a missing or signed-out Claude Code as unavailable", async () => {
    for (const code of ["claude_missing", "not_signed_in", "vetoed"]) {
      const r = rig({ answer: { ok: false, code, error: "" } });
      expect(await (r.say(SID, "one"), r.titler.request("claude", SID))).toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("offers only the tools the person turned on in Settings › Connectors", () => {
    const state = {
      enabled: ["mcp__claude_ai_Atlassian__getJiraIssue"],
      connectors: [{ server: "claude_ai_Atlassian", label: "Atlassian", tools: [
        { name: "mcp__claude_ai_Atlassian__getJiraIssue", readOnly: true },
        { name: "mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql", readOnly: true },
      ] }],
    };
    const conns = gt.enabledConnectors(state);
    expect(gt.pickTools(conns, { tickets: ["ABC-1"], pulls: [], threads: [] })).toEqual(["mcp__claude_ai_Atlassian__getJiraIssue"]);
    expect(gt.enabledConnectors(null)).toEqual([]);
  });
});

describe("under the bridge's all-on contract (every tool on unless switched off)", () => {
  // connectorsState() as the bridge now answers it: the built-in tools as a
  // pseudo-connector first, every tool in `enabled` unless switched off.
  const state = {
    connectors: [
      { server: "builtin", label: "Claude Code", source: "builtin", tools: [
        { name: "Bash", readOnly: false }, { name: "Edit", readOnly: false }, { name: "Read", readOnly: true },
        { name: "WebSearch", readOnly: true }, { name: "Task", readOnly: false },
      ] },
      { server: "claude_ai_Slack", label: "Slack", source: "claudeai", tools: [
        { name: "mcp__claude_ai_Slack__slack_read_thread", readOnly: true },
        { name: "mcp__claude_ai_Slack__slack_send_message", readOnly: false },
        { name: "mcp__claude_ai_Slack__slack_search_public", readOnly: true },
      ] },
      // A connector whose name happens to match a kind and lists a bare name.
      { server: "github-local", label: "GitHub", source: "local", tools: [{ name: "Read", readOnly: true }, { name: "mcp__github-local__get_pull_request", readOnly: true }] },
    ],
    enabled: ["Bash", "Edit", "Read", "WebSearch", "Task", "mcp__claude_ai_Slack__slack_read_thread", "mcp__claude_ai_Slack__slack_send_message", "mcp__github-local__get_pull_request"],
    off: ["mcp__claude_ai_Slack__slack_search_public"],
  };
  const everything = { tickets: ["ABC-1"], pulls: ["https://github.com/acme/web-app/pull/42"], threads: ["https://acme.slack.com/archives/C1/p1700000000000000"] };

  it("offers no built-in tool, read-only ones included, nothing that sends, and nothing switched off", () => {
    const picked = gt.pickTools(gt.enabledConnectors(state), everything);
    expect(picked).toEqual(["mcp__github-local__get_pull_request", "mcp__claude_ai_Slack__slack_read_thread"]);
    for (const name of ["Bash", "Edit", "Read", "WebSearch", "Task", "mcp__claude_ai_Slack__slack_send_message", "mcp__claude_ai_Slack__slack_search_public"]) {
      expect(picked, name).not.toContain(name);
    }
  });

  it("always names its tools: an empty list when there is nothing to look up, never the bridge's 'all'", async () => {
    const r = rig();
    r.say(SID, "explore the radar code");
    await r.advance(gt.DEBOUNCE_MS);
    expect(Array.isArray(r.runs[0].tools)).toBe(true);
    expect(r.runs[0].tools).toEqual([]);
    expect(r.run.mock.calls[0][0]).toHaveProperty("tools");
  });
});

describe("pickTools", () => {
  it("never offers a write-capable tool, and caps the list", () => {
    const tools = Array.from({ length: 30 }, (_, i) => ({ name: `mcp__jira__read_${i}`, readOnly: true }));
    const picked = gt.pickTools([{ server: "jira", label: "Jira", tools: [...tools, { name: "mcp__jira__delete", readOnly: false }, { name: "mcp__jira__maybe" }] }], { tickets: ["ABC-1"], pulls: [], threads: [] });
    expect(picked).toHaveLength(gt.MAX_TOOLS);
    expect(picked).not.toContain("mcp__jira__delete");
    expect(picked).not.toContain("mcp__jira__maybe");
    expect(gt.pickTools(null, { tickets: ["ABC-1"] })).toEqual([]);
  });
});
