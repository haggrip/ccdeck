// What the brief put on the Todo list going stale (owner, 2026-11-25):
//  - a review asked of a channel for a PR that is a draft, or that someone
//    already approved, stayed on Waiting on you and the Todo list
//    (status-gh.mjs reviewSettledBy; the runner's gh check; status-todo.mjs
//    applyLinkStates);
//  - "Claude is blocked on a permission prompt", written from a session read
//    a minute before the person answered it, stayed open for hours
//    (status-todo.mjs movedOn, ingestBrief, reconcileDeck).
// No process runs and nothing reaches a network: gh and the agent are fakes.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTempDir } from "./rm-temp-dir";
import { createStatusBrief } from "../../server/status-brief.mjs";
import { reviewSettledBy, waitsOnMyReview } from "../../server/status-gh.mjs";
import { applyLinkStates, ingestBrief, movedOn, normaliseStore, reconcileDeck } from "../../server/status-todo.mjs";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmTempDir(d); });
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "stale-items-")); dirs.push(d); return d; };

const ME = "hagai";
const pr = (n: number) => `https://github.com/acme/api/pull/${n}`;
const review = (login: string, state: string) => ({ author: { login }, state });
const open = (over: object = {}) => ({ state: "OPEN", mergedAt: null, isDraft: false, reviewDecision: "REVIEW_REQUIRED", reviewRequests: [], author: { login: "dana" }, latestReviews: [], ...over });

describe("a PR someone asked me to review", () => {
  it("does not wait on me while it is a draft", () => {
    expect(reviewSettledBy(open({ isDraft: true }), ME)).toBe("draft");
    expect(reviewSettledBy(open({ isDraft: true, reviewRequests: [{ login: "Hagai" }] }), ME)).toBe("draft");
    expect(waitsOnMyReview(open({ isDraft: true }), ME)).toBe(false);
  });

  it("does not once anyone but its author approved it, though GitHub still asks for more", () => {
    // The PR the owner saw: a draft, one approval, two bots' comments, and
    // GitHub's decision still REVIEW_REQUIRED.
    const seen = open({
      isDraft: true, reviewRequests: [{ login: "Bakalash-Ori" }, { login: "ZeevSha" }],
      latestReviews: [review("grip-monkey", "COMMENTED"), review("elianaGrip", "COMMENTED"), review("Oren-Arazi", "APPROVED")],
    });
    expect(reviewSettledBy(seen, ME)).toBe("draft");
    expect(reviewSettledBy({ ...seen, isDraft: false }, ME)).toBe("approved");
    // The author's own approval is none.
    expect(reviewSettledBy(open({ latestReviews: [review("Dana", "APPROVED")] }), ME)).toBeNull();
  });

  it("still waits on me when someone's changes stand, or when gh names me among its requested reviewers", () => {
    expect(reviewSettledBy(open({ reviewDecision: "CHANGES_REQUESTED", latestReviews: [review("lee", "CHANGES_REQUESTED"), review("oren", "APPROVED")] }), ME)).toBeNull();
    // Asked of me by name: one approval does not answer it, nor my old verdict.
    expect(reviewSettledBy(open({ reviewRequests: [{ login: "Hagai" }], latestReviews: [review("oren", "APPROVED")] }), ME)).toBeNull();
    expect(reviewSettledBy(open({ reviewRequests: [{ login: ME }], latestReviews: [review(ME, "CHANGES_REQUESTED")] }), ME)).toBeNull();
    // A team asked is not me by name.
    expect(reviewSettledBy(open({ reviewRequests: [{ name: "backend", slug: "backend" }], latestReviews: [review("oren", "APPROVED")] }), ME)).toBe("approved");
    // GitHub's own decision settles it either way.
    expect(reviewSettledBy(open({ reviewRequests: [{ login: ME }], reviewDecision: "APPROVED" }), ME)).toBe("approved");
  });

  it("says why it is settled, as the Todo list's link state", () => {
    expect(reviewSettledBy(open({ state: "MERGED", mergedAt: "2026-11-25T08:00:00Z", isDraft: true }), ME)).toBe("merged");
    expect(reviewSettledBy(open({ state: "CLOSED" }), ME)).toBe("closed");
    expect(reviewSettledBy(open({ author: { login: ME } }), ME)).toBe("mine");
    expect(reviewSettledBy(open({ latestReviews: [review(ME, "CHANGES_REQUESTED")] }), ME)).toBe("reviewed");
    // My own approval is an approval like anyone's.
    expect(reviewSettledBy(open({ latestReviews: [review(ME, "APPROVED")] }), ME)).toBe("approved");
    expect(reviewSettledBy(null, ME)).toBeNull();
  });
});

