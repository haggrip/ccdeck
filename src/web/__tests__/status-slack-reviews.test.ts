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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MAX_IGNORED_CHANNELS, MAX_WAITING, SLACK_REVIEW_LOOKBACK_MS, buildPrompt, channelName, createStatusBrief, fromIgnoredChannel, normaliseBrief, normaliseSettings,
} from "../../server/status-brief.mjs";
import { channelNames, type BriefView } from "../status-brief";
import { Settings } from "../components/StatusPane";
import { t } from "../i18n";
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
    // The summary is written before gh's check: it neither counts nor
    // describes them, and says no total, so it cannot say seven where gh
    // left two, nor that nothing waits.
    expect(line).toMatch(/in the summary, neither count nor describe these review requests, give no total of what waits on me, and never say that nothing does/);
    expect(line).not.toMatch(/Count them/);
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

describe("Slack channels the brief ignores", () => {
  it("are kept by name: lower case, no #, Slack's alphabet, each once, at most MAX_IGNORED_CHANNELS", () => {
    expect([channelName("#PRS-Data-Platform"), channelName(" eyes-on-prs_saas "), channelName("a.b")]).toEqual(["prs-data-platform", "eyes-on-prs_saas", "a.b"]);
    for (const bad of ["", "#", "-x", "a b", "a,b", "x".repeat(81), "in:#x", 7, null]) expect(channelName(bad as string), String(bad)).toBeNull();
    expect(normaliseSettings({}).slackIgnore).toEqual([]);
    expect(normaliseSettings({ slackIgnore: ["#prs-data-platform", "PRS-DATA-PLATFORM", "no way", 3] }).slackIgnore).toEqual(["prs-data-platform"]);
    expect(normaliseSettings({ slackIgnore: Array.from({ length: 40 }, (_, i) => `c${i}`) }).slackIgnore).toHaveLength(MAX_IGNORED_CHANNELS);
    expect(channelNames("#prs-data-platform, Eyes-On  #bad name!")).toEqual(["prs-data-platform", "eyes-on", "bad"]);
  });

  it("are left out of the search itself and named in the ask", () => {
    const line = buildPrompt({ sessions: [], reach: { github: "none", slack: "on", jira: "none" }, tools: ["mcp__s__slack_search_public_and_private"], since: 0, now: 0,
      slackIgnore: ["prs-data-platform", "noise", "in:#x"] }).split("\n").find(l => l.startsWith("- Slack:"))!;
    expect(line).toContain('keywords ["pull"], filters "-in:#prs-data-platform -in:#noise", only_my_channels true');
    expect(line).toContain("Leave out everything posted in #prs-data-platform, #noise.");
    expect(line).not.toContain("in:#x");
    const none = buildPrompt({ sessions: [], reach: { github: "none", slack: "on", jira: "none" }, tools: ["mcp__s__slack_search_public_and_private"], since: 0, now: 0 });
    expect(none).not.toMatch(/-in:#|Leave out everything posted in/);
  });

  it("drop an item by its channel, else by a #channel its words name, and only a Slack one", () => {
    const ignore = new Set(["prs-data-platform"]);
    const kept = normaliseBrief({ waiting: [{ kind: "review", title: "x", source: "slack", url: pr(1), channel: "#PRS-Data-Platform" }] }).waiting[0];
    expect(kept.channel).toBe("prs-data-platform");
    expect(fromIgnoredChannel(kept, ignore)).toBe(true);
    expect(fromIgnoredChannel({ source: "slack", title: "x", detail: "posted in #prs-data-platform" }, ignore)).toBe(true);
    expect(fromIgnoredChannel({ source: "slack", title: "x", channel: "eyes-on-prs-saas", detail: "also in #prs-data-platform" }, ignore)).toBe(false);
    expect(fromIgnoredChannel({ source: "github", title: "#prs-data-platform" }, ignore)).toBe(false);
    expect(fromIgnoredChannel({ source: "slack", title: "x", channel: "prs-data-platform" }, new Set())).toBe(false);
    // A GitHub item keeps no channel.
    expect(normaliseBrief({ waiting: [{ kind: "review", title: "x", source: "github", url: pr(1), channel: "c" }] }).waiting[0].channel).toBeUndefined();
  });

  it("are saved from the settings, and nothing from them reaches the brief or gh", async () => {
    const asked: string[][] = [];
    const prompts: string[] = [];
    const b = createStatusBrief({
      dir: tempDir(), now: () => Date.UTC(2026, 10, 25, 12, 0, 0),
      agent: async () => ({ listConnectors: async () => [], runAgent: async (c: { prompt: string }) => { prompts.push(c.prompt); return { ok: true, json: { summary: "ok", waiting: [
        { kind: "review", title: "From the ignored channel", source: "slack", url: pr(1), channel: "prs-data-platform" },
        { kind: "review", title: "Named in its detail", source: "slack", url: pr(2), detail: "#prs-data-platform" },
        { kind: "review", title: "From a channel I read", source: "slack", url: pr(3), channel: "eyes-on-prs-saas" },
      ], talkTo: [{ kind: "talk", person: "Noa", title: "x", source: "slack", url: "https://acme.slack.com/archives/C1/p1", channel: "prs-data-platform" }] } }; } }),
      sessions: async () => ({ rows: [], envelopes: [] }),
      github: { read: async () => ({ status: "on", account: ME, review: [], mine: [], linkStates: [] }), reviewViews: async (urls: string[]) => { asked.push(urls); return new Map(); } },
    });
    expect((await b.setSettings({ slackIgnore: ["#prs-data-platform"] })).slackIgnore).toEqual(["prs-data-platform"]);
    // A patch without it leaves it alone.
    expect((await b.setSettings({ model: "sonnet" })).slackIgnore).toEqual(["prs-data-platform"]);
    await b.refresh(); await b.settled();
    const brief = (await b.view()).brief!;
    expect((brief.waiting as { title: string }[]).map(i => i.title)).toEqual(["From a channel I read"]);
    expect(brief.talkTo).toEqual([]);
    expect(asked).toEqual([[pr(3)]]);
    expect((await b.setSettings({ slackIgnore: [] })).slackIgnore).toEqual([]);
  });

  it("are shown in the brief's settings while Slack is on, each a chip that stops ignoring it", () => {
    const view = {
      ok: true, now: 0, brief: null, running: false, agent: "ready", people: { pinned: [], hidden: [] },
      settings: { model: "haiku", everyMinutes: 30, sources: { github: true, slack: true, jira: true }, slackIgnore: ["prs-data-platform"] },
    } as unknown as BriefView;
    const handle = { view, unreachable: false, refresh() {}, setSettings() {}, person() {} };
    const html = renderToStaticMarkup(createElement(Settings, { view, handle, t }));
    expect(html).toContain("Ignored Slack channels");
    expect(html).toMatch(/class="stp-chip"[^>]*aria-label="Stop ignoring #prs-data-platform"[^>]*>#prs-data-platform/);
    expect(html).toMatch(/class="stp-ignore-input"[^>]*placeholder="#channel, then Enter"/);
    const off = { ...view, settings: { ...view.settings, sources: { github: true, slack: false, jira: true } } } as BriefView;
    expect(renderToStaticMarkup(createElement(Settings, { view: off, handle: { ...handle, view: off }, t }))).not.toContain("Ignored Slack channels");
  });
});
