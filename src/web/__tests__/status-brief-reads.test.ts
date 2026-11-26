// The reads a brief must make, and the deck counting them (owner, 2026-11-26:
// "I feel slack is not adequately represented here"). The first Sonnet brief
// made one Slack search of the four the ask names and no Jira search, wrote a
// confident brief from that, and Slack came out as one review request. The
// rules now name every read up front, the deck counts the calls afterwards,
// and the page says what a brief left unread.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTempDir } from "./rm-temp-dir";
import { buildPrompt, createStatusBrief, normaliseStore, readsShort, requiredReads, REQUIRED_READS } from "../../server/status-brief.mjs";
import { usageFrom } from "../../server/claude-agent.mjs";
import { readsLines } from "../components/StatusPane";

const dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "brief-reads-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmTempDir(d); });

const SLACK = "mcp__claude_ai_Slack__slack_search_public_and_private";
const THREAD = "mcp__claude_ai_Slack__slack_read_thread";
const JIRA = "mcp__atlassian__searchJiraIssuesUsingJql";
const LINEAR = "mcp__claude_ai_Linear__list_issues";
const ALL_ON = { github: "on", slack: "on", jira: "on", linear: "on" };

describe("the reads a brief must make", () => {
  it("are one per source that is on and has its tool", () => {
    expect(requiredReads(ALL_ON, [SLACK, THREAD, JIRA, LINEAR])).toEqual({
      slack: { tool: SLACK, n: 4, what: REQUIRED_READS.slack.what },
      jira: { tool: JIRA, n: 1, what: REQUIRED_READS.jira.what },
      linear: { tool: LINEAR, n: 2, what: REQUIRED_READS.linear.what },
    });
    expect(requiredReads({ ...ALL_ON, slack: "off" }, [SLACK, JIRA])).toEqual({ jira: expect.objectContaining({ n: 1 }) });
    expect(requiredReads(ALL_ON, [THREAD])).toEqual({});
  });

  it("are named in the rules, before anything is read, each as its own call", () => {
    const p = buildPrompt({ sessions: [], reach: ALL_ON, tools: [SLACK, THREAD, JIRA, LINEAR], since: null, now: 0 });
    const rule = p.split("\n").find(l => l.startsWith("- Before you answer, make every read ALSO LOOK AT asks for"))!;
    expect(p.indexOf(rule)).toBeLessThan(p.indexOf("ALSO LOOK AT:"));
    expect(rule).toContain(`Slack, four searches: direct messages, replies in threads I am in, pull request links in my channels, and my own messages; then the thread reads, with ${SLACK}`);
    expect(rule).toContain(`Jira, one search for my issues in the current sprint, with ${JIRA}`);
    expect(rule).toContain(`Linear, two lists: issues I created, and issues assigned to me, with ${LINEAR}`);
    expect(rule).toContain("Do not skip one, or fold two into one call");
    // No rule when nothing is on.
    expect(buildPrompt({ sessions: [], reach: { github: "on", slack: "off", jira: "off", linear: "off" }, tools: [], since: null, now: 0 })).not.toContain("make every read");
  });

  it("give every source with something waiting a bullet of its own", () => {
    const p = buildPrompt({ sessions: [], reach: ALL_ON, tools: [SLACK], since: null, now: 0 });
    expect(p).toContain("Every source you read, and the sessions, that has something waiting on me or something I asked that is still unanswered gets at least one bullet of its own.");
  });
});

describe("what the deck counts", () => {
  it("is each tool's calls, from the run's own record", () => {
    expect(usageFrom(null, { called: [SLACK, JIRA, SLACK, THREAD, SLACK] }).calls).toEqual({ [SLACK]: 3, [JIRA]: 1, [THREAD]: 1 });
  });

  it("is short where the model read less than asked, by the tool's name on any server", () => {
    const must = requiredReads(ALL_ON, [SLACK, JIRA, LINEAR]);
    // The first Sonnet brief: one Slack search, no Jira, both Linear lists.
    expect(readsShort(must, { [SLACK]: 1, [LINEAR]: 2, "mcp__claude_ai_Linear__get_issue": 1 })).toEqual({ slack: { done: 1, asked: 4 }, jira: { done: 0, asked: 1 } });
    expect(readsShort(must, { [SLACK]: 5, [JIRA]: 1, [LINEAR]: 2 })).toEqual({});
    expect(readsShort(must, { "mcp__slack__slack_search_public_and_private": 4, [JIRA]: 1, [LINEAR]: 2 })).toEqual({});
    expect(readsShort(must, undefined)).toEqual({ slack: { done: 0, asked: 4 }, jira: { done: 0, asked: 1 }, linear: { done: 0, asked: 2 } });
  });
});

describe("a brief that read in part", () => {
  const CONNECTORS = [
    { server: "claude_ai_Slack", label: "Slack", tools: [{ name: SLACK, readOnly: true }, { name: THREAD, readOnly: true }] },
    { server: "atlassian", label: "Atlassian", tools: [{ name: JIRA, readOnly: true }] },
  ];
  const runner = (calls: Record<string, number>) => createStatusBrief({
    dir: tempDir(),
    sessions: async () => ({ rows: [], envelopes: [] }),
    agent: async () => ({ listConnectors: async () => CONNECTORS, runAgent: async () => ({ ok: true, json: { points: ["Slack: one DM waits"] }, usage: { calls } }) }),
  });

  it("says which sources, and keeps it through a save", async () => {
    const b = runner({ [SLACK]: 1 });
    await b.setSettings({ sources: { github: false, slack: true, jira: true, linear: false } });
    await b.refresh(); await b.settled();
    const view = await b.view();
    expect(view.brief?.reads).toEqual({ slack: { done: 1, asked: 4 }, jira: { done: 0, asked: 1 } });
    expect(normaliseStore(JSON.parse(JSON.stringify({ brief: view.brief }))).brief?.reads).toEqual({ slack: { done: 1, asked: 4 }, jira: { done: 0, asked: 1 } });
  });

  it("says nothing when every read was made", async () => {
    const b = runner({ [SLACK]: 4, [THREAD]: 2, [JIRA]: 1 });
    await b.setSettings({ sources: { github: false, slack: true, jira: true, linear: false } });
    await b.refresh(); await b.settled();
    expect((await b.view()).brief).not.toHaveProperty("reads");
  });

  it("is a line under the summary for each source, in the page's words", () => {
    const t = (key: string, v?: Record<string, unknown>) => `${key} ${JSON.stringify(v)}`;
    const view = { brief: { reads: { jira: { done: 0, asked: 1 }, slack: { done: 1, asked: 4 } } } } as never;
    expect(readsLines(view, t as never)).toEqual([
      'brief.reads.partial {"source":"Slack","done":1,"asked":4}',
      'brief.reads.partial {"source":"Jira","done":0,"asked":1}',
    ]);
    expect(readsLines({ brief: {} } as never, t as never)).toEqual([]);
    expect(readsLines(null, t as never)).toEqual([]);
  });
});
