// The PRs and tickets each session works on, as the deck works them out from
// what the session itself did (src/server/session-links.mjs), and the session
// each open Todo item is about. Mission shows them as chips under a live
// session and puts that session's "Open in Claude Desktop" on the item.
//
// Pure, so a bare-node suite can call all of it. Every address is held to
// https before it goes into a link, whatever the deck sent.
import { safeHref } from "./status-brief";

export const SESSION_LINKS_ROUTE = "/api/session-links";

export type PrState = "open" | "draft" | "merged" | "closed";
export type PrChecks = "pass" | "fail" | "pending";
export type PrReview = "approved" | "changes" | "required";

export interface SessionPr {
  url: string;
  repo: string | null;
  number: number | null;
  /** How the session came to it: created, branch, pushed, worked, viewed. */
  how: string;
  /** As the brief's gh reads last saw it; absent when they never read it. */
  state?: PrState;
  checks?: PrChecks | null;
  review?: PrReview | null;
}

export interface SessionKey {
  key: string;
  /** branch, title, commit, pr, wrote, read. */
  how: string;
  url?: string;
}

export interface SessionLinks { prs: SessionPr[]; keys: SessionKey[] }

export interface SessionLinksView {
  /** Claude Code session id: its PRs and tickets. */
  sessions: Readonly<Record<string, SessionLinks>>;
  /** Todo item id: the session it is about. */
  items: Readonly<Record<string, string>>;
}

export const NO_LINKS: SessionLinksView = Object.freeze({ sessions: Object.freeze({}), items: Object.freeze({}) });

const PR_STATES: readonly string[] = ["open", "draft", "merged", "closed"];
const CHECKS: readonly string[] = ["pass", "fail", "pending"];
const REVIEWS: readonly string[] = ["approved", "changes", "required"];
const KEY = /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/;
const SID = /^[\w.:-]{1,120}$/;
const pick = <T extends string>(v: unknown, list: readonly string[]): T | null => (typeof v === "string" && list.includes(v) ? v as T : null);

function prFrom(raw: unknown): SessionPr | null {
  const r = raw as Partial<SessionPr> | null;
  const url = safeHref(r?.url ?? null);
  if (!url || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(url)) return null;
  const state = pick<PrState>(r?.state, PR_STATES);
  return {
    url,
    repo: typeof r?.repo === "string" ? r.repo : null,
    number: Number.isInteger(r?.number) ? r!.number! : null,
    how: typeof r?.how === "string" ? r.how : "worked",
    ...(state ? { state, checks: pick<PrChecks>(r?.checks, CHECKS), review: pick<PrReview>(r?.review, REVIEWS) } : {}),
  };
}

function keyFrom(raw: unknown): SessionKey | null {
  const r = raw as Partial<SessionKey> | null;
  if (typeof r?.key !== "string" || !KEY.test(r.key)) return null;
  const url = safeHref(r.url ?? null);
  return { key: r.key, how: typeof r.how === "string" ? r.how : "read", ...(url ? { url } : {}) };
}

/** The route's answer, held to its shapes. */
export function linksFrom(raw: unknown): SessionLinksView {
  const v = raw as { ok?: boolean; sessions?: unknown; items?: unknown } | null;
  if (!v?.ok) return NO_LINKS;
  const sessions: Record<string, SessionLinks> = {};
  if (v.sessions && typeof v.sessions === "object") {
    for (const [id, s] of Object.entries(v.sessions as Record<string, { prs?: unknown; keys?: unknown }>)) {
      if (!SID.test(id)) continue;
      const prs = (Array.isArray(s?.prs) ? s.prs : []).map(prFrom).filter((p): p is SessionPr => p != null);
      const keys = (Array.isArray(s?.keys) ? s.keys : []).map(keyFrom).filter((k): k is SessionKey => k != null);
      if (prs.length || keys.length) sessions[id] = { prs, keys };
    }
  }
  const items: Record<string, string> = {};
  if (v.items && typeof v.items === "object") {
    for (const [id, sid] of Object.entries(v.items as Record<string, unknown>)) {
      if (/^t_[a-z0-9]{6,24}$/.test(id) && typeof sid === "string" && SID.test(sid)) items[id] = sid;
    }
  }
  return { sessions, items };
}

/** What a PR chip's colour says, most pressing first: done with (merged,
 *  closed), not up yet (draft), red checks, changes asked, checks running,
 *  approved, green, else just open. Null when gh never read it. */
export type PrTone = PrState | "fail" | "changes" | "pending" | "approved" | "pass";
export function prTone(pr: SessionPr): PrTone | null {
  if (!pr.state) return null;
  if (pr.state !== "open") return pr.state;
  if (pr.checks === "fail") return "fail";
  if (pr.review === "changes") return "changes";
  if (pr.checks === "pending") return "pending";
  if (pr.review === "approved") return "approved";
  if (pr.checks === "pass") return "pass";
  return "open";
}

const STATE_MSGS = { open: "brief.pr.open", draft: "brief.pr.draft", merged: "brief.pr.merged", closed: "brief.pr.closed" } as const;
const CHECK_MSGS = { pass: "brief.pr.checks.pass", fail: "brief.pr.checks.fail", pending: "brief.pr.checks.pending" } as const;
const REVIEW_MSGS = { approved: "brief.pr.review.approved", changes: "brief.pr.review.changes", required: "brief.pr.review.required" } as const;

/** The words a PR chip's title gives its state, each an i18n key. */
export function prStateWords(pr: SessionPr): string[] {
  if (!pr.state) return [];
  if (pr.state !== "open") return [STATE_MSGS[pr.state]];
  const out: string[] = [];
  if (pr.checks) out.push(CHECK_MSGS[pr.checks]);
  if (pr.review) out.push(REVIEW_MSGS[pr.review]);
  return out.length ? out : [STATE_MSGS.open];
}
