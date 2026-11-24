// The goal titler: a few words from Haiku over each group on the board, saying
// what the session is FOR (group-titles.mjs keeps them, the board draws them).
//
// It runs through `runAgent` (claude-agent.mjs, the connectors bridge): the
// person's own Claude Code, headless, one run at a time, asked for one JSON
// object, with only read-only connector tools allowed. So a ticket or a pull
// request a session mentions can be read for its title, and nothing can be
// written anywhere. Since the bridge turned every tool on unless the person
// switches it off, the titler never leans on that: it names its tools itself,
// every run, and names only the read-only tools of a Jira, Linear, GitHub or
// Slack connector — never a built-in tool (the shell, files, the web, agents)
// and never one that sends or deletes. A run with nothing to look up names
// none (`tools: []`), so the bridge's "all" default is never reached.
//
// WHEN IT RUNS
//   - for a new group: once a session has said something (a prompt, or a name),
//     after DEBOUNCE_MS of quiet, so a burst of prompts costs one run;
//   - again only when the session's basis changes (goal-context.mjs): another
//     ticket, another branch;
//   - on demand, from the board's button or the Settings row, which skips the
//     wait and the basis check.
//   Never for a group a person has named: their title always wins, and a run
//   for it would be quota spent on words nobody sees.
//
// BOUNDED, so it cannot burn the person's quota: PER_HOUR and PER_DAY runs at
// most, whatever asks; a session whose run failed waits RETRY_MS before the
// next automatic try; and a bridge that says it is off or missing stops the
// automatic runs until the deck restarts.
//
// OFF: the `goalTitles` preference (Settings › Sessions), and the machine veto
// AGENTS_DECK_NO_AGENT=1 that turns the bridge off altogether.
import { contextBasis, contextRefs, goalPrompt, sessionGoalContext } from "./goal-context.mjs";
import { cleanGoalTitle, groupTitleKey } from "./group-titles.mjs";

export const DEBOUNCE_MS = 90_000;
export const PER_HOUR = 30;
export const PER_DAY = 150;
export const RETRY_MS = 30 * 60_000;
export const RUN_TIMEOUT_MS = 90_000;
/** The most one run may cost, passed to the bridge as its hard cap. A title
 *  from Haiku costs a fraction of a cent; reading a ticket a little more. */
export const RUN_BUDGET_USD = 0.1;
/** What the run is called in the bridge's cost ledger. */
export const RUN_TAG = "goal-titles";
/** The answer the bridge holds the model to (its `schema`). */
export const TITLE_SCHEMA = Object.freeze({
  type: "object",
  properties: { title: { type: "string", minLength: 1, maxLength: 80 } },
  required: ["title"],
  additionalProperties: false,
});
/** The most connector tools offered to one run. */
export const MAX_TOOLS = 12;

/** Answers from the bridge that mean it cannot run at all here: no Claude
 *  Code, turned off, or a deck without the bridge. */
const UNAVAILABLE = new Set(["vetoed", "unavailable", "claude_missing", "not_signed_in"]);
/** Answers that refuse the tools, not the run: tried again once with none. */
const TOOL_REFUSALS = new Set(["tool_not_enabled", "tool_unavailable", "tool_violation"]);

/** Which connectors can answer for which references. Matched on the
 *  connector's server name and label. */
const KINDS = [
  { refs: "tickets", match: /jira|atlassian|linear/i },
  { refs: "pulls", match: /github/i },
  { refs: "threads", match: /slack/i },
];

/** A connector tool's full name: `mcp__<server>__<tool>`. Built-in tools
 *  (Bash, Read, WebSearch …) have bare names and never match. */
const CONNECTOR_TOOL = /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_.-]+$/;

/**
 * The read-only tools of the connectors that can read the references the
 * session mentions, at most MAX_TOOLS. None when it mentions none. Only a
 * connector's own tool that the bridge calls read-only is ever offered: the
 * bridge's built-in pseudo-connector is skipped whole, read-only built-ins
 * like Read and WebSearch included, since a title needs neither the files
 * nor the web.
 */
export function pickTools(connectors, refs) {
  const out = [];
  if (!Array.isArray(connectors)) return out;
  for (const kind of KINDS) {
    if (!refs?.[kind.refs]?.length) continue;
    for (const c of connectors) {
      if (!c || c.source === "builtin" || c.server === "builtin") continue;
      if (!kind.match.test(`${c.server ?? ""} ${c.label ?? ""}`)) continue;
      for (const tool of Array.isArray(c.tools) ? c.tools : []) {
        if (tool?.readOnly !== true || typeof tool.name !== "string" || !CONNECTOR_TOOL.test(tool.name)) continue;
        if (!out.includes(tool.name)) out.push(tool.name);
      }
    }
  }
  return out.slice(0, MAX_TOOLS);
}

