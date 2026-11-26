// Waiting on others: what the user asked of someone and still waits on, and
// for how long, so he knows whom to nudge (status-brief.mjs waitingOnAsk,
// normaliseWaitingOn, mergeWaitingOn; status-gh.mjs waitingOnOf,
// waitsOnOthers; MissionView.tsx WaitingOnOthers). GitHub's part is read
// with gh, never by the model; Slack's is the model's. No process runs and
// nothing reaches a network: gh, the agent and the connectors are fakes.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { rmTempDir } from "./rm-temp-dir";
import {
  MAX_WAITING_ON, WAITING_ON_LOOKBACK_MS, buildPrompt, createStatusBrief, mergeWaitingOn, normaliseBrief, normaliseStore,
} from "../../server/status-brief.mjs";
import { MAX_NAMED, MAX_WAITING_PRS, WAITING_QUERY, WAITING_SEARCH, createGitHubReader, waitingOnOf, waitsOnOthers } from "../../server/status-gh.mjs";
import { ingestBrief, normaliseStore as normaliseTodoStore } from "../../server/status-todo.mjs";
import { waitedFor, waitingOnShown, type Brief, type BriefView, type WaitingOn } from "../status-brief";
import { LONG_WAIT_DAYS, MissionPage } from "../components/MissionView";
import type { StatusBriefHandle } from "../use-status-brief";
import type { TodoView } from "../status-todo";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmTempDir(d); });
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "waiting-on-")); dirs.push(d); return d; };

const ME = "hagai";
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const pr = (n: number, repo = "api") => `https://github.com/acme/${repo}/pull/${n}`;
const iso = (t: number) => new Date(t).toISOString();
const DM = "https://acme.slack.com/archives/D0123/p1764000000000100";

describe("a Waiting on others entry, as the brief keeps it", () => {
  it("needs whom, what, an https link and a source it knows; the time is read from ISO or a number", () => {
    const [w] = normaliseBrief({ waitingOn: [{ person: " Noga  Tubi ", title: "Static-IP guide for Splunk: can it be updated?", url: DM, source: "slack", askedAt: iso(NOW - DAY), channel: "#Docs" }] }).waitingOn;
    expect(w).toEqual({ person: "Noga Tubi", title: "Static-IP guide for Splunk: can it be updated?", url: DM, source: "slack", askedAt: NOW - DAY, channel: "docs" });
    expect(normaliseBrief({ waitingOn: [{ person: "Lee", title: "x", url: pr(1), source: "github", askedAt: NOW, channel: "c" }] }).waitingOn).toEqual([
      { person: "Lee", title: "x", url: pr(1), source: "github", askedAt: NOW },
    ]);
    for (const bad of [
      { title: "x", url: DM, source: "slack" },
      { person: "Lee", url: DM, source: "slack" },
      { person: "Lee", title: "x", source: "slack" },
      { person: "Lee", title: "x", url: "javascript:alert(1)", source: "slack" },
      { person: "Lee", title: "x", url: "http://acme.slack.com/x", source: "slack" },
      { person: "Lee", title: "x", url: DM, source: "session" },
      { person: "Lee", title: "x", url: DM, source: "jira" },
      { person: "Lee", title: "x", url: DM },
      "Lee", null,
    ]) expect(normaliseBrief({ waitingOn: [bad] }).waitingOn, JSON.stringify(bad)).toEqual([]);
    const [undated] = normaliseBrief({ waitingOn: [{ person: "Lee", title: "x", url: DM, source: "slack", askedAt: "last week" }] }).waitingOn;
    expect(undated.askedAt).toBeUndefined();
  });

  it("lists each link once, oldest ask first and undated last, and holds at most MAX_WAITING_ON", () => {
    const list = normaliseBrief({ waitingOn: [
      { person: "A", title: "newer", url: pr(1), source: "github", askedAt: NOW - HOUR },
      { person: "B", title: "undated", url: pr(2), source: "github" },
      { person: "C", title: "oldest", url: DM, source: "slack", askedAt: NOW - 3 * DAY },
      { person: "D", title: "same link again", url: pr(1), source: "github", askedAt: NOW - 9 * DAY },
    ] }).waitingOn;
    expect(list.map(w => w.title)).toEqual(["oldest", "newer", "undated"]);
    const many = Array.from({ length: 40 }, (_, i) => ({ person: "P", title: `#${i}`, url: pr(i + 1), source: "github", askedAt: NOW - i * HOUR }));
    const kept = normaliseBrief({ waitingOn: many }).waitingOn;
    expect(kept).toHaveLength(MAX_WAITING_ON);
    // The longest waits are the ones kept.
    expect(kept[0].title).toBe("#39");
  });

  it("is always a list, and survives the store's round trip; a brief from before it has none", () => {
    expect(normaliseBrief({}).waitingOn).toEqual([]);
    const at = NOW;
    const stored = normaliseStore({ brief: { at, summary: "s", waitingOn: [{ person: "Lee", title: "x", url: pr(1), source: "github", askedAt: NOW - DAY }] } });
    expect(stored.brief!.waitingOn).toEqual([{ person: "Lee", title: "x", url: pr(1), source: "github", askedAt: NOW - DAY }]);
    expect(normaliseStore({ brief: { at, summary: "s" } }).brief!.waitingOn).toEqual([]);
  });
});

