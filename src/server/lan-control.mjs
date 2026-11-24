// Commands a paired deck may send to this deck's sessions: the policy half,
// pure. The engine carries them (a `control` frame on the sealed connection,
// lan-engine.mjs and lan-serve.mjs), and lan-control-local.mjs carries them out.
//
// A REMOTE-COMMAND PATH, SO EVERY RULE IS A NARROWING:
//
//   - OFF unless this deck's owner turns it on (`lan.acceptControl`), a switch
//     of its own beside #12's `shareSessions`, and AGENTS_DECK_NO_LAN_CONTROL=1
//     keeps it off whatever the file says (deck-prefs.mjs lanControlVetoed).
//   - FROM A PAIRED, ACCEPTED DECK ONLY, on the same sealed, pinned connection
//     as everything else, and only from an address Tailscale places as one of
//     the owner's own machines — whatever `tailscaleOnly` says. Asked again on
//     every command, never remembered.
//   - A FIXED SET (ACTIONS) whose every field is checked here and rebuilt, so
//     nothing a peer sends beyond these fields goes further. Prompt text is the
//     only free input, and it reaches the session only as text pasted into its
//     own terminal (the Command Panel's paste, bracketed by tmux): never a
//     shell, never an argument to anything, never a key.
//   - ONLY THE DECK'S OWN SESSIONS: a session in a pane of this deck's own tmux
//     server, the ones its Command Panel started, reached through the panel's
//     own engine (lan-control-local.mjs). A session run anywhere else —
//     a terminal, a systemd service, Claude Remote Control — is refused, because
//     the deck has no way into it that is not an injection of its own invention.
//   - RATE-LIMITED per peer (RATE).
//   - EVERY COMMAND IS LOGGED where the session runs (`createControlLog`): what,
//     for which session, from which deck, when, and how it ended. The prompt's
//     words are not kept, only its length.

/** What a paired deck may ask. Nothing else is a command. */
export const ACTIONS = Object.freeze(["prompt", "allow", "deny", "answer", "interrupt", "stop"]);
/** The longest prompt one command carries, in characters. */
export const MAX_PROMPT = 8_000;
/** A session id as the deck's own rows carry one. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
/** A question's options are numbered from 1 in Claude Code's dialog. */
export const MAX_CHOICE = 9;

/** Per peer: at most `burst` commands in `burstMs`, and `perMinute` a minute. */
export const RATE = Object.freeze({ burst: 3, burstMs: 5_000, perMinute: 20 });

/**
 * A command as this deck will run it, rebuilt field by field from what a peer
 * sent: `{ ok: true, command: { action, sid, text?, choice? } }`, or
 * `{ ok: false, why }`. Unknown fields are dropped, never passed on.
 */
export function checkCommand(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, why: "bad command" };
  const action = raw.action;
  if (typeof action !== "string" || !ACTIONS.includes(action)) return { ok: false, why: "unknown action" };
  if (typeof raw.sid !== "string" || !SESSION_ID.test(raw.sid)) return { ok: false, why: "bad session" };
  const command = { action, sid: raw.sid };
  if (action === "prompt") {
    if (typeof raw.text !== "string") return { ok: false, why: "no prompt" };
    // Control characters out, newlines and tabs kept: pasted, bracketed, they
    // are text in the prompt, never keys. An escape byte would be a key.
    const text = raw.text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
    if (!text.trim()) return { ok: false, why: "no prompt" };
    if (text.length > MAX_PROMPT) return { ok: false, why: "prompt too long" };
    command.text = text;
  }
  if (action === "answer") {
    if (!Number.isInteger(raw.choice) || raw.choice < 1 || raw.choice > MAX_CHOICE) return { ok: false, why: "bad choice" };
    command.choice = raw.choice;
  }
  return { ok: true, command };
}

/**
 * Whether a session's state allows a command, from summarizeSessions' row for
 * it: a permission answered only while it waits on a permission prompt, a
 * question only while it asks one, a prompt only while it is not standing on
 * either. `null` when it may, else why not.
 */
