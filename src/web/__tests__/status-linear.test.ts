// Linear as a source of the Status brief (status-brief.mjs linearAsk): the
// issues the person created or is assigned to, read through their claude.ai
// Linear connector with its read-only tools only, for an agent working one
// that asks something, fails or waits on their review. Nothing here spawns
// Claude Code or reaches a network: the listing and runAgent are fakes, and the
// Linear tools are the ones this machine's Claude Code listed on 2026-11-25.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { rmTempDir } from "./rm-temp-dir";
import {
  DEFAULT_SETTINGS, MAX_TOOLS, PROMPT_TOOLS, SOURCES, buildPrompt, createStatusBrief, normaliseBrief, normaliseSettings, pickTools, writeShaped,
} from "../../server/status-brief.mjs";
import { addItem, applyLinkStates, normaliseStore, watchedLinks } from "../../server/status-todo.mjs";
import { BUILTIN_CONNECTOR } from "../../server/claude-agent.mjs";
import { Settings, metaLine } from "../components/StatusPane";
import { sourceOf } from "../components/MissionView";
import type { BriefView } from "../status-brief";
import type { TodoItem } from "../status-todo";
import { t } from "../i18n";

const dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "status-linear-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmTempDir(d); });

// The claude.ai Linear connector as `mcp_status` listed it, split by what its
// own server marks read-only.
const LINEAR_READS = ["get_attachment", "list_agent_skills", "get_agent_skill", "list_comments", "list_cycles", "list_custom_views", "get_document", "list_documents", "extract_images", "get_issue", "list_issues", "list_issue_statuses", "get_issue_status", "list_issue_labels", "list_projects", "get_project", "list_project_labels", "list_release_pipelines", "list_releases", "get_release", "list_release_notes", "get_release_note", "list_milestones", "get_milestone", "get_notifications", "list_teams", "get_team", "get_triage_responsibility", "list_templates", "get_template", "list_users", "get_user", "get_workspace", "search_documentation", "get_diff", "list_diffs", "get_diff_threads", "list_initiatives", "get_initiative", "list_initiative_labels", "get_status_updates"];
const LINEAR_WRITES = ["prepare_attachment_upload", "prepare_file_upload", "create_attachment_from_upload", "create_attachment", "delete_attachment", "save_comment", "delete_comment", "save_document", "save_issue", "save_issue_label", "create_issue_label", "retire_issue_label", "restore_issue_label", "save_project", "retire_project_label", "restore_project_label", "save_project_label", "save_release", "save_release_note", "share_issue", "unshare_issue", "save_milestone", "mark_notification", "save_diff_comment", "resolve_diff_thread", "delete_diff_comment", "submit_diff_review", "update_diff", "merge_diff", "whoami", "save_initiative", "save_initiative_label", "create_initiative_label", "retire_initiative_label", "restore_initiative_label", "save_status_update", "delete_status_update"];
/** The names that change something by their verb. whoami is the one write
 *  that does not say so: its server marks it, and only that keeps it out. */
const WRITE_VERB = /^(save|delete|create|merge|submit|resolve|mark|update|retire|restore|share|unshare|prepare)_/;

const connector = (server: string, label: string, reads: string[], writes: string[] = [], allRead = false) => ({ server, label, status: "connected", tools: [
  ...reads.map(t => ({ name: `mcp__${server}__${t}`, title: t, readOnly: true })),
  ...writes.map(t => ({ name: `mcp__${server}__${t}`, title: t, readOnly: allRead })),
] });
const LINEAR = connector("claude_ai_Linear", "Linear", LINEAR_READS, LINEAR_WRITES);
// GitHub's MCP has a list_issues of its own, and get_issue in older builds.
const GITHUB = connector("claude_ai_GitHub", "GitHub", ["list_issues", "get_issue", "issue_read", "list_issue_types", "search_issues", "pull_request_read"], ["add_issue_comment", "issue_write"]);
const linearTools = (tools: string[], server = "claude_ai_Linear") => tools.filter(n => n.startsWith(`mcp__${server}__`)).map(n => n.split("__").pop()!);