describe("the brief's ask for what I wait on in Slack", () => {
  const SEARCH = "mcp__s__slack_search_public_and_private";
  const READ = "mcp__s__slack_read_channel";
  const THREAD = "mcp__s__slack_read_thread";
  const prompt = (over: object = {}) => buildPrompt({ sessions: [], reach: { github: "none", slack: "on", jira: "none" }, tools: [SEARCH, READ, THREAD], since: NOW - DAY, now: NOW, ...over });
  const line = (p: string) => p.split("\n").find(l => l.startsWith("- Slack, what I am waiting on:"));

  it("asks for my own unanswered asks a week back: DMs, threads, and my PRs posted for review", () => {
    const l = line(prompt())!;
    expect(l).toContain(`my own messages since ${iso(NOW - WAITING_ON_LOOKBACK_MS)} that ask someone for something`);
    expect(l).toMatch(/In a direct message, mine is still the newest message; in a thread, no one else replied after it; and a post of mine in a channel that links a pull request I opened asks for its review \(a bare link counts\)/);
    expect(l).toMatch(/"person" \(whom I asked: the other person in a direct message, else the people I mentioned, else "#" and the channel's name/);
    expect(l).toMatch(/"url" \(the message's permalink; for a review request, the pull request's own link\)/);
    expect(l).toMatch(/"askedAt" \(the time of my first message they have not answered\)/);
    expect(WAITING_ON_LOOKBACK_MS).toBe(7 * DAY);
  });

  it("keeps them out of Talk to, and leaves PR verdicts to the deck", () => {
    const l = line(prompt())!;
    expect(l).toContain('These go in "waitingOn" only, not in "talkTo": "talkTo" keeps feedback and conversations that are not a pending ask of mine.');
    expect(l).toMatch(/Do not judge whether a pull request was reviewed: the deck checks each itself\./);
    // Nothing of GitHub where GitHub is not read.
    expect(l).not.toMatch(/GitHub/);
    expect(l).toMatch(/Leave out greetings, thanks, status updates, answers I gave and anything else that waits on no one, and a conversation where they answered after my message/);
  });

  it("searches once, then reads at most ten conversations, with the tools it was given", () => {
    const l = line(prompt())!;
    expect(l).toContain(`Search once with ${SEARCH}: filters "from:<@MY_ID>", "after" set to ${(NOW - WAITING_ON_LOOKBACK_MS) / 1000}, sorted by timestamp, response_format "detailed" and include_context false, reading up to 2 pages.`);
    expect(l).toContain(`read what came after it (its direct message with ${READ} ("oldest" set to its timestamp, limit 10), or its thread with ${THREAD}), at most 10 reads`);
    const bare = line(prompt({ tools: [] }))!;
    expect(bare).not.toMatch(/mcp__|Search once/);
  });

  it("names the ignored channels, and is asked and shaped only while Slack is read", () => {
    expect(line(prompt({ slackIgnore: ["prs-data-platform"] }))).toContain("Leave out everything posted in #prs-data-platform.");
    expect(prompt()).toMatch(/^ {2}"waitingOn": \[\{ "person": "whom I asked", "title": "what I asked", "source": "slack"/m);
    const off = prompt({ reach: { github: "none", slack: "none", jira: "none" } });
    expect(line(off)).toBeUndefined();
    expect(off).not.toContain('"waitingOn"');
  });
});

describe("what my open PRs wait on, as gh reads it", () => {
  const user = (login: string, name: string | null = null) => ({ __typename: "User", login, name });
  const node = (over: object = {}) => ({
    url: pr(7), number: 7, title: "Fix the thing", isDraft: false, state: "OPEN", reviewDecision: "REVIEW_REQUIRED", repository: { name: "api" },
    reviewRequests: { nodes: [] }, timelineItems: { nodes: [] }, ...over,
  });
  const requested = (...who: object[]) => ({ reviewRequests: { nodes: who.map(requestedReviewer => ({ requestedReviewer })) } });
  const asked = (at: number, who: object) => ({ __typename: "ReviewRequestedEvent", createdAt: iso(at), requestedReviewer: who });
  const ready = (at: number) => ({ __typename: "ReadyForReviewEvent", createdAt: iso(at) });

  it("is one entry per PR still waiting on a requested reviewer, by name, since the oldest open request", () => {
    const [w] = waitingOnOf([node({
      ...requested(user("dana", "Dana Levi"), user("lee")),
      timelineItems: { nodes: [asked(NOW - 3 * DAY, user("dana")), asked(NOW - 2 * DAY, user("lee"))] },
    })]);
    expect(w).toEqual({ person: "Dana Levi, lee", title: "api#7 · Fix the thing", url: pr(7), source: "github", askedAt: NOW - 3 * DAY });
  });

  it("names the first MAX_NAMED reviewers and counts the rest, as CODEOWNERS asks five", () => {
    const five = ["almog", "aviv", "karin", "ori", "tomer"].map(l => user(l));
    expect(MAX_NAMED).toBe(3);
    expect(waitingOnOf([node(requested(...five))])[0].person).toBe("almog, aviv, karin +2");
    expect(waitingOnOf([node(requested(...five.slice(0, 3)))])[0].person).toBe("almog, aviv, karin");
  });

  it("counts a reviewer from their newest request, and a request made on a draft from when it left draft", () => {
    // Asked, reviewed (GitHub dropped the request), asked again: waiting since the second.
    expect(waitingOnOf([node({ ...requested(user("dana")), timelineItems: { nodes: [asked(NOW - 9 * DAY, user("dana")), asked(NOW - DAY, user("dana"))] } })])[0].askedAt).toBe(NOW - DAY);
    expect(waitingOnOf([node({ ...requested(user("dana")), timelineItems: { nodes: [asked(NOW - 5 * DAY, user("dana")), ready(NOW - 2 * DAY)] } })])[0].askedAt).toBe(NOW - 2 * DAY);
    expect(waitingOnOf([node({ ...requested(user("dana")), timelineItems: { nodes: [ready(NOW - 5 * DAY), asked(NOW - 2 * DAY, user("dana"))] } })])[0].askedAt).toBe(NOW - 2 * DAY);
  });

  it("waits on a team by its name, never on a bot, and leaves out someone who reviewed and was not asked again", () => {
    const team = { __typename: "Team", slug: "backend", name: "Backend" };
    const [w] = waitingOnOf([node({
      ...requested(team, { __typename: "Bot", login: "copilot-pull-request-reviewer" }, user("renovate[bot]")),
      timelineItems: { nodes: [asked(NOW - DAY, team), asked(NOW - 4 * DAY, user("lee"))] },
    })]);
    expect(w.person).toBe("Backend");
    expect(w.askedAt).toBe(NOW - DAY);
    expect(waitingOnOf([node({ ...requested({ __typename: "Bot", login: "copilot" }) })])).toEqual([]);
  });

  it("is nothing for a draft, an approved or closed PR, or one no one is asked to review", () => {
    const asks = requested(user("dana"));
    for (const over of [{ isDraft: true }, { reviewDecision: "APPROVED" }, { state: "CLOSED" }, { state: "MERGED" }, {}, { url: "https://evil.example/acme/api/pull/7" }]) {
      const n = Object.keys(over).length ? node({ ...asks, ...over }) : node();
      expect(waitingOnOf([n]), JSON.stringify(over)).toEqual([]);
    }
    // A reviewer whose request is not on the timeline read waits, undated.
    expect(waitingOnOf([node(asks)])[0]).not.toHaveProperty("askedAt");
    expect(waitingOnOf(null)).toEqual([]);
  });

  it("is read in one fixed query, a query and never a mutation, with no value from outside", async () => {
    const calls: string[][] = [];
    const answer = { data: { search: { nodes: [node({ ...requested(user("dana")), timelineItems: { nodes: [asked(NOW - DAY, user("dana"))] } }), node({ url: pr(8), number: 8 })] } } };
    const run = async (_file: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "--version") return { code: 0, stdout: "gh version 2.95.0", stderr: "" };
      if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: `${ME}\n`, stderr: "" };
      if (args[0] === "search") return { code: 0, stdout: "[]", stderr: "" };
      if (args[0] === "api" && args[1] === "graphql") return { code: 0, stdout: JSON.stringify(answer), stderr: "" };
      return { code: 1, stdout: "", stderr: "unexpected" };
    };
    const read = await createGitHubReader({ run, exists: async () => false, now: () => NOW }).read({});
    expect(read.waitingOn).toEqual([{ person: "dana", title: "api#7 · Fix the thing", url: pr(7), source: "github", askedAt: NOW - DAY }]);
    expect(calls.filter(a => a[1] === "graphql")).toEqual([["api", "graphql", "-f", `query=${WAITING_QUERY}`, "-f", `q=${WAITING_SEARCH}`]]);
    expect(WAITING_QUERY).toMatch(/^query\(\$q: String!\) \{ search\(query: \$q, type: ISSUE, first: 50\)/);
    expect(WAITING_QUERY).not.toMatch(/mutation/i);
    expect(MAX_WAITING_PRS).toBe(50);
    expect(WAITING_SEARCH).toBe("is:pr is:open author:@me draft:false -review:approved archived:false");
  });

  it("leaves the rest of the read standing when the query fails", async () => {
    const run = async (_file: string, args: string[]) => {
      if (args[0] === "--version") return { code: 0, stdout: "gh version 2.95.0", stderr: "" };
      if (args[0] === "api" && args[1] === "user") return { code: 0, stdout: ME, stderr: "" };
      if (args[0] === "search") return { code: 0, stdout: "[]", stderr: "" };
      return { code: 1, stdout: "", stderr: "GraphQL: something went wrong" };
    };
    const read = await createGitHubReader({ run, exists: async () => false, now: () => NOW }).read({});
    expect(read.status).toBe("on");
    expect(read).not.toHaveProperty("waitingOn");
  });
});

describe("whether my PR, posted in Slack for review, still waits on others", () => {
  const mine = (over: object = {}) => ({ state: "OPEN", mergedAt: null, isDraft: false, reviewDecision: "REVIEW_REQUIRED", author: { login: ME }, latestReviews: [], ...over });
  it("does while it is open, mine, and no one has approved it or sent it back; a comment is no answer", () => {
    expect(waitsOnOthers(mine(), ME)).toBe(true);
    expect(waitsOnOthers(mine({ latestReviews: [{ author: { login: "lee" }, state: "COMMENTED" }] }), ME)).toBe(true);
    expect(waitsOnOthers(null, ME)).toBe(true);
  });
  it("does not once merged, closed, a draft, approved, sent back, or when it is someone else's", () => {
    for (const over of [
      { state: "MERGED", mergedAt: "2026-11-25T08:00:00Z" }, { state: "CLOSED" }, { isDraft: true },
      { reviewDecision: "APPROVED" }, { reviewDecision: "CHANGES_REQUESTED" },
      { reviewDecision: null, latestReviews: [{ author: { login: "lee" }, state: "APPROVED" }] },
      { latestReviews: [{ author: { login: "lee" }, state: "CHANGES_REQUESTED" }] },
      { author: { login: "dana" } },
    ]) expect(waitsOnOthers(mine(over), ME), JSON.stringify(over)).toBe(false);
  });
});

describe("Waiting on others, put together after a run", () => {
  const ghEntry = { person: "dana", title: "api#1 · One", url: pr(1), source: "github", askedAt: NOW - 2 * DAY };
  const views = new Map<string, object>([
    [pr(2), { state: "OPEN", isDraft: false, reviewDecision: "REVIEW_REQUIRED", author: { login: ME }, latestReviews: [] }],
    [pr(3), { state: "OPEN", isDraft: false, reviewDecision: "APPROVED", author: { login: ME }, latestReviews: [] }],
  ]);
  const ASKED = [
    { person: "Noga Tubi", title: "Can the Static-IP guide be updated?", url: DM, source: "slack", askedAt: NOW - 3 * DAY },
    { person: "#eyes-on-prs-saas", title: "Review of api#2", url: `${pr(2)}/files`, source: "slack", channel: "eyes-on-prs-saas", askedAt: NOW - DAY },
    { person: "#eyes-on-prs-saas", title: "Review of api#3", url: pr(3), source: "slack", askedAt: NOW - DAY },
    { person: "#eyes-on-prs-saas", title: "gh cannot read it", url: pr(4), source: "slack", askedAt: NOW - HOUR },
    // gh lists pr(1) already: its entry stands, with the earlier time.
    { person: "#eyes-on-prs-saas", title: "Review of api#1", url: pr(1), source: "slack", askedAt: NOW - 5 * DAY },
    { person: "Lee", title: "From an ignored channel", url: "https://acme.slack.com/archives/C9/p1", source: "slack", channel: "prs-data-platform" },
    // The model is not asked for GitHub's: gh's word is the only one.
    { person: "Kim", title: "The model's own GitHub guess", url: pr(9), source: "github" },
  ];

  it("keeps the Slack asks, checks the PR ones with gh, and lets gh's own list stand", async () => {
    const checked: string[][] = [];
    const out = await mergeWaitingOn({
      asked: normaliseBrief({ waitingOn: ASKED }).waitingOn,
      gh: { status: "on", account: ME, waitingOn: [ghEntry] },
      github: { reviewViews: async (urls: string[]) => { checked.push(urls); return views; } },
      ignore: new Set(["prs-data-platform"]),
    });
    expect(checked).toEqual([[pr(2), pr(3), pr(4)]]);
    expect(out.map(w => [w.title, w.url, w.askedAt])).toEqual([
      ["api#1 · One", pr(1), NOW - 5 * DAY],
      ["Can the Static-IP guide be updated?", DM, NOW - 3 * DAY],
      ["Review of api#2", pr(2), NOW - DAY],
      ["gh cannot read it", pr(4), NOW - HOUR],
    ]);
  });

  it("checks nothing with GitHub off, and keeps the Slack asks as they were found", async () => {
    const out = await mergeWaitingOn({ asked: normaliseBrief({ waitingOn: ASKED }).waitingOn, gh: null, github: null });
    expect(out.map(w => w.title)).toEqual([
      "Review of api#1", "Can the Static-IP guide be updated?", "Review of api#2", "Review of api#3", "gh cannot read it", "From an ignored channel",
    ]);
  });

  it("is what the runner keeps, and the Todo list takes none of it", async () => {
    const handed: object[] = [];
    const b = createStatusBrief({
      dir: tempDir(), now: () => NOW,
      agent: async () => ({ listConnectors: async () => [], runAgent: async () => ({ ok: true, json: { summary: "ok", waitingOn: ASKED } }) }),
      sessions: async () => ({ rows: [], envelopes: [] }),
      github: {
        read: async () => ({ status: "on", account: ME, review: [], mine: [], linkStates: [], waitingOn: [ghEntry] }),
        reviewViews: async () => views,
      },
      todo: { watched: async () => [], dismissed: async () => [], brief: async (x: object) => { handed.push(x); return {}; } },
    });
    await b.setSettings({ slackIgnore: ["prs-data-platform"] });
    await b.refresh(); await b.settled();
    const kept = (await b.view()).brief!.waitingOn as WaitingOn[];
    expect(kept.map(w => w.url)).toEqual([pr(1), DM, pr(2), pr(4)]);
    expect(handed).toHaveLength(1);
    const store = normaliseTodoStore(null);
    expect(ingestBrief(store, handed[0], NOW)).toEqual([]);
    expect(store.items).toEqual([]);
  });
});

describe("Waiting on others on the Mission page", () => {
  it("says how long each has waited, in its largest whole unit", () => {
    expect([waitedFor(0), waitedFor(59 * 60_000), waitedFor(HOUR), waitedFor(DAY - 1), waitedFor(3 * DAY + 5 * HOUR), waitedFor(-5)]).toEqual([
      { n: 0, unit: "m" }, { n: 59, unit: "m" }, { n: 1, unit: "h" }, { n: 23, unit: "h" }, { n: 3, unit: "d" }, { n: 0, unit: "m" },
    ]);
  });

  it("lists only what it can link, oldest first, undated last", () => {
    const shown = waitingOnShown([
      { person: "A", title: "new", url: DM, source: "slack", askedAt: NOW - HOUR },
      { person: "B", title: "undated", url: pr(2), source: "github" },
      { person: "C", title: "old", url: pr(3), source: "github", askedAt: NOW - 4 * DAY },
      { person: "D", title: "bad link", url: "javascript:alert(1)", source: "slack", askedAt: NOW - 9 * DAY },
    ]);
    expect(shown.map(w => w.title)).toEqual(["old", "new", "undated"]);
    expect(waitingOnShown(undefined)).toEqual([]);
  });

  const briefOf = (waitingOn: WaitingOn[] | undefined): Brief => ({
    at: NOW - HOUR, model: "haiku", summary: "s", waiting: [], todo: [], talkTo: [], people: [],
    reach: { github: "on", slack: "on", jira: "none" }, ...(waitingOn ? { waitingOn } : {}),
  });
  const viewOf = (b: Brief): BriefView => ({
    ok: true, now: NOW, brief: b, error: null, running: false, lastRunAt: b.at, nextAutoAt: null,
    settings: { model: "haiku", everyMinutes: 30, sources: { github: true, slack: true, jira: true } }, people: { pinned: [], hidden: [] }, agent: "ready",
  });
  const draw = (waitingOn: WaitingOn[] | undefined) => {
    const brief: StatusBriefHandle = { view: viewOf(briefOf(waitingOn)), unreachable: false, refresh() {}, setSettings() {}, person() {} };
    const todo: TodoView = { ok: true, now: NOW, open: [], closed: [], keeper: { lastRunAt: null, lastCostUsd: null, error: null } };
    return renderToStaticMarkup(createElement(MissionPage, {
      rows: [], now: NOW, desktop: {}, brief, todo: { view: todo, say() {}, act() {} }, onOpenSession() {}, onOpenDesktop() {},
    }));
  };

  it("draws each with whom, what, its age and its link, oldest first, a long wait in the warning colour", () => {
    const html = draw([
      { person: "Sapir Oster", title: "DIS-25534 drawer: story bug or not?", url: DM, source: "slack", askedAt: NOW - 20 * 60_000 },
      { person: "dana", title: "api#7 · Fix the thing", url: pr(7), source: "github", askedAt: NOW - (LONG_WAIT_DAYS * DAY + HOUR) },
      { person: "Noga Tubi", title: "Static-IP guide", url: "https://acme.slack.com/archives/D9/p2", source: "slack", askedAt: NOW - 5 * HOUR },
    ]);
    const card = html.slice(html.indexOf('id="mi-waiting-on"'));
    expect(card).toMatch(/^id="mi-waiting-on">Waiting on others<span class="mi-n">3<\/span>/);
    const rows = [...card.matchAll(/<li class="mi-plain-row" data-src="(\w+)"><a href="([^"]+)" target="_blank" rel="noreferrer noopener"[^>]*><b>([^<]+)<\/b> · ([^<]+)<\/a><span class="mi-waited"( data-long="")?[^>]*>([^<]+)<\/span><\/li>/g)]
      .map(m => [m[1], m[2], m[3], m[4], !!m[5], m[6]]);
    expect(rows).toEqual([
      ["github", pr(7), "dana", "api#7 · Fix the thing", true, "3d"],
      ["slack", "https://acme.slack.com/archives/D9/p2", "Noga Tubi", "Static-IP guide", false, "5h"],
      ["slack", DM, "Sapir Oster", "DIS-25534 drawer: story bug or not?", false, "20m"],
    ]);
    // Read only: nothing to dismiss, snooze or close here.
    expect(card.slice(0, card.indexOf("</section>"))).not.toMatch(/<button/);
  });

  it("says so when nothing waits, as for a brief written before the deck kept the list", () => {
    for (const html of [draw([]), draw(undefined)]) {
      expect(html).toMatch(/id="mi-waiting-on">Waiting on others<span class="mi-n">0<\/span><\/h3><p class="mi-empty">Nothing you asked for is still pending\.<\/p>/);
    }
  });
});
