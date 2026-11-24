// GET /api/remote-control — the person's Remote Control sessions on the
// machines they named (remote-control-sessions.mjs), read-only. A guarded read,
// and this computer only: which sessions run where is the person's own.
//
// The module is imported lazily, by the package-root URL, as connectors-routes
// imports the agent: a deck nobody asks never loads it.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { send } from "./http-io.mjs";

export const REMOTE_CONTROL_ROUTE = "/api/remote-control";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const loopback = req => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket?.remoteAddress);

export async function handleRemoteControlRead(req, res, source = null) {
  if (!loopback(req)) return send(res, 403, { ok: false, error: "Remote Control sessions can be seen on this computer only." });
  const { remoteControlState } = source ?? await import(pathToFileURL(join(PKG_ROOT, "src/server/remote-control-sessions.mjs")).href);
  return send(res, 200, { ok: true, ...(await remoteControlState()) });
}
