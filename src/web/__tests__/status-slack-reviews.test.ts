// Review requests posted in Slack channels (status-brief.mjs slackAsk, the
// runner's gh check; status-gh.mjs prUrlOf, waitsOnMyReview, reviewViews).
// The model finds the asks in the channels the person is a member of; gh
// decides which still wait on them. No process runs and nothing reaches a
// network: gh, the agent and the connectors are fakes.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTempDir } from "./rm-temp-dir";
import { MAX_WAITING, SLACK_REVIEW_LOOKBACK_MS, buildPrompt, createStatusBrief, normaliseBrief } from "../../server/status-brief.mjs";
import { MAX_WATCH, createGitHubReader, prUrlOf, waitsOnMyReview } from "../../server/status-gh.mjs";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmTempDir(d); });
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "slack-reviews-")); dirs.push(d); return d; };

const ME = "hagai";
const pr = (n: number) => `https://github.com/acme/api/pull/${n}`;
const review = (login: string, state: string) => ({ author: { login }, state });
const open = (over: object = {}) => ({ state: "OPEN", mergedAt: null, reviewDecision: "REVIEW_REQUIRED", author: { login: "dana" }, latestReviews: [], ...over });

describe("the PR a Slack message links", () => {
  it("is the PR's own page, whatever page under it the message linked", () => {
    expect(prUrlOf(pr(7))).toBe(pr(7));
    expect(prUrlOf(`${pr(7)}/files`)).toBe(pr(7));
    expect(prUrlOf(`${pr(7)}/files#diff-abc`)).toBe(pr(7));
    expect(prUrlOf(`${pr(7)}?w=1`)).toBe(pr(7));
    expect(prUrlOf(`${pr(7)}#issuecomment-1`)).toBe(pr(7));
  });

  it("is nothing for a link that is not a pull request on github.com", () => {
    for (const bad of [
      "https://github.com/acme/api/issues/7", "https://github.com/acme/api/pull/", "http://github.com/acme/api/pull/7",
      "https://github.com.evil.example/acme/api/pull/7", "https://api.github.com/repos/acme/api/pulls/7",
      "https://github.com/acme/api/pull/7x", "https://github.com/-acme/api/pull/7", null, 7,
    ]) expect(prUrlOf(bad), String(bad)).toBeNull();
  });
});

describe("whether a PR asked for in Slack still waits on me", () => {
  it("does while it is open, not approved, someone else's, and not reviewed to a verdict by me", () => {
    expect(waitsOnMyReview(open(), ME)).toBe(true);
    // Commenting is not a verdict: it still waits on me.
    expect(waitsOnMyReview(open({ latestReviews: [review(ME, "COMMENTED")] }), ME)).toBe(true);
    // Someone else asked for changes; mine is still wanted.
    expect(waitsOnMyReview(open({ reviewDecision: "CHANGES_REQUESTED", latestReviews: [review("lee", "CHANGES_REQUESTED")] }), ME)).toBe(true);
  });

  it("does not once it is merged, closed or approved, if it is mine, or if I approved it or asked for changes", () => {
    expect(waitsOnMyReview(open({ state: "MERGED", mergedAt: "2026-11-25T08:00:00Z" }), ME)).toBe(false);
    expect(waitsOnMyReview(open({ state: "CLOSED" }), ME)).toBe(false);
    expect(waitsOnMyReview(open({ reviewDecision: "APPROVED" }), ME)).toBe(false);
    expect(waitsOnMyReview(open({ author: { login: "Hagai" } }), ME)).toBe(false);
    // Two approvals needed: mine is in, so it no longer waits on me.
    expect(waitsOnMyReview(open({ latestReviews: [review("HAGAI", "APPROVED")] }), ME)).toBe(false);
    expect(waitsOnMyReview(open({ latestReviews: [review(ME, "CHANGES_REQUESTED")] }), ME)).toBe(false);
  });

  it("stands as asked when gh could not read it, and judges only what it can without an account", () => {
    expect(waitsOnMyReview(null, ME)).toBe(true);
    expect(waitsOnMyReview(open({ author: { login: ME } }), "")).toBe(true);
    expect(waitsOnMyReview(open({ reviewDecision: "APPROVED" }), "")).toBe(false);
  });
});

