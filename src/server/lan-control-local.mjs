// Carrying out a paired deck's command on one of this deck's own sessions
// (lan-control.mjs has the rules; this is the doing).
//
// THROUGH THE COMMAND PANEL'S OWN ENGINE, AND ONLY FOR ITS OWN SESSIONS. The
// deck reaches a session the way its terminal does: the engine's `target`
// route must place it in a pane of the deck's own tmux (case A, a session the
// Command Panel started), its `open` route hands a handle for it, and the
// command's keys go in over that handle's attach (pro-engine-terminal.mjs
// typeThroughEngine), exactly as the panel's socket sends a person's typing.
// A session found anywhere else — a pane of the person's own tmux, a terminal,
// a systemd service such as Claude Remote Control's, a background job — is
// refused with `not_deck_pane`: Claude Code gives a script no way to type into
// a running session it did not start in a terminal of its own, and this module
// invents none. A deck without the engine refuses everything.
//
// Claude Code sessions only: the keys in keyFrames are Claude Code's.
//
// Never throws: every failure is `{ ok: false, why }`.
import { keyFrames, stateRefuses } from "./lan-control.mjs";

const HANDLE = /^[0-9a-f]{64}$/;

/**
 * `rows()` answers this deck's sessions as summarizeSessions rows; `engine()`
 * the Command Panel's engine as terminal-routes.mjs holds it (`commandPanel`),
 * with `enabled`, `route(method, body)` and `type(handle, frames)`.
 */
export function createLocalControl({ rows, engine } = {}) {
  return async function run(command) {
    try {
      const list = typeof rows === "function" ? await rows() : [];
      const row = (Array.isArray(list) ? list : []).find(r => r?.id === command.sid);
      const refused = stateRefuses(command, row);
      if (refused) return { ok: false, why: refused };
      if ((row.provider ?? "claude") !== "claude") return { ok: false, why: "claude sessions only" };
      const e = typeof engine === "function" ? await engine() : null;
      if (!e || e.enabled !== true || typeof e.route !== "function" || typeof e.type !== "function") return { ok: false, why: "no command panel" };
      const session = { sessionId: command.sid, provider: "claude", cwd: "" };
      const target = await e.route("target", session);
      if (target?.status !== 200 || target.body?.target?.kind !== "A") return { ok: false, why: "not_deck_pane" };
      const opened = await e.route("open", session);
      if (opened?.status !== 200 || typeof opened.handle !== "string" || !HANDLE.test(opened.handle)) return { ok: false, why: "not_deck_pane" };
      return await e.type(opened.handle, keyFrames(command));
    } catch {
      return { ok: false, why: "failed" };
    }
  };
}