describe("the brief's runner and the reviews it checks with gh", () => {
  const ASKED = [
    { kind: "review", title: "Waits", source: "slack", url: pr(1), person: "Dana" },
    { kind: "review", title: "A draft", source: "slack", url: pr(2), person: "Ori" },
    { kind: "review", title: "Oren approved it", source: "slack", url: pr(3), person: "Ori" },
    { kind: "review", title: "Asked of me by name, Oren approved", source: "github", url: pr(4) },
    { kind: "review", title: "A draft asked of me by name", source: "github", url: pr(5) },
  ];
  const VIEWS = new Map<string, object>([
    [pr(1), open()],
    [pr(2), open({ isDraft: true })],
    [pr(3), open({ latestReviews: [review("oren", "APPROVED")] })],
    [pr(4), open({ reviewRequests: [{ login: ME }], latestReviews: [review("oren", "APPROVED")] })],
    [pr(5), open({ isDraft: true, reviewRequests: [{ login: ME }] })],
    // What the Todo list already tracks.
    [pr(10), open({ isDraft: true })],
    [pr(11), open({ latestReviews: [review("oren", "APPROVED")] })],
    [pr(12), open()],
    [pr(13), open({ author: { login: ME } })],
    [pr(14), open({ latestReviews: [review(ME, "CHANGES_REQUESTED")] })],
  ]);
  const WATCHED = [
    { url: pr(10), kind: "review" }, { url: pr(11), kind: "review" }, { url: pr(12), kind: "review" },
    { url: pr(13), kind: "review" }, { url: pr(14), kind: "review" }, { url: pr(3), kind: "review" },
    { url: pr(20), kind: "merge" }, { url: "https://acme.atlassian.net/browse/API-1", kind: "review" },
  ];

  async function run() {
    const asked: string[][] = [];
    const handed: { waiting: { title: string }[]; linkStates: { url: string; state: string }[] }[] = [];
    const b = createStatusBrief({
      dir: tempDir(), now: () => Date.UTC(2026, 10, 25, 12, 0, 0),
      agent: async () => ({ listConnectors: async () => [], runAgent: async () => ({ ok: true, json: { summary: "ok", waiting: ASKED } }) }),
      sessions: async () => ({ rows: [], envelopes: [] }),
      github: {
        read: async () => ({ status: "on", account: ME, review: [], mine: [], linkStates: [{ url: pr(12), state: "open" }] }),
        reviewViews: async (urls: string[]) => { asked.push(urls); return VIEWS; },
      },
      todo: { watched: async () => WATCHED, dismissed: async () => [], brief: async (x: never) => { handed.push(x); return {}; } },
    });
    await b.refresh(); await b.settled();
    return { asked, handed };
  }

  it("drops a draft, and a channel's ask anyone approved, from Waiting on you", async () => {
    const { handed } = await run();
    expect(handed[0].waiting.map(i => i.title)).toEqual(["Waits", "Asked of me by name, Oren approved"]);
  });

  it("closes the reviews the Todo list tracks by the same rule, and reads each PR once", async () => {
    const { asked, handed } = await run();
    expect(asked).toEqual([[1, 2, 3, 4, 5, 10, 11, 12, 13, 14].map(pr)]);
    const states = handed[0].linkStates;
    expect(states).toEqual(expect.arrayContaining([
      { url: pr(10), state: "draft" }, { url: pr(11), state: "approved" }, { url: pr(14), state: "reviewed" }, { url: pr(3), state: "approved" },
      { url: pr(12), state: "open" },
    ]));
    // Still waiting, mine, and not a review: no state of this check's.
    expect(states.filter(l => [pr(12), pr(13), pr(20)].includes(l.url))).toEqual([{ url: pr(12), state: "open" }]);
  });
});

describe("the Todo list's review items", () => {
  it("close on a draft or my own review, and nothing else on the same PR does", () => {
    const s = normaliseStore(null);
    ingestBrief(s, { waiting: [
      { kind: "review", title: "Review #1", url: pr(1) },
      { kind: "review", title: "Review #2", url: pr(2) },
    ], todo: [{ kind: "todo", title: "Write the migration for #1", url: pr(1) }] }, 1);
    expect(applyLinkStates(s, [{ url: pr(1), state: "draft" }, { url: pr(2), state: "reviewed" }], 2)).toBe(true);
    const by = Object.fromEntries(s.items.map(i => [i.title, i]));
    expect(by["Review #1"]).toMatchObject({ state: "closed", closedReason: "A draft: not up for review" });
    expect(by["Review #2"]).toMatchObject({ state: "closed", closedReason: "You reviewed it" });
    expect(by["Write the migration for #1"].state).toBe("open");
  });
});

