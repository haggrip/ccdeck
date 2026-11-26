// The Claude desktop app's own account of where a session stands, and of what
// it needs from the person: the call every one of its sessions ends a turn with.
//
// WHAT IT IS. The desktop app has each session it runs end its turn by calling
// `mcp__ccd_turn__wrap_up`, whose input is:
//
//   recap    two or three sentences: what is now true, and where it stands
//   ask      the one decision the turn leaves the person, when it leaves one
//   actions  the answers to it, as the buttons the app draws ({ label })
//   blocked  true when the session's work stops until the person answers
//
// Measured on this machine on 2026-11-25: hundreds of these a day in the desktop
// app's transcripts, against a handful of Claude Code's own "※ recap" lines
// (session-recap.mjs), which its sessions rarely write.
//
// WHY THE DECK WANTS IT. Mission says what waits on the person, and a session
// that stopped on a question is the plainest case of that. Before this the deck
// knew only permission prompts: on 2026-11-25 a session sat on "Which Jira key
// should the Splunk batching PR carry?" while Mission said nothing waited.
//
// TWO ROADS IN. The hook's PostToolUse for the call carries its input, so
// summarizeSessions (session-summary.mjs) has it the moment it lands. The
// transcript holds the same call, so the cursor folds it (foldWrapLine) and the
// deck says it on SessionRecapped's `wrap`: that is the road after a restart,
// whose log no longer holds the hook event. Both name the call by its
// tool_use id, so one ask is never two.
//
// WHEN IT STOPS BEING TRUE. The person's next prompt answers it. Not the model's
// next line: the app has the model write its closing message after the call, so
// the rule session-recap.mjs keeps for Claude Code's recap (any assistant line
// retires it) would retire this one at once.

/** The call, as the hook's `tool_name` and the transcript's tool_use name it. */
export const WRAP_TOOL = "mcp__ccd_turn__wrap_up";
/** The cheap test every transcript line gets before anything is parsed. */
export const WRAP_MARK = `"${WRAP_TOOL}"`;

const USER_MARK = '"type":"user"';
const TOOL_RESULT_MARK = '"type":"tool_result"';
// The app caps the recap near 300 characters and the ask at 100; these bound
// what a malformed call could put on the page, and nothing else.
const MAX_RECAP = 600;
const MAX_ASK = 300;
const MAX_CHOICE = 60;
const MAX_CHOICES = 4;

function clip(v, max) {
  if (typeof v !== "string") return "";
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/**
 * The call's input as the deck keeps it, or null when it says nothing.
 *
 *   id      the call's tool_use id: what the two roads agree on
 *   at      when the call was made, epoch ms
 *   recap   its recap, or null
 *   ask     { question, choices, blocked }, or null when the turn leaves the
 *           person nothing. A blocked turn is an ask even when it puts its
 *           question in the closing message instead (question null).
 */
export function wrapFromInput(input, id, at) {
  if (!input || typeof input !== "object" || !Number.isFinite(at)) return null;
  const recap = clip(input.recap, MAX_RECAP);
  const question = clip(input.ask, MAX_ASK);
  const blocked = input.blocked === true;
  if (!recap && !question && !blocked) return null;
  const choices = Array.isArray(input.actions)
    ? input.actions.map(a => clip(a?.label, MAX_CHOICE)).filter(Boolean).slice(0, MAX_CHOICES)
    : [];
  return {
    id: typeof id === "string" && id ? id : null,
    at,
    recap: recap || null,
    ask: question || blocked ? { question: question || null, choices, blocked } : null,
  };
}

/** A wrap another module handed over (an event's payload), checked again. */
export function normaliseWrap(w) {
  if (!w || typeof w !== "object" || !Number.isFinite(w.at)) return null;
  const input = {
    recap: w.recap,
    ask: w.ask?.question,
    blocked: w.ask?.blocked === true,
    actions: Array.isArray(w.ask?.choices) ? w.ask.choices.map(label => ({ label })) : [],
  };
  return wrapFromInput(input, w.id, w.at);
}

/** The key one call is known by, on either road. */
export const wrapKey = w => (w ? String(w.id ?? w.at) : "");

/**
 * The wrap one transcript line records, or null. Main chain only: a subagent's
 * sidechain is not the session a person comes back to. The line's own timestamp
 * is the call's time, never the clock here, as session-recap.mjs reads it.
 */
export function wrapOf(line) {
  if (!line || !line.includes(WRAP_MARK)) return null;
  let obj = null;
  try { obj = JSON.parse(line); } catch { return null; }
  if (!obj || obj.type !== "assistant" || obj.isSidechain === true) return null;
  const at = typeof obj.timestamp === "string" ? Date.parse(obj.timestamp) : NaN;
  const blocks = Array.isArray(obj.message?.content) ? obj.message.content : [];
  let found = null;
  for (const b of blocks) {
    if (b?.type === "tool_use" && b.name === WRAP_TOOL) found = wrapFromInput(b.input, b.id, at) ?? found;
  }
  return found;
}

/**
 * Whether a transcript line starts a turn: a main-chain user line with words in
 * it. Not a tool's result (the call's own result is the line right after it),
 * not a meta note, not a compaction's summary. A tool result is told by its
 * mark before anything is parsed: a prompt that quotes one has it escaped.
 */
export function isPromptLine(line) {
  if (!line || !line.includes(USER_MARK) || line.includes(TOOL_RESULT_MARK)) return false;
  let obj = null;
  try { obj = JSON.parse(line); } catch { return false; }
  if (!obj || obj.type !== "user" || obj.isSidechain === true || obj.isMeta === true || obj.isCompactSummary === true) return false;
  const c = obj.message?.content;
  if (typeof c === "string") return c.trim().length > 0;
  return Array.isArray(c) && c.some(b => b?.type === "text" && typeof b.text === "string" && b.text.trim().length > 0);
}

/**
 * Fold one line into `out.wrap`: set by the call, retired by the next prompt.
 * Pure, and shaped like foldRecapLine so the transcript cursor runs both over
 * the same line. The ordinary line costs one substring test, and two more while
 * a wrap is standing.
 */
export function foldWrapLine(out, line) {
  if (!line) return;
  const wrap = wrapOf(line);
  if (wrap) { out.wrap = wrap; return; }
  if (out.wrap && isPromptLine(line)) out.wrap = null;
}
