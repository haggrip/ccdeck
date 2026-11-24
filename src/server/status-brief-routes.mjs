// The Status pane's four routes, all under /api/status-brief:
//
//   GET  /api/status-brief           the cached brief, its time, whether one is
//                                    running, the pane's settings and people
//   POST /api/status-brief/refresh   { auto?: boolean } — ask for a run; `auto`
//                                    is the page's interval and runs only when due
//   POST /api/status-brief/settings  { model?, everyMinutes?, sources? }
//   POST /api/status-brief/people    { action: "pin" | "hide" | "clear", person?, key? }
//
// The read is a guarded one (request-gates.mjs GUARDED_READS): it carries what
// the user's Slack, GitHub and Jira said, so only the deck's own page or a
// holder of the deck's token reads it. The three POSTs pass the mutation gates
// every POST does. None of them writes anywhere but the deck's own
// status-brief.json: the brief itself is read-only (status-brief.mjs).
import { send, readBody } from "./http-io.mjs";
import { deckDataDir } from "./deck-home.mjs";
import { eventsSince } from "./event-ring.mjs";
import { summarizeSessions } from "./session-summary.mjs";
import { createStatusBrief } from "./status-brief.mjs";
import { statusTodo } from "./status-todo-routes.mjs";
// The shared contract: the user's own Claude Code, headless, read-only.
import { agentVetoed, connectorsState, listConnectors, runAgent } from "./claude-agent.mjs";

export const STATUS_BRIEF_ROUTE = "/api/status-brief";

/** The shared contract (claude-agent.mjs), or null where AGENTS_DECK_NO_AGENT=1
 *  vetoes it: the pane then draws the deck's own sessions and says the brief
 *  is off, and nothing is run. */
export function loadAgent(env = process.env) {
  return Promise.resolve(agentVetoed(env) ? null : { runAgent, listConnectors, connectorsState });
}

let brief = null;
function statusBrief() {
  brief ??= createStatusBrief({
    dir: deckDataDir(),
    agent: () => loadAgent(),
    sessions: async () => {
      const envelopes = eventsSince(0);
      return { rows: summarizeSessions(envelopes), envelopes };
    },
    todo: statusTodo(),
    log: msg => console.warn(`[status-brief] ${msg}`),
  });
  return brief;
}

/** For the suite: a store built on its own directory and fakes. */
export function useStatusBriefForTest(instance) { brief = instance; }

async function bodyOf(req, res) {
  const raw = await readBody(req, res, 16_000).catch(() => null);
  if (raw == null) return null;
  try { return raw ? JSON.parse(raw) : {}; } catch { return undefined; }
}

export async function handleStatusBrief(req, res, url) {
  const b = statusBrief();
  const path = url.pathname;
  if (path === STATUS_BRIEF_ROUTE) {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method not allowed" });
    return send(res, 200, await b.view());
  }
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  const body = await bodyOf(req, res);
  if (body === null) return; // readBody answered (413) already
  if (body === undefined || typeof body !== "object" || Array.isArray(body)) return send(res, 400, { error: "bad json" });
  if (path === `${STATUS_BRIEF_ROUTE}/refresh`) {
    const outcome = await b.refresh({ auto: body.auto === true });
    return send(res, 200, { ...(await b.view()), outcome });
  }
  if (path === `${STATUS_BRIEF_ROUTE}/settings`) {
    await b.setSettings(body);
    return send(res, 200, await b.view());
  }
  if (path === `${STATUS_BRIEF_ROUTE}/people`) {
    const people = await b.setPerson(body);
    if (!people) return send(res, 400, { error: "bad person" });
    return send(res, 200, await b.view());
  }
  return send(res, 404, { error: "not found" });
}