describe("gh's view of those PRs", () => {
  function fakeGh(views: Record<string, object | null>) {
    const calls: string[][] = [];
    const run = async (_file: string, args: string[]) => {
      calls.push(args);
      if (args.join(" ") === "--version") return { code: 0, stdout: "gh version 2.95.0", stderr: "" };
      const v = args[0] === "pr" && args[1] === "view" ? views[args[2]] : undefined;
      return v ? { code: 0, stdout: JSON.stringify(v), stderr: "" } : { code: 1, stdout: "", stderr: "GraphQL: Could not resolve to a PullRequest" };
    };
    return { calls, run };
  }

  it("reads each PR once, by its own page, with a fixed argv, and leaves out what it could not read", async () => {
    const gh = fakeGh({ [pr(1)]: open(), [pr(2)]: open({ reviewDecision: "APPROVED" }) });
    const views = await createGitHubReader({ run: gh.run, exists: async () => false }).reviewViews([`${pr(1)}/files`, pr(1), pr(2), pr(3), "https://evil.example/x", 42]);
    expect([...views!.keys()]).toEqual([pr(1), pr(2)]);
    expect(views!.get(pr(2))).toMatchObject({ reviewDecision: "APPROVED" });
    const viewed = gh.calls.filter(a => a[0] === "pr");
    expect(viewed).toEqual([1, 2, 3].map(n => ["pr", "view", pr(n), "--json", "state,mergedAt,reviewDecision,author,latestReviews"]));
  });

  it("reads at most MAX_WATCH, and nothing without gh", async () => {
    const gh = fakeGh({});
    await createGitHubReader({ run: gh.run, exists: async () => false }).reviewViews(Array.from({ length: MAX_WATCH + 5 }, (_, i) => pr(i + 1)));
    expect(gh.calls.filter(a => a[0] === "pr")).toHaveLength(MAX_WATCH);
    const none = async () => ({ code: 1, stdout: "", stderr: "", errno: "ENOENT" });
    expect(await createGitHubReader({ run: none, exists: async () => false }).reviewViews([pr(1)])).toBeNull();
  });
});

describe("the brief's Slack ask", () => {
  const SEARCH = "mcp__s__slack_search_public_and_private";
  const slackLine = (since: number, now: number, tools = [SEARCH, "mcp__s__slack_read_thread"]) =>
    buildPrompt({ sessions: [], reach: { github: "none", slack: "on", jira: "none" }, tools, since, now }).split("\n").find(l => l.startsWith("- Slack:"))!;

  it("has the channels I am a member of searched for review requests, three days back, from anyone", () => {
    const now = Date.UTC(2026, 10, 25, 12, 0, 0);
    const since = now - 3600_000;
    const line = slackLine(since, now);
    expect(line).toMatch(/review requests in the channels I am a member of since/);
    expect(line).toMatch(/every message from a person that links https:\/\/github\.com\/<owner>\/<repo>\/pull\/<n>, whether or not it mentions me or asks in words\. A bare link counts/);
    expect(line).toMatch(/Skip posts by bots and automations \(CI, deploys, test reports, stale-PR notices\), my own messages/);
    // "pull" finds the links (a link's path is indexed); "github.com" also
    // matched every CI post. Bots fill a page, so it reads three.
    expect(line).toContain(`keywords ["pull"], only_my_channels true, channel_types "public_channel,private_channel", "after" set to ${(now - SLACK_REVIEW_LOOKBACK_MS) / 1000}, sorted by timestamp, response_format "detailed" and include_context false, reading up to 3 pages`);
    // The DM and thread searches keep their own, shorter window.
    expect(line).toContain(`"after" set to ${since / 1000}, sorted by timestamp, response_format "detailed" and include_context false: once with channel_types "im,mpim"`);
  });

  it("asks for the detailed answer, whose permalink links each Slack item", () => {
    const line = slackLine(0, Date.UTC(2026, 10, 25));
    expect(line.match(/response_format "detailed"/g)).toHaveLength(2);
    expect(line).toMatch(/Link each such item by its message's permalink\./);
  });

  it("asks for each as a review item linked to the PR, mine left out, and leaves the verdict to gh", () => {
    const line = slackLine(0, 0);
    expect(line).toMatch(/"review" item in "waiting" with "url" set to the pull request's own link \(not the Slack message's\), "source" "slack", "person" who posted it/);
    expect(line).toMatch(/Leave out pull requests I opened/);
    expect(line).toMatch(/Do not judge whether one is approved, merged or closed: the deck checks each with gh/);
    expect(line).toMatch(/Count them when you say what waits on me/);
  });

  it("looks further back than three days when the last brief did", () => {
    const now = Date.UTC(2026, 10, 25, 12, 0, 0);
    const since = now - 5 * 24 * 3600_000;
    expect(slackLine(since, now)).toContain(`channel_types "public_channel,private_channel", "after" set to ${since / 1000}, sorted by timestamp`);
  });

  it("names no search when the run has none", () => {
    const line = slackLine(0, 0, []);
    expect(line).toMatch(/channels I am a member of/);
    expect(line).not.toMatch(/mcp__|only_my_channels/);
  });
});