/** The title in a run's answer: its JSON's `title`, else a bare line of text. */
export function titleFromAnswer(res) {
  const fromJson = res?.json && typeof res.json === "object" ? res.json.title : undefined;
  if (typeof fromJson === "string") return cleanGoalTitle(fromJson);
  if (typeof res?.text === "string") {
    try { const parsed = JSON.parse(res.text); if (typeof parsed?.title === "string") return cleanGoalTitle(parsed.title); } catch { /* not JSON */ }
    const line = res.text.split("\n").map(l => l.trim()).find(Boolean);
    if (line && line.split(/\s+/).length <= 10) return cleanGoalTitle(line);
  }
  return null;
}

/** The connectors in the bridge's Settings state (claude-agent.mjs
 *  connectorsState), each with only the tools that are on: in `enabled`, and
 *  not in `off`, the ones the person switched off in Settings › Connectors.
 *  The bridge refuses a run that names a switched-off tool. */
export function enabledConnectors(state) {
  const on = new Set(Array.isArray(state?.enabled) ? state.enabled : []);
  const off = new Set(Array.isArray(state?.off) ? state.off : []);
  return (Array.isArray(state?.connectors) ? state.connectors : [])
    .map(c => ({ ...c, tools: (Array.isArray(c?.tools) ? c.tools : []).filter(t => on.has(t?.name) && !off.has(t?.name)) }));
}

/**
 * One titler for the deck. Everything it touches is handed in, so tests drive
 * it with a fake runAgent and a fake clock.
 */
