// Settings › Connectors' route (claude-agent.mjs): what the person's Claude
// Code reaches, which read-only tools are turned on, and the ledger of the
// agent's last runs; and the one write, which tools are on.
//
//   GET  /api/connectors[?refresh=1]  the listing (cached ten minutes; refresh
//                                     lists again), the enabled tools, the runs
//   POST /api/connectors {tools}      turn on exactly these tools; a name that
//                                     is not a read-only tool of the latest
//                                     listing is dropped and named in `refused`
//
// A guarded read (request-gates.mjs): which services the person is connected
// to is theirs, and the only caller is the deck's own page. Listing starts the
// person's Claude Code but sends it no prompt, so it costs nothing of the plan.
import { readBody, send } from "./http-io.mjs";
import { connectorsState, setEnabledTools } from "./claude-agent.mjs";

export const CONNECTORS_ROUTE = "/api/connectors";

// This computer only, a read as well as a write, as claude-settings-routes.mjs
// holds Claude Code's own settings: what the person's connectors reach is
// theirs, and so is which of them the deck may read with.
const loopback = req => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket?.remoteAddress);

export async function handleConnectors(req, res, url, agent = { connectorsState, setEnabledTools }) {
  if (!loopback(req)) return send(res, 403, { ok: false, error: "Connectors can be seen and changed on this computer only." });
  if (req.method === "GET") {
    const state = await agent.connectorsState({ refresh: url.searchParams.get("refresh") === "1" });
    return send(res, 200, { ok: true, ...state });
  }
  if (req.method === "POST") {
    const raw = await readBody(req, res).catch(() => null);
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const saved = await agent.setEnabledTools(body?.tools);
    if (!saved.ok) return send(res, saved.code === "vetoed" ? 409 : 400, saved);
    const state = await agent.connectorsState();
    return send(res, 200, { ok: true, ...state, refused: saved.refused });
  }
  return send(res, 405, { error: "method not allowed" });
}
