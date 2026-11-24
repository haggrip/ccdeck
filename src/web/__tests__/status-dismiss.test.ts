// Dismiss in the Status pane (src/server/status-todo.mjs, status-brief.mjs,
// components/StatusPane.tsx and StatusTodo.tsx): any brief item, and any item
// on the live Todo list, can be dismissed. A dismissal is remembered by the
// item's page (or its session), in the list's own 0700 folder, at most
// MAX_DISMISSED of them; it closes the item's mirror on the list, keeps later
// briefs from bringing it back, is named to the brief's model, and is undone
// only by the user or by new activity on its source.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { rmTempDir } from "./rm-temp-dir";
import {
  DISMISSED_REASON, MAX_DISMISSED, TODO_DIR, TODO_FILE, addItem, createStatusTodo, dismiss, dismissKeyOf, ingestBrief,
  normaliseStore, restore, reviveOnActivity,
} from "../../server/status-todo.mjs";
import { buildPrompt, createStatusBrief, normaliseBrief } from "../../server/status-brief.mjs";
import { handleStatusTodo, useStatusTodoForTest } from "../../server/status-todo-routes.mjs";
import { StatusPaneView } from "../components/StatusPane";
import StatusTodo from "../components/StatusTodo";
import type { BriefView } from "../status-brief";
import type { TodoView } from "../status-todo";
import type { StatusTodoHandle } from "../use-status-todo";
import { resetLanguageForTest, t } from "../i18n";

const dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "status-dismiss-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmTempDir(d); resetLanguageForTest(); });

const PR = "https://github.com/o/r/pull/18361";
const THREAD = "https://x.slack.com/archives/C1/p2";
const BRIEF = {
  waiting: [{ kind: "review", title: "LGTM gate on PR #18361", source: "github", url: PR }],
  todo: [],
  talkTo: [{ kind: "talk", person: "Tomer", title: "LGTM gate on PR #18361", source: "slack", url: THREAD }],
};

describe("what a dismissal is known by", () => {
  it("is an item's page, whatever kind of ask it is, else its session, else its own key", () => {
    expect(dismissKeyOf({ url: `${PR}#discussion`, kind: "review" })).toBe(`url:${PR}`);
    expect(dismissKeyOf({ url: PR, kind: "merge" })).toBe(dismissKeyOf({ url: PR, kind: "review" }));
    expect(dismissKeyOf({ sessionId: "s-1", kind: "decide" })).toBe("session:s-1:brief:decide");
    expect(dismissKeyOf({ key: "session:s-1:wait:asked:5" })).toBe("session:s-1:wait:asked:5");
    expect(dismissKeyOf({ url: "javascript:alert(1)", kind: "talk" })).toBeNull();
    // The brief's items carry it, so the page can leave a dismissed one out.
    expect(normaliseBrief(BRIEF).talkTo[0].dkey).toBe(`url:${THREAD}`);
  });
});

describe("the list's dismissals", () => {
  it("close the item's mirror, keep a later brief from adding it again, and come back on undo", () => {
    const store = normaliseStore(null);
    const [review] = ingestBrief(store, normaliseBrief(BRIEF), 1000);
    expect(review.title).toBe("LGTM gate on PR #18361");
    dismiss(store, { key: `url:${PR}`, title: review.title, url: PR, source: "github" }, 2000);
    expect(review).toMatchObject({ state: "closed", closedReason: DISMISSED_REASON, closedBy: "hagai" });
    // Pruned or not, the next brief that names it adds nothing.
    store.items = [];
    expect(ingestBrief(store, normaliseBrief(BRIEF), 3000)).toEqual([]);
    expect(addItem(store, { origin: "brief", kind: "merge", title: "Merge it", key: "url:x:merge", link: { url: PR } }, 3000)).toBeNull();
    // Undo forgets it and reopens what it closed.
    const again = normaliseStore(null);
    const [item] = ingestBrief(again, normaliseBrief(BRIEF), 1000);
    dismiss(again, { key: `url:${PR}`, title: item.title }, 2000);
    expect(restore(again, `url:${PR}`, 2500)).toBe(true);
    expect(item.state).toBe("open");
    expect(again.dismissed).toEqual([]);
  });

  it("come back on their own only when the source shows activity after the dismissal", () => {
    const store = normaliseStore(null);
    const [item] = ingestBrief(store, normaliseBrief(BRIEF), 1000);
    dismiss(store, { key: `url:${PR}`, title: item.title }, 5000);
    // Activity from before the dismissal (or none at all) changes nothing.
    expect(reviveOnActivity(store, normaliseBrief({ waiting: [{ ...BRIEF.waiting[0], activityAt: new Date(4000).toISOString() }] }), 6000)).toEqual([]);
    expect(reviveOnActivity(store, normaliseBrief(BRIEF), 6000)).toEqual([]);
    expect(item.state).toBe("closed");
    // A new comment after it does.
    expect(reviveOnActivity(store, normaliseBrief({ talkTo: [], waiting: [{ ...BRIEF.waiting[0], activityAt: new Date(5500).toISOString() }] }), 6000)).toEqual([`url:${PR}`]);
    expect(item.state).toBe("open");
    expect(store.dismissed).toEqual([]);
  });

  it("keep the newest MAX_DISMISSED, and drop what a file holds that is not one", () => {
    const store = normaliseStore(null);
    for (let i = 0; i < MAX_DISMISSED + 5; i++) dismiss(store, { key: `url:https://e.com/${i}`, title: `n${i}` }, 1000 + i);
    expect(store.dismissed).toHaveLength(MAX_DISMISSED);
    expect(store.dismissed[0].title).toBe("n5");
    const read = normaliseStore({ dismissed: [{ key: "url:https://e.com/a", at: 1, title: "a" }, { key: "", at: 1, title: "b" }, { key: "k", title: "no time" }, "x"] });
    expect(read.dismissed.map(d => d.key)).toEqual(["url:https://e.com/a"]);
  });
});

