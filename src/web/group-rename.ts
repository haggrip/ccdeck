// Titling a group on the board: what a session is FOR, over its frame, in
// place of the folder it runs in (src/server/group-titles.mjs).
//
// A group carries two titles: the one a person typed, which always wins, and
// the goal titler's, drawn while no person has named it. Clearing a person's
// title brings the automatic one back; with neither, the folder is the label.
//
// The field is the session name's (SessionNameField.tsx), with its keys and
// its rules (session-rename.ts saveAsk), handed these facts and this save:
//   current   what the field opens holding: the title drawn, else the folder;
//   fallback  what a clear gives back: the automatic title, else the folder;
//   deckNamed a person has titled it, so there is a title to clear.
// Kept out of React, so the rules are tested in a plain node environment.
import type { RenameFacts, SaveResult } from "./session-rename";
import { cleanTyped } from "./session-rename";
import type { AgentNodeData } from "./types";
import { isEventOnly } from "../server/provider-ids.mjs";

/** What a group needs for renaming: the root card's fields, as the cluster
 *  carries them (cluster-bounds.ts). */
export interface GroupFacts {
  sessionId: string;
  provider?: AgentNodeData["provider"];
  groupName?: string;
  goalTitle?: string;
  /** The folder, whole. */
  workspace?: string;
}

/** The facts for a group the deck can title: a Claude or Codex session's,
 *  as the deck names those sessions (session-deck-names.mjs). */
export function groupRenameFacts(g: GroupFacts | null | undefined): RenameFacts | null {
  if (!g || typeof g.sessionId !== "string" || !g.sessionId) return null;
  if (isEventOnly(g.provider)) return null;
  const person = cleanTyped(g.groupName ?? "");
  const auto = cleanTyped(g.goalTitle ?? "");
  const folder = g.workspace ?? "";
  return {
    provider: g.provider === "codex" ? "codex" : "claude",
    sessionId: g.sessionId,
    current: person || auto || folder,
    fallback: auto || folder,
    deckNamed: person !== "",
  };
}

/** Asks the deck to keep `name` as the group's title (null clears it). The
 *  deck announces it to every page itself; the answer only says whether it
 *  was kept. Never throws. */
export async function saveGroupName(
  facts: Pick<RenameFacts, "provider" | "sessionId">,
  name: string | null,
  send: typeof fetch = fetch,
): Promise<SaveResult> {
  try {
    const res = await send("/api/group-title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: facts.provider, sessionId: facts.sessionId, name }),
    });
    const body = await res.json().catch(() => null) as { ok?: unknown; name?: unknown } | null;
    if (!res.ok || !body || body.ok !== true) return { ok: false };
    return { ok: true, name: typeof body.name === "string" ? body.name : null };
  } catch {
    return { ok: false };
  }
}

/** Why the goal titler wrote no title, as the server says it
 *  (group-title-route.mjs). */
export type GoalTitleReason = "off" | "named" | "empty" | "budget" | "unavailable" | "failed" | "bad_request" | "network";
export type GoalTitleResult = { ok: true; title: string | null } | { ok: false; reason: GoalTitleReason };

const REASONS = new Set<GoalTitleReason>(["off", "named", "empty", "budget", "unavailable", "failed", "bad_request"]);

/** Asks the goal titler for this group's title now. Answers once the run is
 *  done; the title itself reaches every page as the deck announces it. */
export async function requestGoalTitle(
  facts: Pick<RenameFacts, "provider" | "sessionId">,
  send: typeof fetch = fetch,
): Promise<GoalTitleResult> {
  try {
    const res = await send("/api/group-title/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: facts.provider, sessionId: facts.sessionId }),
    });
    const body = await res.json().catch(() => null) as { ok?: unknown; title?: unknown; reason?: unknown } | null;
    if (body?.ok === true) return { ok: true, title: typeof body.title === "string" ? body.title : null };
    const reason = typeof body?.reason === "string" && REASONS.has(body.reason as GoalTitleReason) ? body.reason as GoalTitleReason : "failed";
    return { ok: false, reason };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Asks the goal titler for every group on the board no person has named.
 *  Answers how many it queued. */
export async function requestAllGoalTitles(send: typeof fetch = fetch): Promise<{ ok: true; queued: number } | { ok: false; reason: GoalTitleReason }> {
  try {
    const res = await send("/api/group-title/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    const body = await res.json().catch(() => null) as { ok?: unknown; queued?: unknown; reason?: unknown } | null;
    if (body?.ok === true) return { ok: true, queued: typeof body.queued === "number" ? body.queued : 0 };
    const reason = typeof body?.reason === "string" && REASONS.has(body.reason as GoalTitleReason) ? body.reason as GoalTitleReason : "failed";
    return { ok: false, reason };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** The i18n key that says why no title came, for the field's error line. */
export function goalTitleReasonKey(reason: GoalTitleReason): string {
  return `board.group.why.${reason}`;
}
