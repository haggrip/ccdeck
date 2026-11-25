// GET /api/remote-control — the person's Remote Control sessions on the
// machines they named (remote-control-sessions.mjs), read-only. A guarded read,
// and this computer only: which sessions run where is the person's own.
//
// The module is imported lazily, by the package-root URL, as connectors-routes
// imports the agent: a deck nobody asks never loads it.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readBody, send } from "./http-io.mjs";

export const REMOTE_CONTROL_ROUTE = "/api/remote-control";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const loopback = req => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket?.remoteAddress);

export async function handleRemoteControlRead(req, res, source = null) {
  if (!loopback(req)) return send(res, 403, { ok: false, error: "Remote Control sessions can be seen on this computer only." });
  const { remoteControlState } = source ?? await import(pathToFileURL(join(PKG_ROOT, "src/server/remote-control-sessions.mjs")).href);
  return send(res, 200, { ok: true, ...(await remoteControlState()) });
}

export const DESKTOP_SESSIONS_ROUTE = "/api/desktop-sessions";

/** GET /api/desktop-sessions — which of this computer's sessions the Claude
 *  desktop app runs, as `links` { cliSessionId: local_id }, and which it has
 *  archived, as `archived` [cliSessionId] (desktop-sessions.mjs). The same
 *  guarded, this-computer-only read. */
export const DESKTOP_OPEN_ROUTE = "/api/desktop-sessions/open";

/** POST /api/desktop-sessions/open { sessionId } — brings that session up in
 *  the Claude desktop app (desktop-sessions.mjs openInDesktop). The deck builds
 *  the link from the app's own files; the page names only the session. Behind
 *  the deck's mutation gate, and this computer only. */
export async function handleDesktopOpen(req, res, source = null) {
  if (!loopback(req)) return send(res, 403, { ok: false, error: "This computer only." });
  const raw = await readBody(req, res, 2_000).catch(() => null);
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  const { openInDesktop, openRemoteInDesktop } = source ?? await import(pathToFileURL(join(PKG_ROOT, "src/server/desktop-sessions.mjs")).href);
  // A Remote Control session by its claude.ai id, else a local one by its
  // Claude Code session id.
  const out = body && typeof body.remote === "string"
    ? await openRemoteInDesktop(body.remote)
    : await openInDesktop(body?.sessionId);
  return send(res, out.ok ? 200 : out.error === "open-failed" ? 502 : 404, out);
}

export async function handleDesktopSessionsRead(req, res, source = null) {
  if (!loopback(req)) return send(res, 403, { ok: false, error: "Desktop sessions can be seen on this computer only." });
  const { desktopSessionsState } = source ?? await import(pathToFileURL(join(PKG_ROOT, "src/server/desktop-sessions.mjs")).href);
  return send(res, 200, { ok: true, ...(await desktopSessionsState()) });
}