describe("the runner and its routes", () => {
  const sessions = async () => ({ rows: [], digest: [] });

  it("keeps dismissals in the list's 0700 folder, across a restart, and hands them to the open pages", async () => {
    const dir = tempDir();
    const frames: TodoView[] = [];
    const t1 = createStatusTodo({ dir, agent: async () => null, sessions, broadcast: v => frames.push(v as TodoView), now: () => 1000 });
    await t1.brief(normaliseBrief(BRIEF));
    const r = await t1.dismissBriefItem(BRIEF.talkTo[0]);
    expect(r).toEqual({ ok: true, dismissed: { key: `url:${THREAD}`, title: "Tomer · LGTM gate on PR #18361" } });
    // A list item dismissed by id is remembered by its page too.
    const id = (await t1.view()).open[0].id;
    expect((await t1.act({ action: "dismiss", id })).dismissed).toEqual({ key: `url:${PR}`, title: "LGTM gate on PR #18361" });
    await t1.settled();
    expect(statSync(join(dir, TODO_DIR)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(join(dir, TODO_DIR, TODO_FILE), "utf8")).dismissed.map((d: { key: string }) => d.key)).toEqual([`url:${THREAD}`, `url:${PR}`]);
    expect(frames.at(-1)!.dismissed!.map(d => d.key)).toEqual([`url:${PR}`, `url:${THREAD}`]);
    const t2 = createStatusTodo({ dir, agent: async () => null, sessions, now: () => 2000 });
    expect((await t2.view()).dismissed!.map(d => d.title)).toEqual(["LGTM gate on PR #18361", "Tomer · LGTM gate on PR #18361"]);
    expect((await t2.dismissed()).map(d => d.url)).toEqual([PR, THREAD]);
    // Reopen from Recently closed undoes the dismissal as well.
    await t2.act({ action: "reopen", id });
    expect((await t2.view()).dismissed!.map(d => d.key)).toEqual([`url:${THREAD}`]);
  });

  it("work the key out from the item's own link, never from the page, and bring it back on restore", async () => {
    const dir = tempDir();
    useStatusTodoForTest(createStatusTodo({ dir, agent: async () => null, sessions, now: () => 1 }));
    const request = (path: string, body: unknown) => {
      const req = Readable.from([Buffer.from(JSON.stringify(body))]) as Readable & { method: string; headers: object; url: string };
      Object.assign(req, { method: "POST", headers: { host: "127.0.0.1:4317" }, url: path });
      let status = 0; let text = "";
      const res = { headersSent: false, writeHead(s: number) { status = s; this.headersSent = true; return this; }, end(x: string) { text = x; }, setHeader() {} };
      return handleStatusTodo(req, res, new URL(`http://127.0.0.1${path}`)).then(() => ({ status, json: JSON.parse(text || "null") }));
    };
    const ok = await request("/api/status-todo/dismiss", { item: { ...BRIEF.talkTo[0], dkey: "url:https://evil.example/" }, key: "anything" });
    expect(ok.status).toBe(200);
    expect(ok.json.dismissed.key).toBe(`url:${THREAD}`);
    expect((await request("/api/status-todo/dismiss", { item: { kind: "talk", title: "nowhere" } })).status).toBe(400);
    const back = await request("/api/status-todo/restore", { key: `url:${THREAD}` });
    expect(back.status).toBe(200);
    expect(back.json.changed).toBe(true);
  });
});