describe("Linear's tools that change something", () => {
  it("are every one write-shaped by name: save_, delete_, create_, merge_, submit_, resolve_, mark_, update_ and the rest", () => {
    const named = LINEAR_WRITES.filter(n => WRITE_VERB.test(n));
    expect(named.length).toBe(LINEAR_WRITES.length - 1);
    for (const prefix of ["save_", "delete_", "create_", "merge_", "submit_", "resolve_", "mark_", "update_"]) {
      expect(named.some(n => n.startsWith(prefix)), prefix).toBe(true);
    }
    for (const n of named) expect(writeShaped(`mcp__claude_ai_Linear__${n}`), n).toBe(true);
  });

  it("stay out even when the connector marks every one read-only", () => {
    const careless = connector("claude_ai_Linear", "Linear", [], LINEAR_WRITES, true);
    const { tools, reach } = pickTools([careless], { github: false, slack: false, jira: false, linear: true });
    expect(reach.linear).toBe("on");
    // Only whoami's name says nothing, and that is a read in all but its label.
    expect(linearTools(tools)).toEqual(["whoami"]);
  });

  // CHANGED ON PURPOSE (linear-source): a plural is a noun. The old rule, with
  // its case folded, read "comment" + "s" as a verb and a camelCase word, and
  // kept list_comments out: the one tool that reads what an agent asked.
  it("does not take a plural noun for a verb, and still catches the verb", () => {
    for (const n of ["list_comments", "get_status_updates", "get_comments", "list_issues", "get_issue", "get_notifications", "list_issue_statuses"]) {
      expect(writeShaped(`mcp__x__${n}`), n).toBe(false);
    }
    for (const n of ["save_comment", "comment", "add_comments", "comments_create", "update_issues", "saveIssue", "markAsRead", "slack_send_message", "Save_Issue", "SAVE_ISSUE"]) {
      expect(writeShaped(`mcp__x__${n}`), n).toBe(true);
    }
  });
});

describe("the Linear connector, found", () => {
  it("by its name, with its read-only tools and none that writes", () => {
    const { tools, reach } = pickTools([BUILTIN_CONNECTOR, GITHUB, LINEAR], { github: false, slack: true, jira: true, linear: true });
    expect(reach).toMatchObject({ linear: "on", slack: "none", jira: "none" });
    const picked = linearTools(tools);
    expect(picked).toHaveLength(Math.min(MAX_TOOLS, LINEAR_READS.length));
    for (const tail of PROMPT_TOOLS.linear) expect(picked, tail).toContain(tail);
    expect(picked.every(n => LINEAR_READS.includes(n))).toBe(true);
    // GitHub's list_issues is never taken for Linear's.
    expect(tools.some(n => n.includes("GitHub"))).toBe(false);
  });

  it("by its tools under an opaque server id, as the desktop app files it", () => {
    const opaque = connector("b67c06e7-9743-4278-b20d-d237595e3ca7", "b67c06e7-9743-4278-b20d-d237595e3ca7", LINEAR_READS, LINEAR_WRITES);
    const { tools, reach } = pickTools([opaque, GITHUB]);
    expect(reach.linear).toBe("on");
    expect(linearTools(tools, opaque.server)).toEqual(expect.arrayContaining(["list_issues", "list_comments", "get_issue"]));
  });

  it("never by a tracker that only shares some of its names", () => {
    const lookalike = connector("tracker", "Tracker", ["list_issues", "get_issue", "list_comments", "list_teams"]);
    const monkey = { server: "claude_ai_Grip_Monkey", label: "Grip Monkey", status: "needs-auth", tools: [] };
    const { tools, reach } = pickTools([GITHUB, lookalike, monkey]);
    expect(reach.linear).toBe("none");
    expect(tools).toEqual([]);
  });

  it("says when Linear is switched off, signed out or has its read tools off", () => {
    expect(pickTools([LINEAR], { github: true, slack: true, jira: true, linear: false })).toEqual({ tools: [], reach: { github: "none", slack: "none", jira: "none", linear: "off" } });
    // needs-auth: listed, no tools.
    expect(pickTools([{ ...LINEAR, status: "needs-auth", tools: [] }]).reach.linear).toBe("disabled");
    const off = LINEAR.tools.filter(t => t.readOnly).map(t => t.name);
    expect(pickTools([LINEAR], undefined, null, off)).toEqual({ tools: [], reach: { github: "none", slack: "none", jira: "none", linear: "disabled" } });
  });

  it("shares the room with Slack and Jira, keeping every source's prompt tools", () => {
    const slack = connector("claude_ai_Slack", "Slack", ["slack_search_public", "slack_search_public_and_private", "slack_search_channels", "slack_search_users", "slack_read_channel", "slack_read_thread", "slack_read_canvas", "slack_read_user_profile", "slack_list_channel_members", "slack_read_file", "slack_search_emojis", "slack_get_reactions"], ["slack_send_message"]);
    const atlassian = connector("atlassian", "atlassian", ["getAccessibleAtlassianResources", "atlassianUserInfo", "getConfluenceContent", "searchConfluence", "getJiraIssue", "listJiraIssueComments", "searchJiraIssuesUsingJql", "getLoomObjectsContent", "getGraphContext", "getGraphObject", "getCollaborators", "getPeopleInfo", "getWorkActivity", "getWorkPortfolio", "discover", "executeRead", "search"], ["editJiraIssue"]);
    const listing = [BUILTIN_CONNECTOR, slack, atlassian, GITHUB, LINEAR];
    const { tools, reach } = pickTools(listing, undefined, listing.flatMap(c => c.tools.map(t => t.name)), []);
    expect(tools).toHaveLength(MAX_TOOLS);
    expect(reach).toEqual({ github: "none", slack: "on", jira: "on", linear: "on" });
    for (const tail of [...PROMPT_TOOLS.slack, ...PROMPT_TOOLS.linear, "searchJiraIssuesUsingJql", "getJiraIssue", "searchConfluence"]) {
      expect(tools.some(n => n.endsWith(`__${tail}`)), tail).toBe(true);
    }
    expect(tools.every(n => !writeShaped(n))).toBe(true);
  });
});

