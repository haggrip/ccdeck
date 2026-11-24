// The live Todo list's routes, all under /api/status-todo:
//
//   GET  /api/status-todo         the open items, the recently closed, and how
//                                 the keeper last went
//   POST /api/status-todo/say     { text } — the user's own words, for the keeper
//   POST /api/status-todo/item    { action: "close" | "reopen" | "snooze" |
//                                 "unsnooze", id, until? } — the pane's buttons
//   POST /api/status-todo/post    { title, sessionId?, cwd? } — another session's
//                                 item (`ccdeck todo add`); the deck's token only
//
// Every change goes to the open pages as an `event: status-todo` frame on the
// deck's own event stream, the way `event: account` does, so the list is live
// without a reload. The read is a guarded one (request-gates.mjs), and nothing
// here writes anywhere but the deck's own status-todo folder.
import { send, readBody } from "./http-io.mjs";
import { deckDataDir } from "./deck-home.mjs";
import { eventsSince, lastSeq } from "./event-ring.mjs";
import { summarizeSessions } from "./session-summary.mjs";
import { presentsDeckToken } from "./request-gates.mjs";
import { sseClients, trayClients, writeSse } from "./sse-clients.mjs";
import { sessionDigest } from "./status-brief.mjs";
import { createStatusTodo } from "./status-todo.mjs";
import { agentVetoed, runAgent } from "./claude-agent.mjs";

export const STATUS_TODO_ROUTE = "/api/status-todo";

/** The pages' frames, never the desktop app's tray connections. */
export function broadcastTodo(view) {
  const frame = `event: status-todo\ndata: ${JSON.stringify(view)}\n\n`;
  for (const client of sseClients) if (!trayClients.has(client)) writeSse(client, frame);
}

let todo = null;
let seenSeq = -1;
/** The deck's one list, made the first time it is wanted. */
export function statusTodo() {
  todo ??= createStatusTodo({
    dir: deckDataDir(),
    agent: async () => (agentVetoed() ? null : { runAgent }),
    sessions: async () => {
      const envelopes = eventsSince(0);
      const rows = summarizeSessions(envelopes);
      return { rows, digest: sessionDigest(rows, envelopes, { maxRows: 1000 }) };
    },
    changed: async () => {
      const seq = lastSeq();
      if (seq === seenSeq) return false;
      seenSeq = seq;
      return true;
    },
    broadcast: broadcastTodo,
    log: msg => console.warn(`[status-todo] ${msg}`),
  });
  return todo;
}

/** At boot: start watching the deck's sessions for waits that come and go. */
export function startStatusTodo() {
  return statusTodo().start();
}

/** For the suite: a list built on its own directory and fakes. */
export function useStatusTodoForTest(instance) { todo = instance; seenSeq = -1; }

async function bodyOf(req, res) {
  const raw = await readBody(req, res, 8_000).catch(() => null);
  if (raw == null) return null;
  try { return raw ? JSON.parse(raw) : {}; } catch { return undefined; }
}

export async function handleStatusTodo(req, res, url) {
  const t = statusTodo();
  const path = url.pathname;
  if (path === STATUS_TODO_ROUTE) {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method not allowed" });
    return send(res, 200, await t.view());
  }
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  // Only a holder of the deck's token posts as a session: `ccdeck todo add`
  // reads it from the deck's record, and a page has no way to.
  if (path === `${STATUS_TODO_ROUTE}/post` && !presentsDeckToken(req.headers)) return send(res, 403, { ok: false, reason: "token_required" });
  const body = await bodyOf(req, res);
  if (body === null) return;
  if (body === undefined || typeof body !== "object" || Array.isArray(body)) return send(res, 400, { ok: false, reason: "bad_json" });
  if (path === `${STATUS_TODO_ROUTE}/say`) {
    const r = await t.say(body.text);
    return send(res, r.ok ? 200 : 400, { ...(await t.view()), ...r });
  }
  if (path === `${STATUS_TODO_ROUTE}/item`) {
    const r = await t.act(body);
    return send(res, r.ok ? 200 : r.reason === "not_found" ? 404 : 400, { ...(await t.view()), ...r });
  }
  if (path === `${STATUS_TODO_ROUTE}/post`) {
    const r = await t.post({ title: body.title, sessionId: body.sessionId, cwd: body.cwd });
    if (!r.ok) return send(res, r.reason === "too_many" ? 429 : 400, r);
    return send(res, 200, { ok: true, duplicate: r.duplicate === true, item: r.item ?? null });
  }
  return send(res, 404, { error: "not found" });
}
