// /resume typed inside a running Claude: the card of the conversation it left,
// folded away when nothing ever happened in it.
//
// Claude Code does not start a process for an in-process /resume. The same
// process sends `SessionEnd` (reason `resume`) for the session it leaves and,
// a few dozen milliseconds later, `SessionStart` (source `resume`) for the one
// it picked — and both carry the `prompt_id` of the /resume prompt itself
// (4 of 4 on this machine's log; a `claude --resume` process sends its start
// with no prompt id and no end before it). Started from the deck's New session
// and switched at once, the first session is a card with a name and nothing
// else, beside the card of the conversation the person actually went on with.
//
// So the pair is matched by that prompt id, in either order (the reducer's
// contract), and the left session's card leaves the board when it is empty:
// no prompt, no tool call, no subagent. A session somebody worked in before
// switching keeps its card; it has history and ended like any other.
// The deck's side of the same switch — the tmux pane following the new id —
// is src/server/resume-rebind.mjs.
import { forgetParkedEnrichment } from "./parked-enrichment";
import { rootAgentId, type GraphState } from "./graph-state";
import type { HookPayload } from "./types";

/** Halves held at most; a /resume is a keystroke, not traffic. */
export const RESUME_HANDOFFS_MAX = 64;

type Handoff = { from?: string; to?: string };
type WithHandoffs = GraphState & { resumeHandoffs?: Map<string, Handoff> };

/** Note one half of an in-process /resume, and fold the left card once both
 *  halves are in. True when a card left the board. */
export function noteResumeHandoff(state: GraphState, name: string, p: HookPayload, sessionId: string): boolean {
  const raw = p as { prompt_id?: unknown; reason?: unknown; source?: unknown };
  const promptId = typeof raw.prompt_id === "string" ? raw.prompt_id : "";
  if (!promptId) return false;
  const isEnd = name === "SessionEnd" && raw.reason === "resume";
  const isStart = name === "SessionStart" && raw.source === "resume";
  if (!isEnd && !isStart) return false;
  const s = state as WithHandoffs;
  const map = (s.resumeHandoffs ??= new Map());
  const h = map.get(promptId) ?? {};
  if (isEnd) h.from = sessionId; else h.to = sessionId;
  map.delete(promptId);
  if (!h.from || !h.to) {
    map.set(promptId, h);
    while (map.size > RESUME_HANDOFFS_MAX) map.delete(map.keys().next().value as string);
    return false;
  }
  if (h.from === h.to) return false;
  return foldIfEmpty(state, h.from);
}

/** Take a session's card off the board when it holds nothing: its root alone,
 *  with no prompt and no call. */
function foldIfEmpty(state: GraphState, sessionId: string): boolean {
  const root = state.agents.get(rootAgentId(sessionId));
  if (!root) return false;
  if ((root.prompts?.length ?? 0) > 0 || (root.toolCount ?? 0) > 0 || root.tools.length > 0) return false;
  for (const a of state.agents.values()) if (a.sessionId === sessionId && a.id !== root.id) return false;
  state.agents.delete(root.id);
  forgetParkedEnrichment(state, sessionId);
  state.panelLaunches.delete(sessionId);
  return true;
}
