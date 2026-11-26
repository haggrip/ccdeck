// The Status pane's rules that need no DOM: what the deck's own sessions put
// on it, how the brief's people meet the reader's pins and hides, and which
// links it will draw. Pure, so a bare-node suite can call all of it.
//
// TWO HALVES, ONE PANE. The deck-local half is read from the board's own rows
// (SessionList.tsx buildRows) on every render, so a session that starts
// waiting is on the pane the moment its card says so, with no run of anything.
// The brief half is what the user's Claude Code wrote the last time it was
// asked (src/server/status-brief.mjs), cached with its time; it is never
// newer than that time, and the pane says how old it is.
import { isAlarming } from "./ambient-counts";
import type { Row } from "./components/SessionList";
import { rank } from "./components/SessionList";

export type BriefSource = "github" | "slack" | "jira" | "linear" | "session";
export type WaitingKind = "approve" | "merge" | "review" | "reply" | "decide";
export type TodoKind = "todo" | "fix" | "follow-up";
export type TalkKind = "feedback" | "talk";
export type BriefModel = "haiku" | "sonnet" | "opus";
/** Per source: read ("on"), switched off in the pane ("off"), no connector
 *  for it ("none"), or a connector whose read-only tools are not switched on
 *  in Settings › Connectors ("disabled"). */
/** "missing", "logged-out" and "error" are GitHub's, read with gh. */
export type Reach = "on" | "off" | "none" | "disabled" | "missing" | "logged-out" | "error";

export interface BriefItem {
  kind: WaitingKind | TodoKind | TalkKind | "answer" | "failed" | "read";
  title: string;
  detail?: string;
  source: BriefSource;
  url?: string;
  sessionId?: string;
  person?: string;
  /** The Slack channel it was posted in. */
  channel?: string;
  /** When its source last moved, as the brief read it. */
  activityAt?: number;
  /** What the deck dismisses it by (status-todo.mjs dismissKeyOf). */
  dkey?: string;
  /** Drawn from the deck's own state this render, not from the brief. */
  local?: true;
}

export interface BriefPerson {
  key: string;
  name: string;
  handle?: string;
  why?: string;
  url?: string;
  source?: Exclude<BriefSource, "session">;
}

/** One event on a PR since the last brief (status-gh.mjs activityOf). */
export interface ActivityEvent {
  kind: "approved" | "changes-requested" | "reviewed" | "comments" | "mention" | "review-requested" | "re-request"
    | "pushed" | "merged" | "closed" | "ci-failed" | "ci-green";
  at: number;
  who: string[];
  count: number;
  /** Someone else's words, cut short: data, drawn as text. */
  excerpt: string;
  /** The deck's plain words for it. */
  what: string;
}

export interface ActivityItem {
  url: string;
  repo: string;
  number: number | null;
  title: string;
  author: string | null;
  mine: boolean;
  state: "open" | "merged" | "closed";
  at: number;
  events: ActivityEvent[];
  /** Read again when the brief was written: nothing is left for me on it,
   *  and why (status-gh.mjs activitySettledBy). Drawn dimmed, not counted. */
  settled?: "merged" | "closed" | "draft" | "approved" | "reviewed";
}

/** What moved on my PRs and the ones I review since the last brief. */
export interface BriefActivity {
  since: number;
  until?: number;
  items: ActivityItem[];
  /** More moved than the deck read. */
  partial?: true;
}

/** Something the user asked of someone and still waits on (status-brief.mjs
 *  normaliseWaitingOn): a review GitHub requests on his PR, or a Slack ask
 *  nobody has answered. Never on the Todo list: it is not his to do. */
export interface WaitingOn {
  /** Whom he asked: a name, several, or a #channel. */
  person: string;
  title: string;
  url: string;
  source: "github" | "slack";
  /** When he asked, as far as the deck can tell. */
  askedAt?: number;
  detail?: string;
  channel?: string;
}

export interface Brief {
  at: number;
  model: BriefModel | null;
  summary: string;
  waiting: BriefItem[];
  todo: BriefItem[];
  talkTo: BriefItem[];
  /** Absent from a brief written before the deck kept it. */
  waitingOn?: WaitingOn[];
  people: BriefPerson[];
  reach: Record<"github" | "slack" | "jira" | "linear", Reach>;
  /** The gh account GitHub was read as. */
  ghAccount?: string;
  /** Read with gh: what moved since the brief before. */
  activity?: BriefActivity;
}

export interface BriefSettings {
  model: BriefModel;
  everyMinutes: 0 | 15 | 30 | 60;
  sources: Record<"github" | "slack" | "jira" | "linear", boolean>;
  /** Slack channels the brief reads nothing from, by name, without "#". */
  slackIgnore?: string[];
}

/** Channel names out of what was typed ("#a, b c"), as the deck keeps them
 *  (status-brief.mjs channelName): lower case, no "#", Slack's alphabet. */