export function createGoalTitler({
  run = async () => ({ ok: false, code: "unavailable", error: "no runAgent was given" }),
  connectors = async () => [],
  envelopes,
  readBranch = async () => null,
  enabled = () => true,
  titlesFor,
  writeTitle,
  announce,
  now = Date.now,
  setTimer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clearTimer = t => clearTimeout(t),
  debounceMs = DEBOUNCE_MS,
  perHour = PER_HOUR,
  perDay = PER_DAY,
  retryMs = RETRY_MS,
  log = () => {},
} = {}) {
  const timers = new Map();       // sid -> debounce timer
  const queue = [];               // [{ provider, sid, force, done: [resolve] }]
  const failedAt = new Map();     // sid -> when its last run failed
  const runs = [];                // when each run started, newest last
  let running = null;             // sid of the run in flight
  let unavailable = false;        // the bridge said it cannot run here
  let idle = Promise.resolve();

  // A run counts against the hour and the day it started in, and stops
  // counting the moment it is a full hour (or day) old.
  const prune = () => { const day = now() - 86_400_000; while (runs.length && runs[0] <= day) runs.shift(); };
  const budgetLeft = () => {
    prune();
    const hour = now() - 3_600_000;
    return Math.max(0, Math.min(perHour - runs.filter(t => t > hour).length, perDay - runs.length));
  };
  const personNamed = (provider, sid) => !!titlesFor(provider, sid)?.name;
  const queued = sid => running === sid || queue.some(j => j.sid === sid);

  /** Queue a run, or join the one already queued for the session. Answers
   *  the run's outcome once it has happened. */
  function enqueue(provider, sid, force) {
    return new Promise(resolve => {
      const at = queue.find(j => j.sid === sid);
      if (at) { at.force ||= force; at.done.push(resolve); return; }
      queue.push({ provider, sid, force, done: [resolve] });
      if (!running) idle = drain();
    });
  }

  async function drain() {
    while (queue.length) {
      const job = queue.shift();
      running = job.sid;
      let outcome;
      try { outcome = await runOne(job); }
      catch (err) {
        log(`goal title failed (${err?.code ?? err?.name ?? "error"})`);
        failedAt.set(job.sid, now());
        outcome = { ok: false, reason: "failed" };
      } finally { running = null; }
      for (const resolve of job.done) resolve(outcome);
    }
  }

  /** One run, and what came of it: `{ ok: true, title }`, or `{ ok: false,
   *  reason }` with reason one of off, named, empty, same, budget,
   *  unavailable, failed. */
  async function runOne({ provider, sid, force }) {
    if (!enabled()) return { ok: false, reason: "off" };
    if (personNamed(provider, sid)) return { ok: false, reason: "named" };
    if (!force && unavailable) return { ok: false, reason: "unavailable" };
    const ctx = sessionGoalContext(envelopes(), sid);
    if (!ctx) return { ok: false, reason: "empty" };
    if (ctx.transcriptPath) {
      try { ctx.gitBranch = (await readBranch(ctx.transcriptPath)) || null; } catch { ctx.gitBranch = null; }
    }
    const basis = contextBasis(ctx);
    const held = titlesFor(provider, sid);
    if (!force && held?.auto && held.basis === basis) return { ok: false, reason: "same" };
    if (budgetLeft() <= 0) { log("goal titles: the hourly or daily budget is spent"); return { ok: false, reason: "budget" }; }
    let tools = [];
    const refs = contextRefs(ctx);
    if (refs.tickets.length || refs.pulls.length || refs.threads.length) {
      try { tools = pickTools(await connectors(), refs); } catch { tools = []; }
    }
    const ask = picked => {
      runs.push(now());
      // Always an explicit list, never left out: the bridge reads a missing
      // `tools` as "every tool that is on", the shell included.
      const list = Array.isArray(picked) ? picked.filter(t => typeof t === "string" && CONNECTOR_TOOL.test(t)) : [];
      return run({ prompt: goalPrompt(ctx, { tools: list }), model: "haiku", tools: list, timeoutMs: RUN_TIMEOUT_MS, schema: TITLE_SCHEMA, maxBudgetUsd: RUN_BUDGET_USD, tag: RUN_TAG });
    };
    let res = await ask(tools);
    // The tools were refused (turned off, or the connector is not connected
    // now), not the run: the session's own words still make a title.
    if (!res?.ok && tools.length && TOOL_REFUSALS.has(res?.code) && budgetLeft() > 0) res = await ask([]);
    if (!res?.ok) {
      failedAt.set(sid, now());
      const gone = UNAVAILABLE.has(res?.code);
      if (gone) unavailable = true;
      log(`goal title not written (${res?.code ?? "error"})`);
      return { ok: false, reason: gone ? "unavailable" : "failed" };
    }
    const title = titleFromAnswer(res);
    if (!title) { failedAt.set(sid, now()); return { ok: false, reason: "failed" }; }
    // A person may have named the group while the run was out: theirs wins,
    // and the automatic title is still kept for when they clear it.
    const kept = await writeTitle(provider, sid, title, { basis });
    failedAt.delete(sid);
    unavailable = false;
    announce(sid, { goalTitle: kept });
    return { ok: true, title: kept };
  }

  return {
    /** A live event from a session: arm its debounce when it says something a
     *  title could come from. The deck's own name announcements do not count. */
    note(payload, provider = "claude") {
      const sid = payload?.session_id;
      if (typeof sid !== "string" || !groupTitleKey(provider, sid)) return;
      const name = payload.hook_event_name;
      const says = name === "UserPromptSubmit" && !payload.agent_id
        || name === "SessionNamed" && ("sessionName" in payload || "sessionTitle" in payload);
      if (!says || !enabled() || unavailable || personNamed(provider, sid)) return;
      if (now() - (failedAt.get(sid) ?? -Infinity) < retryMs) return;
      const prev = timers.get(sid);
      if (prev) clearTimer(prev);
      timers.set(sid, setTimer(() => { timers.delete(sid); void enqueue(provider, sid, false); }, debounceMs));
    },
    /** Title one group now: the board's button. Answers once the run is done,
     *  with the title, or why there is none. */
    async request(provider, sid) {
      if (!groupTitleKey(provider, sid)) return { ok: false, reason: "bad_request" };
      if (!enabled()) return { ok: false, reason: "off" };
      if (personNamed(provider, sid)) return { ok: false, reason: "named" };
      if (budgetLeft() <= 0) return { ok: false, reason: "budget" };
      const prev = timers.get(sid);
      if (prev) { clearTimer(prev); timers.delete(sid); }
      return enqueue(provider, sid, true);
    },
    /** Title every group on the board that no person has named. Answers at
     *  once with how many were queued; the titles arrive as they are written. */
    requestAll(sessions) {
      if (!enabled()) return { ok: false, reason: "off" };
      if (budgetLeft() <= 0) return { ok: false, reason: "budget" };
      let n = 0;
      for (const { provider, sid } of sessions) {
        if (!groupTitleKey(provider, sid) || personNamed(provider, sid)) continue;
        void enqueue(provider, sid, true);
        n++;
      }
      return { ok: true, queued: n };
    },
    /** What the Settings row and the button say. */
    status() {
      return { enabled: !!enabled(), available: !unavailable, running: running != null, queued: queue.length, budget: budgetLeft() };
    },
    isQueued: queued,
    /** Tests: wait for the queue to empty. */
    settle() { return idle; },
    /** Stop every timer, for a deck going down. */
    stop() { for (const t of timers.values()) clearTimer(t); timers.clear(); queue.length = 0; },
  };
}