const GIVEN = ["mcp__claude_ai_Linear__get_issue", "mcp__claude_ai_Linear__list_comments", "mcp__claude_ai_Linear__list_issues"];
const SINCE = Date.parse("2026-11-24T08:00:00Z");
const linearLine = (prompt: string) => prompt.split("\n").find(l => l.startsWith("- Linear:"));

describe("what the brief asks of Linear", () => {
  it("the issues I created or am assigned to since the last brief, an agent's question, failure or finished work, linked by the issue", () => {
    const line = linearLine(buildPrompt({ sessions: [], reach: { github: "none", slack: "none", jira: "none", linear: "on" }, tools: GIVEN, since: SINCE, now: SINCE + 3600_000 }))!;
    expect(line).toContain("issues I created or am assigned to, updated since 2026-11-24T08:00:00.000Z");
    expect(line).toMatch(/asking me a question, saying it failed or is stuck, or saying it is done and waits for my review/);
    expect(line).toContain('mcp__claude_ai_Linear__list_issues, twice: once with creator "me" and once with assignee "me", each with updatedAt "2026-11-24T08:00:00.000Z"');
    expect(line).toContain("with mcp__claude_ai_Linear__list_comments (issueId set to its identifier)");
    expect(line).toMatch(/"reply" item.*"decide" item.*"review" item/);
    expect(line).toContain('"source" "linear", "url" the issue\'s own link (https://linear.app/');
    expect(line).toContain('report a Linear issue that is completed or canceled as "done"');
    // No GitHub section, so nothing to leave out for it; no Linear link watched.
    expect(line).not.toContain("REVIEW REQUESTED FROM ME");
    expect(line).not.toContain("get_issue");
  });

  it("leaves a review to GitHub when gh already lists it, and reads the Linear links the Todo list watches", () => {
    const github = { status: "on", account: "haggrip", review: [], mine: [], linkStates: [] };
    const watch = [{ url: "https://linear.app/grip/issue/ENG-12/fast-sspm-acme", kind: "review" }, { url: "https://github.com/o/r/pull/1", kind: "review" }];
    const prompt = buildPrompt({ sessions: [], reach: { github: "on", slack: "none", jira: "none", linear: "on" }, tools: GIVEN, since: SINCE, now: SINCE, github, watch });
    const line = linearLine(prompt)!;
    expect(line).toContain("already listed in GITHUB under REVIEW REQUESTED FROM ME");
    expect(line).toContain("Read each Linear issue among the open to-do links below with mcp__claude_ai_Linear__get_issue.");
    expect(prompt).toContain("- https://linear.app/grip/issue/ENG-12/fast-sspm-acme (review)");
  });

  it("is not asked when Linear is off, has no connector or has its tools off", () => {
    for (const linear of ["off", "none", "disabled"]) {
      expect(linearLine(buildPrompt({ sessions: [], reach: { github: "none", slack: "none", jira: "none", linear }, tools: [], since: SINCE, now: SINCE }))).toBeUndefined();
    }
  });
});

describe("a Linear item, kept and settled", () => {
  const ISSUE = "https://linear.app/grip/issue/ENG-12/fast-sspm-acme";

  it("keeps its source and the issue's link", () => {
    const brief = normaliseBrief({ waiting: [
      { kind: "reply", title: "Monkey asks which API version to use", source: "linear", url: ISSUE, person: "Grip Monkey", activityAt: "2026-11-25T09:00:00Z" },
    ] });
    expect(brief.waiting).toEqual([{
      kind: "reply", title: "Monkey asks which API version to use", source: "linear", url: ISSUE, person: "Grip Monkey",
      activityAt: Date.parse("2026-11-25T09:00:00Z"), dkey: `url:${ISSUE}`,
    }]);
  });

  it("is watched by the Todo list, and closes once a brief reads the issue done", () => {
    const store = normaliseStore(null);
    const items = ["reply", "decide", "review"].map((kind, i) => addItem(store, { origin: "brief", kind, title: kind, key: `k${i}`, link: { url: `${ISSUE}-${i}` } }, 1)!);
    expect(watchedLinks(store).map(w => w.url)).toEqual(items.map(i => i.link.url));
    expect(applyLinkStates(store, items.map(i => ({ url: i.link.url, state: "done" })), 2)).toBe(true);
    for (const item of items) expect(item, item.kind).toMatchObject({ state: "closed", closedReason: "Done on its side" });
  });
});

