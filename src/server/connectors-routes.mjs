// Settings › Connectors' routes (claude-agent.mjs): what the person's Claude
// Code reaches, which read-only tools are turned on, and the ledger of the
// agent's last runs; and the one write, which tools are on.
//
//   GET  /api/connectors[?refresh=1]  the listing (cached ten minutes; refresh
//                                     lists again, at most once a minute), the
//                                     enabled tools, the runs
//   POST /api/connectors {tools}      turn on exactly these tools; a name that
//                                     is not a read-only tool of the latest
//                                     listing is dropped and named in `refused`
//
// A guarded read (request-gates.mjs): which services the person is connected
// to is theirs, and the only caller is the deck's own page. Listing starts the
// person's Claude Code but sends it no prompt, so it costs nothing of the
// plan; what a forced listing does cost — a Claude Code process for a few
// seconds — is held to one a minute by claude-agent.mjs's floor (mayForceList).
//
// The bridge is imported lazily, by the package-root URL, the way
// browser-watch-routes.mjs imports its module: a deck that never opens the
// section never loads it.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readBody, send } from "./http-io.mjs";

export const CONNECTORS_ROUTE = "/api/connectors";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// This computer only, a read as well as a write, as claude-settings-routes.mjs
// holds Claude Code's own settings: what the person's connectors reach is
// theirs, and so is which of them the deck may read with.
const loopback = req => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket?.remoteAddress);
const refuseRemote = res => send(res, 403, { ok: false, error: "Connectors can be seen and changed on this computer only." });

export async function handleConnectorsRead(req, res, url, agent = null) {
  if (!loopback(req)) return refuseRemote(res);
  const force = url.searchParams.get("refresh") === "1";
  const { connectorsState } = agent ?? await import(pathToFileURL(join(PKG_ROOT, "src/server/claude-agent.mjs")).href);
  const state = await connectorsState({ refresh: force });
  return send(res, 200, { ok: true, ...state });
}

export async function handleConnectorsWrite(req, res, agent = null) {
  if (!loopback(req)) return refuseRemote(res);
  const raw = await readBody(req, res).catch(() => null);
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  const { connectorsState, setEnabledTools } = agent ?? await import(pathToFileURL(join(PKG_ROOT, "src/server/claude-agent.mjs")).href);
  const saved = await setEnabledTools(body?.tools);
  if (!saved.ok) return send(res, saved.code === "vetoed" ? 409 : 400, saved);
  const state = await connectorsState();
  return send(res, 200, { ok: true, ...state, refused: saved.refused });
}
