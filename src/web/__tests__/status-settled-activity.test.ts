// Settled activity (fix/settled-activity): an entry of "Since last brief" whose
// PR needs nothing more of me (merged, closed, a draft, or I approved or
// reviewed it) is marked when the brief is written (status-gh.mjs
// activitySettledBy, read in the brief's one reviewViews call), dimmed on the
// pane and left out of its count. No process runs and nothing reaches a
// network: gh and the agent are fakes.
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTempDir } from "./rm-temp-dir";
import { activitySettledBy, normaliseActivity } from "../../server/status-gh.mjs";
import { createStatusBrief } from "../../server/status-brief.mjs";
import { Since } from "../components/StatusPane";
import type { BriefActivity } from "../status-brief";
import { resetLanguageForTest, t } from "../i18n";

const dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "settled-activity-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmTempDir(d); resetLanguageForTest(); });

const H = 3600_000;
const T0 = Date.parse("2026-11-25T18:00:00Z");
const ME = "haggrip";
const pr = (n: number) => `https://github.com/acme/api/pull/${n}`;
const iso = (at: number) => new Date(at).toISOString();
/** gh's REVIEW_VIEW of a PR. */
const view = (over: Record<string, unknown> = {}) => ({
  state: "OPEN", mergedAt: null, isDraft: false, reviewDecision: "REVIEW_REQUIRED", reviewRequests: [], author: { login: "dana" }, latestReviews: [], ...over,
});
const review = (login: string, state: string, at = T0) => ({ author: { login }, state, submittedAt: iso(at) });
/** One activity entry, as normaliseActivity keeps it. */
const entry = (over: Record<string, unknown> = {}) => ({
  url: pr(1), repo: "acme/api", number: 1, title: "Audit log consumer", author: "dana", mine: false, state: "open", at: T0 - H,
  events: [{ kind: "re-request", at: T0 - H }], ...over,
});

describe("whether an activity entry is settled", () => {
  it("merged or closed, by gh's read now or the activity's own, whoever's PR it is", () => {
    expect(activitySettledBy(entry(), view({ state: "MERGED", mergedAt: iso(T0) }), ME)).toBe("merged");
    expect(activitySettledBy(entry(), view({ mergedAt: iso(T0) }), ME)).toBe("merged");
    expect(activitySettledBy(entry(), view({ state: "CLOSED" }), ME)).toBe("closed");
    expect(activitySettledBy(entry({ mine: true, author: ME }), view({ state: "MERGED" }), ME)).toBe("merged");
    // gh could not read it again: what the activity read stands.
    expect(activitySettledBy(entry({ state: "merged" }), null, ME)).toBe("merged");
    expect(activitySettledBy(entry({ state: "closed" }), null, ME)).toBe("closed");
    expect(activitySettledBy(entry(), null, ME)).toBeNull();
  });

  it("the case that started it: re-requested, I approved, then it merged", () => {
    expect(activitySettledBy(entry(), view({ state: "MERGED", mergedAt: iso(T0), reviewDecision: "APPROVED", latestReviews: [review(ME, "APPROVED")] }), ME)).toBe("merged");
    expect(activitySettledBy(entry(), view({ reviewDecision: "APPROVED", latestReviews: [review(ME, "APPROVED")] }), ME)).toBe("approved");
  });

  it("someone else's PR: a draft, or my approval or review while I am not asked again", () => {
    expect(activitySettledBy(entry(), view({ isDraft: true }), ME)).toBe("draft");
    expect(activitySettledBy(entry(), view({ latestReviews: [review("HagGrip", "APPROVED")] }), ME)).toBe("approved");
    expect(activitySettledBy(entry(), view({ latestReviews: [review(ME, "CHANGES_REQUESTED")] }), ME)).toBe("reviewed");
    expect(activitySettledBy(entry(), view({ latestReviews: [review(ME, "COMMENTED")] }), ME)).toBe("reviewed");
    // A request of a team, not of me by name, does not hold it open.
    expect(activitySettledBy(entry(), view({ reviewRequests: [{ name: "platform" }], latestReviews: [review(ME, "APPROVED")] }), ME)).toBe("approved");
  });

  it("stands while I am asked again, my review is dismissed or older than new commits, or only others approved", () => {
    expect(activitySettledBy(entry(), view({ reviewRequests: [{ login: ME }], latestReviews: [review(ME, "APPROVED")] }), ME)).toBeNull();
    expect(activitySettledBy(entry(), view({ latestReviews: [review(ME, "DISMISSED")] }), ME)).toBeNull();
    expect(activitySettledBy(entry(), view({ reviewDecision: "APPROVED", latestReviews: [review("oren", "APPROVED")] }), ME)).toBeNull();
    const pushed = entry({ events: [{ kind: "pushed", at: T0 - H }] });
    expect(activitySettledBy(pushed, view({ latestReviews: [review(ME, "APPROVED", T0 - 2 * H)] }), ME)).toBeNull();
    expect(activitySettledBy(pushed, view({ latestReviews: [review(ME, "APPROVED", T0)] }), ME)).toBe("approved");
    // No account: nothing of mine to go by.
    expect(activitySettledBy(entry(), view({ latestReviews: [review(ME, "APPROVED")] }), "")).toBeNull();
  });

  it("my own open PR stands, approved, green or a draft: what moved on it is mine to answer", () => {
    const own = entry({ mine: true, author: ME, events: [{ kind: "comments", at: T0 - H }] });
    expect(activitySettledBy(own, view({ author: { login: ME }, reviewDecision: "APPROVED", latestReviews: [review("dana", "APPROVED")] }), ME)).toBeNull();
    expect(activitySettledBy(own, view({ author: { login: ME }, isDraft: true }), ME)).toBeNull();
  });

  it("is kept on a stored brief only as one of its known words", () => {
    const keep = (settled: unknown) => normaliseActivity({ since: T0 - H, items: [entry({ settled })] })!.items[0];
    expect(keep("approved").settled).toBe("approved");
    expect(keep("merged").settled).toBe("merged");
    expect(keep("hacked")).not.toHaveProperty("settled");
    expect(keep(undefined)).not.toHaveProperty("settled");
  });
});