describe("room on Waiting on you", () => {
  it("keeps up to MAX_WAITING, so gh judges the requests before any are cut", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ kind: "review", title: `#${i}`, source: "slack", url: pr(i + 1) }));
    expect(MAX_WAITING).toBe(24);
    expect(normaliseBrief({ waiting: many, todo: many.map(m => ({ ...m, kind: "todo" })) })).toMatchObject({
      waiting: expect.arrayContaining([expect.objectContaining({ title: "#23" })]),
    });
    const b = normaliseBrief({ waiting: many, todo: many.map(m => ({ ...m, kind: "todo" })) });
    expect(b.waiting).toHaveLength(MAX_WAITING);
    expect(b.todo).toHaveLength(12);
  });
});

describe("the brief's runner and the review requests it found", () => {
  const ASKED = [
    { kind: "review", title: "Dana asks for a review of acme/api#1", source: "slack", url: `${pr(1)}/files`, person: "Dana", detail: "#backend" },
    { kind: "review", title: "Approved already", source: "slack", url: pr(2), person: "Lee" },
    { kind: "review", title: "My own PR", source: "slack", url: pr(3), person: "Lee" },
    { kind: "review", title: "I asked for changes", source: "slack", url: pr(4), person: "Kim" },
    { kind: "review", title: "Merged", source: "slack", url: pr(5), person: "Kim" },
    { kind: "review", title: "gh cannot read it", source: "slack", url: pr(6), person: "Kim" },
    { kind: "review", title: "Requested on GitHub", source: "github", url: pr(2) },
    { kind: "reply", title: "A DM", source: "slack", url: "https://acme.slack.com/archives/D1/p1" },
  ];
  const VIEWS = new Map<string, object>([
    [pr(1), open()],
    [pr(2), open({ reviewDecision: "APPROVED" })],
    [pr(3), open({ author: { login: ME } })],
    [pr(4), open({ latestReviews: [review(ME, "CHANGES_REQUESTED")] })],
    [pr(5), open({ state: "MERGED", mergedAt: "2026-11-25T08:00:00Z" })],
  ]);

  function run(github: object | null) {
    const asked: string[][] = [];
    const handed: { waiting: { title: string; url?: string; dkey?: string }[] }[] = [];
    const b = createStatusBrief({
      dir: tempDir(), now: () => Date.UTC(2026, 10, 25, 12, 0, 0),
      agent: async () => ({ listConnectors: async () => [], runAgent: async () => ({ ok: true, json: { summary: "ok", waiting: ASKED } }) }),
      sessions: async () => ({ rows: [], envelopes: [] }),
      github: github && { read: async () => ({ status: "on", account: ME, review: [], mine: [], linkStates: [] }), ...github,
        reviewViews: async (urls: string[]) => { asked.push(urls); return VIEWS; } },
      todo: { watched: async () => [], dismissed: async () => [], brief: async (x: never) => { handed.push(x); return {}; } },
    });
    return { b, asked, handed };
  }

  it("keeps only the ones that still wait on me, linked by the PR's own page, and hands those to the Todo list", async () => {
    const { b, asked, handed } = run({});
    await b.refresh(); await b.settled();
    expect(asked).toEqual([[1, 2, 3, 4, 5, 6].map(pr)]);
    const waiting = (await b.view()).brief!.waiting as { title: string; url?: string; dkey?: string }[];
    expect(waiting.map(i => i.title)).toEqual(["Dana asks for a review of acme/api#1", "gh cannot read it", "Requested on GitHub", "A DM"]);
    expect(waiting[0].url).toBe(pr(1));
    expect(waiting[0].dkey).toBe(`url:${pr(1)}`);
    expect(handed[0].waiting.map(i => i.title)).toEqual(waiting.map(i => i.title));
  });

  it("checks nothing and drops nothing with GitHub off", async () => {
    const { b, asked } = run(null);
    await b.refresh(); await b.settled();
    expect(asked).toEqual([]);
    expect(((await b.view()).brief!.waiting as unknown[]).length).toBe(ASKED.length);
  });
});