export function stateRefuses(command, row) {
  if (!row) return "no such session";
  if (row.state === "ended") return "session ended";
  const kind = row.waiting?.kind ?? null;
  if (command.action === "allow" || command.action === "deny") return kind === "permission" ? null : "not waiting on a permission";
  if (command.action === "answer") return kind === "asked" ? null : "not asking a question";
  if (command.action === "prompt") return kind === "permission" || kind === "asked" ? "answer its prompt first" : null;
  return null;
}

/** Between the two Ctrl-C of a stop, so Claude Code reads them as two. */
export const STOP_GAP_MS = 400;

/**
 * What is typed into the session's terminal for a command, as the Command
 * Panel's own socket sends it (terminal-protocol.ts): binary frames are keys,
 * and a prompt is the protocol's paste (`{ t: "paste", text }`, bracketed by
 * tmux, so its newlines stay text) and then Enter. The keys are Claude Code's
 * own: `1` takes a permission prompt's first choice ("Yes"), Escape declines
 * it or interrupts a turn, a number picks a question's option, and Ctrl-C
 * twice ends the session.
 */
export function keyFrames(command) {
  const key = data => ({ type: "binary", data });
  switch (command.action) {
    case "prompt": return [{ type: "text", data: JSON.stringify({ t: "paste", text: command.text }) }, key("\r")];
    case "allow": return [key("1")];
    case "deny": return [key("\u001b")];
    case "answer": return [key(String(command.choice))];
    case "interrupt": return [key("\u001b")];
    case "stop": return [key("\u0003"), { wait: STOP_GAP_MS }, key("\u0003")];
    default: return [];
  }
}

/** A per-peer limiter: `take(fp)` is true when the command may run. */
export function createRateLimit({ now = Date.now, rate = RATE } = {}) {
  const seen = new Map();     // fp -> times within the last minute
  return {
    take(fp) {
      const t = now();
      const list = (seen.get(fp) ?? []).filter(at => t - at < 60_000);
      const recent = list.filter(at => t - at < rate.burstMs).length;
      if (list.length >= rate.perMinute || recent >= rate.burst) { seen.set(fp, list); return false; }
      list.push(t);
      seen.set(fp, list);
      return true;
    },
  };
}

/** The most commands the log keeps. */
export const LOG_KEPT = 50;

/**
 * Where the session runs, every command a paired deck sent, run or refused:
 * `{ at, from, fp, addr, action, sid, chars?, choice?, ok, why? }`. In memory,
 * newest last; `onEntry` hears each one as it is written (the page's frame,
 * the deck's log line).
 */
export function createControlLog({ now = Date.now, onEntry = null, kept = LOG_KEPT } = {}) {
  const entries = [];
  return {
    write({ fp, from, addr, command, raw, ok, why }) {
      const action = command?.action ?? (typeof raw?.action === "string" && ACTIONS.includes(raw.action) ? raw.action : "unknown");
      const sid = command?.sid ?? (typeof raw?.sid === "string" ? raw.sid.slice(0, 128) : "");
      const entry = {
        at: now(), from: typeof from === "string" ? from.slice(0, 80) : "", fp: typeof fp === "string" ? fp.slice(0, 16) : "",
        addr: typeof addr === "string" ? addr.replace(/^::ffff:/, "") : "", action, sid,
        ...(command?.action === "prompt" ? { chars: command.text.length } : {}),
        ...(command?.action === "answer" ? { choice: command.choice } : {}),
        ok: !!ok, ...(ok ? {} : { why: String(why ?? "refused").slice(0, 80) }),
      };
      entries.push(entry);
      if (entries.length > kept) entries.splice(0, entries.length - kept);
      try { onEntry?.(entry); } catch { /* a listener's failure is not the log's */ }
      return entry;
    },
    list: () => entries.slice(),
  };
}
