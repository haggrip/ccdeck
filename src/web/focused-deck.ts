// The focused deck (owner, 2026-11-25): Mission is the deck, so the surfaces
// that watched the deck's own machinery are gone from the UI: the Inspector,
// Usage, This machine, Usage history, Account capacity, Reset calendar, Radio,
// Tool activity, Skill activity and Radar. Their doors, keys and Quick Open
// rows are not drawn, and the three right-column panels never open.
//
// THE CODE STAYS. Only the ways in are removed, so the fork keeps merging with
// upstream, where these modules keep changing; one set here says which.
export const REMOVED_SURFACES: ReadonlySet<string> = new Set([
  "inspector", "usage", "machine", "history", "account-capacity", "reset-calendar",
  "radio", "tool-activity", "skill-activity", "traffic-radar",
]);

export const surfaceRemoved = (id: string): boolean => REMOVED_SURFACES.has(id);

/** A list of doors without the removed ones. */
export function withoutRemoved<T extends { id: string }>(items: readonly T[]): T[] {
  return items.filter(i => !surfaceRemoved(i.id));
}