describe("a brief item about a session", () => {
  const SID = "39c3da4c-0087-4f7e-b23c-374919699583";
  const WAITED = 1_000;
  const waiting = (since = WAITED) => ({ id: SID, name: "ServiceNow guide", state: "waiting", since, lastEventAt: since, waiting: { kind: "permission", message: "Claude needs your permission to use AskUserQuestion", since } });
  const working = (since = 500) => ({ id: SID, name: "ServiceNow guide", state: "working", since, lastEventAt: 5_000, waiting: null });
  const asked = { kind: "decide", title: "ServiceNow guide: Claude is blocked on a permission prompt", sessionId: SID, seen: { state: "waiting", since: WAITED } };

  it("is not added when the session moved on while the model wrote the brief", () => {
    const s = normaliseStore(null);
    // Answered a minute before the brief came back: the turn runs on, from
    // the same prompt, so only its state tells.
    expect(ingestBrief(s, { waiting: [asked] }, 2_000, { rows: [working()] })).toEqual([]);
    expect(s.items).toEqual([]);
  });

  it("is added, with the session as the brief read it, while the session is as it was", () => {
    const t = normaliseStore(null);
    // A later notice of the same idle input box leaves its state and since
    // as they were: it has not moved on.
    const [added] = ingestBrief(t, { waiting: [{ ...asked, seen: { state: "idle", since: 400 } }] }, 2_000, { rows: [{ id: SID, state: "idle", since: 400, lastEventAt: 1_900 }] });
    expect(added).toMatchObject({ origin: "brief", kind: "decide", seen: { state: "idle", since: 400 } });
    // It survives a save and a load.
    expect(normaliseStore(JSON.parse(JSON.stringify(t))).items[0].seen).toEqual({ state: "idle", since: 400 });
  });

  it("closes once the session moves on, and stays while it does not", () => {
    const s = normaliseStore(null);
    const [item] = ingestBrief(s, { waiting: [{ ...asked, seen: { state: "idle", since: 400 } }] }, 2_000, { rows: [] });
    expect(reconcileDeck(s, [{ id: SID, state: "idle", since: 400, lastEventAt: 900 }], [], 3_000)).toBe(false);
    expect(item.state).toBe("open");
    expect(reconcileDeck(s, [working(2_500)], [], 4_000)).toBe(true);
    expect(item).toMatchObject({ state: "closed", closedBy: "deck", closedReason: "The session moved on" });
  });

  it("closes, from before the brief said how it read the session, once the session's state began after the item", () => {
    const s = normaliseStore({ v: 1, items: [{ id: "t_3b9cf0558389", title: "ServiceNow guide: blocked on a permission prompt", origin: "brief", kind: "decide",
      key: `session:${SID}:brief:decide`, link: { kind: "session", sessionId: SID }, state: "open", createdAt: 2_000, updatedAt: 2_000 }] });
    expect(reconcileDeck(s, [{ id: SID, state: "idle", since: 1_500, lastEventAt: 1_500 }], [], 3_000)).toBe(false);
    expect(reconcileDeck(s, [{ id: SID, state: "idle", since: 2_600, lastEventAt: 2_600 }], [], 3_000)).toBe(true);
    expect(s.items[0]).toMatchObject({ state: "closed", closedReason: "The session moved on" });
  });

  it("is judged by its session only when it links no page", () => {
    const s = normaliseStore(null);
    ingestBrief(s, { waiting: [{ kind: "review", title: "Review #1", url: pr(1), sessionId: SID }] }, 2_000);
    expect(reconcileDeck(s, [working(9_000)], [], 10_000)).toBe(false);
    expect(s.items[0].state).toBe("open");
    expect(movedOn({ seen: { state: "waiting", since: 1 } }, null)).toBe(false);
  });

  it("is told by the brief how it read the session", async () => {
    const handed: { waiting: { sessionId?: string; seen?: unknown }[] }[] = [];
    const b = createStatusBrief({
      dir: tempDir(), now: () => Date.UTC(2026, 10, 25, 12, 0, 0),
      agent: async () => ({ listConnectors: async () => [], runAgent: async () => ({ ok: true, json: { summary: "ok", waiting: [
        { kind: "decide", title: "Blocked", sessionId: SID },
        { kind: "review", title: "Its PR", source: "github", sessionId: SID, url: pr(1) },
      ] } }) }),
      sessions: async () => ({ rows: [waiting()], envelopes: [] }),
      todo: { watched: async () => [], dismissed: async () => [], brief: async (x: never) => { handed.push(x); return {}; } },
    });
    await b.refresh(); await b.settled();
    expect(handed[0].waiting[0].seen).toEqual({ state: "waiting", since: WAITED });
    expect(handed[0].waiting[1].seen).toBeUndefined();
  });
});