export function channelNames(typed: string): string[] {
  return [...new Set(typed.split(/[\s,]+/).map(w => w.replace(/^#/, "").toLowerCase()).filter(n => /^[a-z0-9][a-z0-9._-]{0,79}$/.test(n)))];
}

export interface BriefView {
  ok: true;
  now: number;
  brief: Brief | null;
  error: { at: number; code: string; message: string } | null;
  running: boolean;
  lastRunAt: number | null;
  nextAutoAt: number | null;
  settings: BriefSettings;
  people: { pinned: BriefPerson[]; hidden: string[] };
  /** Whether the deck can ask Claude Code at all (claude-agent.mjs present and
   *  not vetoed by AGENTS_DECK_NO_AGENT). */
  agent: "ready" | "off";
}

export const BRIEF_MODELS: readonly BriefModel[] = ["haiku", "sonnet", "opus"];
export const BRIEF_EVERY: readonly BriefSettings["everyMinutes"][] = [0, 15, 30, 60];

/** An https link, or nothing: the pane draws no other kind. */
export function safeHref(url: string | undefined | null): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname ? u.href : null;
  } catch { return null; }
}

export interface LocalBrief {
  counts: { needs: number; working: number; fresh: number; failed: number; total: number };
  /** Sessions stopped on a question or a permission prompt, longest first. */
  waiting: BriefItem[];
  /** Turns that ended on an error, and finished turns not yet read. */
  todo: BriefItem[];
}

/** The deck's own half of the pane, from the board's rows (buildRows order). */
export function localBrief(rows: readonly Row[]): LocalBrief {
  const counts = { needs: 0, working: 0, fresh: 0, failed: 0, total: rows.length };
  const waiting: BriefItem[] = [];
  const failed: BriefItem[] = [];
  const fresh: BriefItem[] = [];
  for (const r of rows) {
    const group = rank(r);
    if (group === 0) counts.needs++;
    else if (group === 2) counts.working++;
    else if (group === 1) counts.fresh++;
    if (isAlarming(r.waiting)) {
      waiting.push({
        kind: "answer", title: r.label, source: "session", sessionId: r.sessionId, local: true,
        ...(r.waiting?.message ? { detail: r.waiting.message } : {}),
      });
      continue;
    }
    if (r.state === "err") {
      counts.failed++;
      failed.push({ kind: "failed", title: r.label, source: "session", sessionId: r.sessionId, local: true, ...(r.task ? { detail: r.task } : {}) });
      continue;
    }
    if (group === 1) fresh.push({ kind: "read", title: r.label, source: "session", sessionId: r.sessionId, local: true, ...(r.task ? { detail: r.task } : {}) });
  }
  return { counts, waiting, todo: [...failed, ...fresh] };
}

/**
 * The people the pane lists: the reader's pins first (with what the latest
 * brief says of them, where it says anything), then the brief's own, minus
 * anyone hidden. `pinned` on each says which button it wears.
 */
export function peopleShown(briefPeople: readonly BriefPerson[], choices: BriefView["people"]): (BriefPerson & { pinned: boolean })[] {
  const hidden = new Set(choices.hidden);
  const fromBrief = new Map(briefPeople.map(p => [p.key, p]));
  const out: (BriefPerson & { pinned: boolean })[] = [];
  const seen = new Set<string>();
  for (const p of choices.pinned) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    out.push({ ...p, ...(fromBrief.get(p.key) ?? {}), pinned: true });
  }
  for (const p of briefPeople) {
    if (seen.has(p.key) || hidden.has(p.key)) continue;
    seen.add(p.key);
    out.push({ ...p, pinned: false });
  }
  return out;
}

/** A brief's items whose session is gone from the board keep their words but
 *  lose the link that would select nothing; one with no other link goes. */
export function liveItems(items: readonly BriefItem[], sessions: ReadonlySet<string>): BriefItem[] {
  const out: BriefItem[] = [];
  for (const it of items) {
    const url = safeHref(it.url);
    const session = it.sessionId && sessions.has(it.sessionId) ? it.sessionId : undefined;
    if (!url && !session) continue;
    const next: BriefItem = { ...it };
    if (url) next.url = url; else delete next.url;
    if (session) next.sessionId = session; else delete next.sessionId;
    out.push(next);
  }
  return out;
}

/** How long something has waited, in its largest whole unit: minutes under
 *  an hour, hours under a day, else days. */
export function waitedFor(ms: number): { n: number; unit: "m" | "h" | "d" } {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return { n: m, unit: "m" };
  if (m < 24 * 60) return { n: Math.floor(m / 60), unit: "h" };
  return { n: Math.floor(m / (24 * 60)), unit: "d" };
}

/** Waiting on others as the page lists it: only what links somewhere it will
 *  draw, oldest ask first (the longest wait is the first to nudge), undated
 *  last. */
export function waitingOnShown(list: readonly WaitingOn[] | undefined): WaitingOn[] {
  const at = (w: WaitingOn) => (typeof w.askedAt === "number" && Number.isFinite(w.askedAt) ? w.askedAt : Number.MAX_SAFE_INTEGER);
  return (list ?? []).filter(w => safeHref(w.url) && w.person && w.title).sort((a, b) => at(a) - at(b));
}

/** Whether the page's interval should ask the deck for a run now. The deck
 *  decides for itself as well (status-brief.mjs refresh); this only saves the
 *  request when the answer is plainly no. */
export function autoDue(view: Pick<BriefView, "running" | "nextAutoAt" | "agent">, now: number): boolean {
  return view.agent === "ready" && !view.running && view.nextAutoAt != null && now >= view.nextAutoAt;
}
