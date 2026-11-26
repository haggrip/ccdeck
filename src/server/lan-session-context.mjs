// Where each of this deck's sessions stands, in its own words, for a paired
// deck that asks while the owner shares it (`lan.shareSessionContext`, see
// deck-prefs.mjs): the newest prompt, the question standing, and how its last
// turn ended. lan-sessions.mjs cuts all of it to its caps before it leaves.
//
// WHY. A paired deck's board drew a session's name and state and nothing it
// said (#12), so the deck showing it could put it in no brief and no Todo
// list: "waiting" said nothing of what for. The owner's ThinkPad runs its
// sessions under Claude Remote Control, driven from the Mac, and the Mac's
// Mission and brief are where he reads what waits on him (2026-11-25).
//
// THE END OF A TURN, ONE SHAPE. The Claude desktop app's sessions end a turn
// with its `wrap_up` call, which summarizeSessions keeps as the row's `wrap`
// (session-wrap.mjs) on a build that has it. A session that never makes the
// call (every Remote Control session: none of the ThinkPad's 51 projects holds
// one, and every terminal session) still ends its turn with a Stop hook, and
// Claude Code puts the turn's last words in it, `last_assistant_message`. Those
// become a wrap of the same shape, with no id and no ask, so the deck that
// reads it has one path for both: `{ id, at, recap, ask }`.
//
// WHEN THEY STOP BEING TRUE. The next prompt answers a turn's last words, as it
// answers the call's; the session ending drops them.
//
// A QUESTION STANDING. The row's own wait (a Notification) when it has one;
// else an AskUserQuestion the session called that has no result yet. A
// subagent's question or last words are its own, not the session's.
//
// Pure: envelopes and rows in, context out.

export const MAX_PROMPT = 240;
export const MAX_QUESTION = 200;
export const MAX_RECAP = 600;
const MAX_CHOICE = 60;
const MAX_CHOICES = 4;
/** The tool a session asks the person a question with. */
export const ASK_TOOL = "AskUserQuestion";

/** One line of words, cut to `max` with an ellipsis; "" for anything else. */
export function clip(v, max) {
  if (typeof v !== "string") return "";
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

const isSubagent = p => !!(p?.agent_id || p?.parent_tool_use_id);

/** The first question an AskUserQuestion call puts, or null. */
function askOf(input) {
  const q = Array.isArray(input?.questions) ? input.questions[0] : null;
  const question = clip(q?.question, MAX_QUESTION) || clip(q?.header, MAX_QUESTION);
  if (!question) return null;
  const choices = Array.isArray(q.options)
    ? q.options.map(o => clip(o?.label, MAX_CHOICE)).filter(Boolean).slice(0, MAX_CHOICES)
    : [];
  return { question, choices };
}

/**
 * What the ring says of each session, past its state, by session id:
 *
 *   prompt     the newest prompt's words, cut, or null
 *   promptAt   when it came, or null
 *   stop       { at, recap }: the last turn's last words, until a prompt answers them
 *   asking     { id, at, question, choices }: an AskUserQuestion with no result yet
 */
export function sessionContexts(envelopes) {
  const by = new Map();
  const of = id => {
    let c = by.get(id);
    if (!c) by.set(id, (c = { prompt: null, promptAt: null, stop: null, asking: null }));
    return c;
  };
  for (const env of Array.isArray(envelopes) ? envelopes : []) {
    const p = env?.payload;
    const id = typeof p?.session_id === "string" && p.session_id ? p.session_id : null;
    const at = Number.isFinite(env?.receivedAt) ? env.receivedAt : null;
    if (!id || at == null) continue;
    switch (p.hook_event_name) {
      case "UserPromptSubmit": {
        const c = of(id);
        const prompt = clip(typeof p.prompt === "string" ? p.prompt : p.message, MAX_PROMPT);
        if (prompt) c.prompt = prompt;
        c.promptAt = at;
        c.stop = null;
        c.asking = null;
        break;
      }
      case "Stop": {
        if (isSubagent(p)) break;
        const c = of(id);
        const recap = clip(p.last_assistant_message, MAX_RECAP);
        c.stop = recap ? { at, recap } : null;
        c.asking = null;
        break;
      }
      case "PreToolUse": {
        if (p.tool_name !== ASK_TOOL || isSubagent(p)) break;
        const ask = askOf(p.tool_input);
        if (ask) of(id).asking = { id: typeof p.tool_use_id === "string" ? p.tool_use_id : null, at, ...ask };
        break;
      }
      case "PostToolUse":
      case "PostToolUseFailure": {
        const c = by.get(id);
        if (c?.asking && (!c.asking.id || c.asking.id === p.tool_use_id)) c.asking = null;
        break;
      }
      case "SessionEnd":
        by.delete(id);
        break;
      default:
        break;
    }
  }
  return by;
}

/**
 * One row's context, as lan-sessions.mjs shares it (and cuts it again):
 *
 *   prompt     the newest prompt, or null
 *   question   the question standing: the row's wait, else an open AskUserQuestion
 *   askedAt    since when it has stood, or null
 *   wrap       the row's own end-of-turn call where it has one, else the last
 *              turn's last words as `{ id: null, at, recap, ask: null }`; null
 *              once a prompt answered them or the session ended
 */
export function contextOf(row, ctx = null) {
  if (!row || typeof row !== "object") return null;
  const waitWords = row.waiting && row.waiting.kind !== "idle" ? clip(row.waiting.message, MAX_QUESTION) : "";
  const asking = ctx?.asking ?? null;
  const question = waitWords || asking?.question || null;
  const askedAt = waitWords
    ? (Number.isFinite(row.waiting.since) ? row.waiting.since : null)
    : (asking ? asking.at : null);
  let wrap = row.wrap && typeof row.wrap === "object" ? row.wrap : null;
  const stop = ctx?.stop ?? null;
  if (!wrap && stop && row.state !== "ended" && !(ctx.promptAt != null && ctx.promptAt > stop.at)) {
    wrap = { id: null, at: stop.at, recap: stop.recap, ask: null };
  }
  return { prompt: ctx?.prompt ?? null, question, askedAt, wrap };
}

/** summarizeSessions' rows, each with its `context` beside it. */
export function withSessionContext(rows, envelopes) {
  const ctxs = sessionContexts(envelopes);
  return (Array.isArray(rows) ? rows : []).map(r => ({ ...r, context: contextOf(r, ctxs.get(r?.id)) }));
}