describe("Linear in the brief's settings and on Mission", () => {
  it("is on by default, and a setting of its own", () => {
    expect(SOURCES).toContain("linear");
    expect(DEFAULT_SETTINGS.sources.linear).toBe(true);
    expect(normaliseSettings({ sources: { github: true, slack: true, jira: true } }).sources.linear).toBe(true);
    expect(normaliseSettings({ sources: { linear: false } }).sources).toEqual({ github: true, slack: true, jira: true, linear: false });
  });

  it("reads Linear's tools while on, and switched off hands the run none and asks nothing of it", async () => {
    const calls: { prompt: string; tools: string[] }[] = [];
    const agent = {
      listConnectors: async () => [BUILTIN_CONNECTOR, LINEAR],
      runAgent: async (call: { prompt: string; tools: string[] }) => { calls.push(call); return { ok: true, json: { summary: "s" } }; },
    };
    let now = 1;
    const b = createStatusBrief({ dir: tempDir(), agent: async () => agent, sessions: async () => ({ rows: [], envelopes: [] }), now: () => now });
    await b.refresh(); await b.settled();
    // The prompt's own tools first, then the rest alphabetically, up to the cap.
    const rest = LINEAR_READS.filter(n => !PROMPT_TOOLS.linear.includes(n)).sort().slice(0, MAX_TOOLS - PROMPT_TOOLS.linear.length);
    expect(linearTools(calls[0].tools).sort()).toEqual([...PROMPT_TOOLS.linear, ...rest].sort());
    expect(linearLine(calls[0].prompt)).toBeDefined();
    expect((await b.view()).brief?.reach.linear).toBe("on");

    expect((await b.setSettings({ sources: { linear: false } })).sources).toEqual({ github: true, slack: true, jira: true, linear: false });
    now += 24 * 3600_000;
    await b.refresh(); await b.settled();
    expect(calls[1].tools).toEqual([]);
    expect(linearLine(calls[1].prompt)).toBeUndefined();
    expect((await b.view()).brief?.reach.linear).toBe("off");
  });

  const view = (reach: Record<string, string>, linear = true) => ({
    ok: true, now: 2_000_000, running: false, lastRunAt: 1_000_000, nextAutoAt: null, agent: "ready", error: null,
    settings: { model: "haiku", everyMinutes: 30, sources: { github: true, slack: true, jira: true, linear } },
    people: { pinned: [], hidden: [] },
    brief: { at: 1_000_000, model: "haiku", summary: "s", reach, waiting: [], todo: [], talkTo: [], people: [] },
  }) as BriefView;
  const settingsHtml = (v: BriefView) => renderToStaticMarkup(createElement(Settings, { view: v, handle: { view: v, unreachable: false, refresh() {}, setSettings() {}, person() {} }, t }));

  it("has a switch in the settings, which say when no connector reaches it or its tools are off", () => {
    const html = settingsHtml(view({ github: "on", slack: "on", jira: "on", linear: "none" }));
    expect(html).toMatch(/<input type="checkbox" checked=""\/><span>Linear<\/span><span class="stp-muted">no connector found<\/span>/);
    expect(settingsHtml(view({ github: "on", slack: "on", jira: "on", linear: "disabled" }))).toMatch(/<span>Linear<\/span><span class="stp-muted">turn its read tools on in Settings › Connectors<\/span>/);
    expect(settingsHtml(view({ github: "on", slack: "on", jira: "on", linear: "off" }, false))).toMatch(/<input type="checkbox"\/><span>Linear<\/span><\/label>/);
  });

  it("is named among the sources the brief read, under its summary on Mission", () => {
    expect(metaLine(view({ github: "on", slack: "none", jira: "on", linear: "on" }), 2_000_000, t)).toMatch(/GitHub, Jira, Linear$/);
    expect(metaLine(view({ github: "on", slack: "none", jira: "on", linear: "none" }), 2_000_000, t)).toMatch(/GitHub, Jira$/);
    const item = { id: "t_aaaaaa1", title: "ENG-12", kind: "review", origin: "brief", link: { kind: "ticket", url: "https://linear.app/grip/issue/ENG-12/x" }, state: "open", createdAt: 1, updatedAt: 1 } as TodoItem;
    expect(sourceOf(item, false)).toEqual({ key: "linear", name: "Linear" });
  });
});
