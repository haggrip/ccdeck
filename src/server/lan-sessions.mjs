// The sessions a paired deck shares, read-only: what this deck answers a paired
// deck that asks (`shareRows`), what it keeps of the answer it hears back
// (`heardRows`, `createRemoteSessions`), and nothing else.
//
// OFF UNLESS THE OWNER TURNS IT ON (`lan.shareSessions`, see deck-prefs.mjs),
// and AGENTS_DECK_NO_LAN_SESSIONS=1 keeps it off whatever the file says. A deck
// that shares says so in its manifest (`sessions: 1`), and only a deck that said
// so is asked — see roundWith in lan-engine.mjs and serve in lan-serve.mjs, which
// answers only a deck that finished the handshake and that somebody here
// accepted, as it does for everything else.
//
// WHAT GOES OUT IS A WHITELIST, built field by field from summarizeSessions'
// rows: the session's id, its name, the FOLDER NAME of its project (never the
// path), its provider, its state, when that state began and when it was last
// heard, and which KIND of wait it is standing on. Never a prompt, a tool
// input, a question's words, a transcript or a working directory: those are in
// the row summarizeSessions builds (`cwd`, `waiting.message`, `waiting.tool`),
// and none of them is copied. The same whitelist runs again over what a peer
// sends back, so a deck that sends more than this is cut down to it here.
//
// A SECOND TIER, OFF UNLESS THE OWNER TURNS IT ON TOO (`lan.shareSessionContext`,
// held off by AGENTS_DECK_NO_LAN_SESSION_CONTEXT=1): where each session stands
// in its own words, so the deck that shows it can put it in its brief and its
// Todo list (lan-session-context.mjs). Four more fields, each cut here: the
// newest prompt, the question standing and since when, and the end of the last
// turn as `{ id, at, recap, ask }`, the shape session-wrap.mjs keeps. Still never
// a tool's input or output, a transcript or a path. A deck that shares them says
// so in its manifest (`context: 1`), and the asking deck keeps them only from a
// deck that said so; from any other, they are cut as before.

/** The most sessions one deck hands over, and keeps of one peer. */
export const MAX_SHARED_SESSIONS = 200;
/** Field caps, in characters. */
export const MAX_ID = 128;
export const MAX_NAME = 120;
export const MAX_PROJECT = 80;
export const MAX_PROMPT = 240;
export const MAX_QUESTION = 200;
export const MAX_RECAP = 600;
export const MAX_ASK = 300;
export const MAX_CHOICE = 60;
export const MAX_CHOICES = 4;

const STATES = new Set(["waiting", "working", "idle", "ended", "failed"]);
const KINDS = new Set(["permission", "asked", "idle"]);
const PROVIDERS = new Set(["claude", "codex", "opencode", "copilot"]);

const text = (v, max) => {
  if (typeof v !== "string") return null;
  // Control characters out: these are drawn as one line of text.
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const time = v => (Number.isFinite(v) && v > 0 ? Math.round(v) : null);
/** The last segment of a path or a folder name, never more. A name that is
 *  itself a path is cut to its last segment as well. */
const folder = v => {
  if (typeof v !== "string") return null;
  const last = v.split(/[\\/]/).filter(Boolean).pop();
  return text(last ?? "", MAX_PROJECT);
};

/** Words drawn as one line: whitespace folded, cut with an ellipsis. */
const words = (v, max) => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
};

/** The end of a turn, as session-wrap.mjs keeps it: `{ id, at, recap, ask }`,
 *  each field cut; null when it says nothing. */
export function shareWrap(w) {
  if (!w || typeof w !== "object") return null;
  const at = time(w.at);
  if (!at) return null;
  const recap = words(w.recap, MAX_RECAP);
  const ask = w.ask && typeof w.ask === "object" ? w.ask : null;
  const question = ask ? words(ask.question, MAX_ASK) : null;
  const blocked = ask?.blocked === true;
  if (!recap && !question && !blocked) return null;
  const choices = ask && Array.isArray(ask.choices)
    ? ask.choices.map(c => words(c, MAX_CHOICE)).filter(Boolean).slice(0, MAX_CHOICES)
    : [];
  return { id: text(w.id, MAX_ID), at, recap, ask: question || blocked ? { question, choices, blocked } : null };
}

/** The second tier's four fields, from a row's `context` (this deck's rows,
 *  lan-session-context.mjs) or from the row itself (what a peer sent). */
