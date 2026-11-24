// The deck's one follower of in-process /resume (resume-rebind.mjs), and its
// two routes, under the Command Panel's switch:
//
//   GET  /api/terminal/twins        sessions two or more live deck terminals hold
//   POST /api/terminal/twins/close  { sessionId }: close all of one session's
//                                   terminals but the newest, as a person asked
//
// Switched off, both answer index.mjs's own 404 for a path with no route, as
// every terminal route does (terminal-routes.mjs). The read is in
// GUARDED_READS; the close is a mutation and takes the same-origin gate.
import { PRODUCT } from "./brand.mjs";
import { terminalOn } from "./deck-prefs.mjs";
import { readBody, send } from "./http-io.mjs";
import { heldPrefs } from "./prefs-state.mjs";
import { createResumeRebind } from "./resume-rebind.mjs";

const BODY_LIMIT = 4 * 1024;

export const resumeRebind = createResumeRebind({
  enabled: () => terminalOn(heldPrefs.current()),
  log: (line) => console.log(`${PRODUCT}: ${line}`),
});

/** For event-pipeline's pushEvent: a live hook event, never a replay. */
export function noteResumeRebind(raw, at) {
  try { resumeRebind.observe(raw, at); } catch { /* the event goes on */ }
}

function notFound(res) {
  return send(res, 404, { error: "not found" });
}

/** GET /api/terminal/twins → `{ ok: true, twins: [{ sessionId, count, newestAt, olderAt }] }`. */
export async function handleTerminalTwins(_req, res, options = {}) {
  const rebind = options.resumeRebind ?? resumeRebind;
  const enabled = options.enabled ?? (() => terminalOn(heldPrefs.current()));
  if (!enabled()) return notFound(res);
  try {
    return send(res, 200, { ok: true, twins: await rebind.twins() });
  } catch {
    return send(res, 503, { ok: false, code: "no-answer" });
  }
}

/** POST /api/terminal/twins/close `{ sessionId }` → `{ ok: true, closed }`, or
 *  `{ ok: false, code }`: `bad-request`, `no-twins` (there is one terminal, or
 *  none, by now), `no-answer` (tmux did not answer). */
export async function handleTerminalTwinsClose(req, res, options = {}) {
  const rebind = options.resumeRebind ?? resumeRebind;
  const enabled = options.enabled ?? (() => terminalOn(heldPrefs.current()));
  if (!enabled()) return notFound(res);
  let raw;
  try { raw = await readBody(req, res, BODY_LIMIT); } catch { return; } // answered 413 already
  if (!enabled()) return notFound(res);
  let sessionId = null;
  try {
    const body = JSON.parse(raw);
    if (body && typeof body === "object" && typeof body.sessionId === "string") sessionId = body.sessionId;
  } catch {}
  if (sessionId === null) return send(res, 400, { ok: false, code: "bad-request" });
  let out;
  try { out = await rebind.closeOlder(sessionId); } catch { return send(res, 503, { ok: false, code: "no-answer" }); }
  if (out.ok) return send(res, 200, out);
  return send(res, out.code === "bad-request" ? 400 : 409, out);
}