describe("the brief marks what is settled", () => {
  const ITEMS = [
    entry({ url: pr(1), number: 1 }),                                                  // re-requested; since approved and merged
    entry({ url: pr(2), number: 2 }),                                                  // re-requested; since approved
    entry({ url: pr(3), number: 3, events: [{ kind: "pushed", at: T0 - H }] }),        // new commits after my approval
    entry({ url: pr(4), number: 4, mine: true, author: ME, events: [{ kind: "comments", at: T0 - H }] }),
    entry({ url: pr(5), number: 5, state: "closed", events: [{ kind: "closed", at: T0 - H }] }), // gh cannot read it now
  ];
  const VIEWS = new Map([
    [pr(1), view({ state: "MERGED", mergedAt: iso(T0 - 0.5 * H), reviewDecision: "APPROVED", latestReviews: [review(ME, "APPROVED", T0 - 0.6 * H)] })],
    [pr(2), view({ reviewDecision: "APPROVED", latestReviews: [review(ME, "APPROVED", T0 - 0.5 * H)] })],
    [pr(3), view({ latestReviews: [review(ME, "APPROVED", T0 - 2 * H)] })],
    [pr(4), view({ author: { login: ME }, reviewDecision: "APPROVED" })],
    [pr(9), view()],
  ]);

  function run({ waiting = [] as unknown[], watched = [] as unknown[], views = VIEWS as Map<string, unknown> | null } = {}) {
    const asked: string[][] = [];
    const handed: { activity?: { items: { settled?: string }[] } }[] = [];
    const b = createStatusBrief({
      dir: tempDir(), now: () => T0,
      agent: async () => ({ listConnectors: async () => [], runAgent: async () => ({ ok: true, json: { summary: "ok", waiting } }) }),
      sessions: async () => ({ rows: [], envelopes: [] }),
      github: {
        read: async () => ({ status: "on", account: ME, review: [], mine: [], linkStates: [], activity: { since: T0 - 2 * H, until: T0, facts: [], items: ITEMS } }),
        reviewViews: async (urls: string[]) => { asked.push(urls); return views; },
      },
      todo: { watched: async () => watched, dismissed: async () => [], brief: async (x: never) => { handed.push(x); return {}; } },
    });
    return { b, asked, handed };
  }
  const settledOf = (a: BriefActivity) => Object.fromEntries(a.items.map(i => [i.number, i.settled ?? null]));

  it("reads the activity's PRs in the same gh call as the review asks, each once, and records each outcome", async () => {
    const { b, asked } = run({
      waiting: [{ kind: "review", title: "Dana asks for a review", source: "slack", url: pr(9) }],
      watched: [{ url: pr(1), kind: "review" }],
    });
    await b.refresh(); await b.settled();
    expect(asked).toEqual([[9, 1, 2, 3, 4, 5].map(pr)]);
    const brief = (await b.view()).brief!;
    expect(settledOf(brief.activity as BriefActivity)).toEqual({ 1: "merged", 2: "approved", 3: null, 4: null, 5: "closed" });
    // The ask that still waits stays.
    expect((brief.waiting as { url?: string }[]).map(i => i.url)).toEqual([pr(9)]);
  });

  it("reads them with no review ask at all, and keeps the activity's own merged or closed without gh", async () => {
    const quiet = run();
    await quiet.b.refresh(); await quiet.b.settled();
    expect(quiet.asked).toEqual([[1, 2, 3, 4, 5].map(pr)]);
    expect(settledOf((await quiet.b.view()).brief!.activity as BriefActivity)).toEqual({ 1: "merged", 2: "approved", 3: null, 4: null, 5: "closed" });

    const blind = run({ views: null });
    await blind.b.refresh(); await blind.b.settled();
    expect(settledOf((await blind.b.view()).brief!.activity as BriefActivity)).toEqual({ 1: null, 2: null, 3: null, 4: null, 5: "closed" });
  });
});