describe("the brief's prompt", () => {
  it("names what was dismissed, asks for activity times, and the runner hands it the list's dismissals", async () => {
    const prompt = buildPrompt({ sessions: [], reach: { github: "on", slack: "on", jira: "none" }, since: 0, now: 0,
      dismissed: [{ key: `url:${PR}`, url: PR, title: "LGTM gate", at: Date.parse("2026-11-24T08:00:00Z") }] });
    expect(prompt).toMatch(/The developer dismissed the items below\. Leave each out, unless its source shows activity/);
    expect(prompt).toContain(`- ${PR} · "LGTM gate" · dismissed 2026-11-24T08:00:00.000Z`);
    expect(prompt).toMatch(/"activityAt": "ISO time of the newest activity you saw on its source"/);
    expect(buildPrompt({ sessions: [], reach: {}, since: 0, now: 0 })).not.toMatch(/dismissed the items/);

    const calls: { prompt: string }[] = [];
    const agent = { listConnectors: async () => [], runAgent: async (c: { prompt: string }) => { calls.push(c); return { ok: true, json: { summary: "x" } }; } };
    const todo = { watched: async () => [], dismissed: async () => [{ key: `url:${THREAD}`, url: THREAD, title: "Tomer · LGTM", at: 1 }], brief: async () => ({}) };
    const b = createStatusBrief({ dir: tempDir(), agent: async () => agent, sessions: async () => ({ rows: [], envelopes: [] }), todo, now: () => 5 });
    await b.refresh(); await b.settled();
    expect(calls[0].prompt).toContain(`- ${THREAD} · "Tomer · LGTM"`);
  });
});

describe("the pane", () => {
  const VIEW: BriefView = {
    ok: true, now: 2_000_000, running: false, lastRunAt: 1, nextAutoAt: null, agent: "ready", error: null,
    settings: { model: "haiku", everyMinutes: 30, sources: { github: true, slack: true, jira: true } },
    people: { pinned: [], hidden: [] },
    brief: {
      at: 1, model: "haiku", summary: "s", reach: { github: "on", slack: "on", jira: "on" }, waiting: [], todo: [], people: [],
      talkTo: [
        { kind: "talk", person: "Tomer", title: "LGTM gate", source: "slack", url: THREAD, dkey: `url:${THREAD}` },
        { kind: "talk", person: "Karen", title: "TRI-2985", source: "jira", url: "https://x.atlassian.net/browse/TRI-2985", dkey: "url:https://x.atlassian.net/browse/TRI-2985" },
      ],
    },
  };
  const TODO: TodoView = {
    ok: true, now: 2_000_000, keeper: { lastRunAt: null, lastCostUsd: null, error: null }, closed: [],
    open: [{ id: "t_aaaaaa1", title: "Review #12", kind: "review", origin: "brief", link: { kind: "pr", url: PR }, state: "open", createdAt: 1, updatedAt: 1 }],
    dismissed: [{ key: "url:https://x.atlassian.net/browse/TRI-2985", at: 1, title: "Karen · TRI-2985", source: "jira" }],
  };
  const handle = (over: Partial<StatusTodoHandle> = {}): StatusTodoHandle => ({ view: TODO, say() {}, act() {}, dismiss() {}, restore() {}, undo: null, ...over });
  const brief = { view: VIEW, unreachable: false, refresh() {}, setSettings() {}, person() {} };
  const draw = (todo = handle()) => renderToStaticMarkup(createElement(StatusPaneView, {
    rows: [], now: 2_000_000, brief, todo, pinned: false, onTogglePin() {}, besideInspector: false, onOpenSession() {}, onClose() {},
  }));

  it("puts a dismiss on every Talk to and list row, and leaves out what was dismissed", () => {
    const html = draw();
    expect(html).toContain("LGTM gate");
    expect(html).not.toMatch(/<span class="stp-title"><b>Karen<\/b>/);
    expect(html).toMatch(/<button type="button" class="glyph-btn stp-dismiss" aria-label="Dismiss “LGTM gate”"/);
    expect(html).toMatch(/<button type="button" class="glyph-btn stp-dismiss" aria-label="Dismiss “Review #12”"/);
  });

  it("says how many are dismissed, and offers each back", () => {
    const html = draw();
    expect(html).toMatch(/<details class="stp-closed stp-dismissed"><summary class="stp-h">1 dismissed · show<\/summary>/);
    expect(html).toMatch(/Karen · TRI-2985<\/span><\/span><button type="button" class="stp-chip stp-restore" aria-label="Show “Karen · TRI-2985” again">Show again</);
    expect(draw(handle({ view: { ...TODO, dismissed: [] } }))).not.toContain("stp-dismissed");
  });

  it("offers Undo right after a dismiss, in a live region", () => {
    expect(draw(handle({ undo: { key: `url:${THREAD}`, title: "Tomer · LGTM gate" } })))
      .toMatch(/<p class="stp-undo" role="status" aria-live="polite"><span class="stp-undo-text">Dismissed “Tomer · LGTM gate”<\/span><button type="button" class="stp-chip stp-undo-btn">Undo<\/button><\/p>/);
    expect(draw()).toMatch(/<p class="stp-undo" role="status" aria-live="polite"><\/p>/);
  });

  it("draws no dismiss where the deck offers none", () => {
    const html = renderToStaticMarkup(createElement(StatusTodo, { todo: { view: TODO, say() {}, act() {} }, now: 2_000_000, sessions: new Set(), onOpenSession() {}, t }));
    expect(html).not.toContain("stp-dismiss");
  });
});