function contextFields(row, state) {
  const src = row.context && typeof row.context === "object" ? row.context : row;
  const question = state === "ended" ? null : words(src.question, MAX_QUESTION);
  return {
    prompt: words(src.prompt, MAX_PROMPT),
    question,
    askedAt: question ? time(src.askedAt) : null,
    wrap: state === "ended" ? null : shareWrap(src.wrap),
  };
}

/** One row, cut to the whitelist; null for a row that names no session. With
 *  `context`, the second tier's fields as well. */
export function shareRow(row, { context = false } = {}) {
  if (!row || typeof row !== "object") return null;
  const id = text(row.id, MAX_ID);
  if (!id) return null;
  const state = STATES.has(row.state) ? row.state : "idle";
  // The kind of wait only, from either shape: summarizeSessions' `{ kind, … }`
  // or the bare word a peer sends.
  const rawKind = typeof row.waiting === "string" ? row.waiting : row.waiting?.kind;
  const waiting = KINDS.has(rawKind) && state !== "ended" ? rawKind : null;
  return {
    id,
    name: text(row.name, MAX_NAME),
    // The folder name and nothing else — `project` when the row has one, else
    // the last segment of `cwd`. `cwd` itself never leaves.
    project: folder(row.project) ?? folder(row.cwd),
    provider: PROVIDERS.has(row.provider) ? row.provider : "claude",
    state,
    since: time(row.since),
    lastEventAt: time(row.lastEventAt),
    waiting,
    ...(context === true ? contextFields(row, state) : {}),
  };
}

/** The most bytes of rows one answer carries: well inside one LAN frame
 *  (MAX_FRAME_BYTES in lan-lines.mjs) once it is sealed and encoded. */
export const MAX_SHARED_BYTES = 48 * 1024;

/** This deck's answer: summarizeSessions' rows, whitelisted and capped by
 *  count and by size. summarizeSessions puts the waiting first, so a cut
 *  drops the ended and the idle before anything that needs somebody. With
 *  `context`, the second tier rides each row too, inside the same byte cap. */
export function shareRows(rows, { max = MAX_SHARED_SESSIONS, maxBytes = MAX_SHARED_BYTES, context = false } = {}) {
  const out = [];
  let bytes = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (out.length >= max) break;
    const r = shareRow(row, { context });
    if (!r) continue;
    bytes += Buffer.byteLength(JSON.stringify(r)) + 1;
    if (bytes > maxBytes) break;
    out.push(r);
  }
  return out;
}

/** What a peer sent, read the same way: never trusted to have kept to it. */
export const heardRows = shareRows;

/**
 * The asking side's memory: each paired deck's last answer, with when it came.
 *
 * In memory only, and dropped three ways: the round hears the deck stopped
 * sharing (`drop`), the deck is unpaired (`drop`, from the engine's unpair, and
 * `list` asks `isPaired` on every read as well), or nothing new has come from
 * it for `staleMs` — a deck that went to sleep is not left on the board saying
 * its last word.
 */
export function createRemoteSessions({ now = Date.now, staleMs, onChange = null } = {}) {
  const byFp = new Map();
  const changed = () => { try { onChange?.(); } catch { /* a listener's failure is not the store's */ } };
  return {
    // `context`: the deck said in its manifest that it shares the second tier.
    // From any other, those fields are cut as the first tier always was.
    keep(fp, rows, { control = false, context = false } = {}) {
      if (typeof fp !== "string" || !fp) return;
      byFp.set(fp, { at: now(), rows: heardRows(rows, { context: context === true }), control: control === true });
      changed();
    },
    drop(fp) {
      if (byFp.delete(fp)) changed();
    },
    clear() {
      if (byFp.size === 0) return;
      byFp.clear();
      changed();
    },
    /** Every deck still worth drawing, as `{ fp, at, sessions }`. Stale and
     *  unpaired decks are forgotten as they are found. */
    list({ isPaired = () => true } = {}) {
      const out = [];
      const t = now();
      for (const [fp, got] of byFp) {
        if (!isPaired(fp) || t - got.at > staleMs) { byFp.delete(fp); continue; }
        out.push({ fp, at: got.at, sessions: got.rows, control: got.control === true });
      }
      return out;
    },
    has: fp => byFp.has(fp),
  };
}