describe("the pane's settled entries", () => {
  const activity = (items: Record<string, unknown>[]) => normaliseActivity({ since: T0 - 2 * H, items }) as BriefActivity;
  const draw = (a: BriefActivity) => renderToStaticMarkup(createElement(Since, { activity: a, t }));

  it("are dimmed, say how in place of their kind, and are not counted", () => {
    const html = draw(activity([
      entry({ url: pr(1), number: 1, at: T0 - H, settled: "merged" }),
      entry({ url: pr(2), number: 2, at: T0 - 2 * H }),
      entry({ url: pr(3), number: 3, at: T0 - 3 * H, settled: "approved" }),
      entry({ url: pr(4), number: 4, at: T0 - 4 * H, settled: "reviewed" }),
    ]));
    expect(html).toContain('<h3 class="stp-h" id="stp-since">Since last brief<span class="stp-n">1</span></h3>');
    expect(html).toContain('<li class="stp-item" data-kind="theirs" data-settled="merged"><span class="stp-kind">Merged</span>');
    expect(html).toContain('<li class="stp-item" data-kind="theirs"><span class="stp-kind">Reviewing</span>');
    expect(html).toContain('data-settled="approved"><span class="stp-kind">You approved</span>');
    expect(html).toContain('data-settled="reviewed"><span class="stp-kind">You reviewed</span>');
    // What moved is still said, and each still opens its PR.
    expect(html.match(/your review was requested again/g)).toHaveLength(4);
    expect(html).toContain(`href="${pr(1)}"`);
  });

  it("leave no count when every entry is settled, and a still-open one is counted as before", () => {
    const all = draw(activity([entry({ settled: "merged" }), entry({ url: pr(2), number: 2, settled: "draft" })]));
    expect(all).toContain('<h3 class="stp-h" id="stp-since">Since last brief</h3>');
    expect(all).toContain('<span class="stp-kind">Draft</span>');
    expect(all).not.toContain("Nothing moved");
    const none = draw(activity([entry(), entry({ url: pr(2), number: 2 })]));
    expect(none).toContain('<span class="stp-n">2</span>');
    expect(none).not.toContain("data-settled");
  });
});
