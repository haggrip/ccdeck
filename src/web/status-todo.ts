// The live Todo list's rules that need no DOM: its types as the deck sends
// them (src/server/status-todo.mjs), which heading an item stands under, and
// how its due time reads. Pure, so a bare-node suite can call all of it.
import { safeHref } from "./status-brief";

export const STATUS_TODO_EVENT = "ccdeck:status-todo";

export type TodoKind = "answer" | "failed" | "approve" | "merge" | "review" | "reply" | "decide" | "todo" | "fix" | "follow-up" | "note";
export type TodoOrigin = "deck" | "brief" | "hagai" | "session";

export interface TodoLink {
  kind: "session" | "project" | "pr" | "slack" | "ticket" | "url";
  url?: string;
  sessionId?: string;
  project?: string;
  cwd?: string;
}

export interface TodoItem {
  id: string;
  title: string;
  detail?: string;
  kind: TodoKind;
  origin: TodoOrigin;
  originSession?: string;
  link: TodoLink | null;
  state: "open" | "closed";
  createdAt: number;
  updatedAt: number;
  due?: number;
  snoozedUntil?: number;
  closedAt?: number;
  closedBy?: "deck" | "brief" | "hagai" | "keeper";
  closedReason?: string;
}

/** Something the user dismissed: a brief item or a list item, by its key. */
export interface Dismissal {
  key: string;
  at: number;
  title: string;
  url?: string;
  source?: "github" | "slack" | "jira" | "session" | "deck";
}

export interface TodoView {
  ok: true;
  now: number;
  open: TodoItem[];
  closed: TodoItem[];
  /** What the user dismissed, newest first. */
  dismissed?: Dismissal[];
  keeper: { lastRunAt: number | null; lastCostUsd: number | null; error: { at: number; code: string; message: string } | null };
  keeperRunning?: boolean;
  keeperQueued?: number;
  /** The keeper has the user's own words to read, or is reading them. */
  keeperReading?: boolean;
}

/** The kinds that are someone waiting on you, under "Waiting on you"; the
 *  rest are things to do, under "To do". */
const WAITING: ReadonlySet<TodoKind> = new Set(["answer", "failed", "approve", "merge", "review", "reply", "decide"]);

export function splitOpen(items: readonly TodoItem[]): { waiting: TodoItem[]; todo: TodoItem[] } {
  const waiting: TodoItem[] = [];
  const todo: TodoItem[] = [];
  for (const i of items) (WAITING.has(i.kind) ? waiting : todo).push(i);
  return { waiting, todo };
}

export const isSnoozed = (i: TodoItem, now: number) => !!i.snoozedUntil && i.snoozedUntil > now;
export const isOverdue = (i: TodoItem, now: number) => !!i.due && i.due < now;

/** Where an item opens: its session's card, its page, or nothing but its
 *  project's name. A session the board no longer has keeps its project. */
export function openerOf(i: TodoItem, sessions: ReadonlySet<string>): { session?: string; href?: string; project?: string } {
  const href = safeHref(i.link?.url ?? null) ?? undefined;
  const session = i.link?.sessionId && sessions.has(i.link.sessionId) ? i.link.sessionId : undefined;
  return { ...(session ? { session } : {}), ...(href ? { href } : {}), ...(i.link?.project ? { project: i.link.project } : {}) };
}

/** A due or snooze time, short: the time today, the weekday this week, else
 *  the date. */
export function whenShort(at: number, now: number, locale?: string): string {
  const d = new Date(at);
  const n = new Date(now);
  const sameDay = d.toDateString() === n.toDateString();
  if (sameDay) return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (Math.abs(at - now) < 6 * 24 * 3600_000) return d.toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/** The next morning at nine, local time: what "snooze" means on the button. */
export function tomorrowMorning(now: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}
