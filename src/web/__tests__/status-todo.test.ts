// The live Todo list on the page (status-todo.ts, components/StatusTodo.tsx):
// which heading an item stands under, where it opens, how its due time and
// its snooze read, and that Recently closed can reopen what it shows.
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StatusTodo from "../components/StatusTodo";
import { isOverdue, isSnoozed, openerOf, splitOpen, tomorrowMorning, type TodoItem, type TodoView } from "../status-todo";
import type { StatusTodoHandle } from "../use-status-todo";
import { resetLanguageForTest, t } from "../i18n";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

afterEach(() => resetLanguageForTest());

const NOW = Date.parse("2026-11-23T18:00:00Z");
const item = (over: Partial<TodoItem>): TodoItem => ({
  id: "t_000001", title: "x", kind: "todo", origin: "hagai", link: null, state: "open", createdAt: 1, updatedAt: 1, ...over,
});

const OPEN: TodoItem[] = [
  item({ id: "t_000001", title: "Re-add the env-stopper label", kind: "follow-up", origin: "hagai", due: NOW - 60_000, link: { kind: "pr", url: "https://github.com/acme/infra/pull/31" } }),
  item({ id: "t_000002", title: "Webhook retries", detail: "Which retry budget?", kind: "answer", origin: "deck", link: { kind: "session", sessionId: "s-live", project: "api" } }),
  item({ id: "t_000003", title: "Hagai needs to approve the Okta PR", kind: "todo", origin: "session", link: { kind: "project", project: "okta-sync", cwd: "/home/dev/okta-sync" } }),
  item({ id: "t_000004", title: "Old session", kind: "decide", origin: "brief", link: { kind: "session", sessionId: "s-gone", project: "web" } }),
  item({ id: "t_000005", title: "Read the RFC", kind: "note", origin: "hagai", snoozedUntil: NOW + 3600_000 }),
];
const CLOSED: TodoItem[] = [
  item({ id: "t_000009", title: "Review #12", kind: "review", origin: "brief", state: "closed", closedAt: NOW - 1000, closedBy: "brief", closedReason: "Approved" }),
];
const VIEW: TodoView = { ok: true, now: NOW, open: OPEN, closed: CLOSED, keeper: { lastRunAt: null, lastCostUsd: null, error: null } };

const handle = (view: TodoView | null = VIEW, over: Partial<StatusTodoHandle> = {}): StatusTodoHandle => ({ view, say() {}, act() {}, ...over });
const draw = (h = handle()) => renderToStaticMarkup(createElement(StatusTodo, { todo: h, now: NOW, sessions: new Set(["s-live"]), onOpenSession() {}, t }));

describe("the list's rules", () => {
  it("puts who waits on you under Waiting on you, and the rest under To do", () => {
    const { waiting, todo } = splitOpen(OPEN);
    expect(waiting.map(i => i.id)).toEqual(["t_000002", "t_000004"]);
    expect(todo.map(i => i.id)).toEqual(["t_000001", "t_000003", "t_000005"]);
  });

  it("opens a session the board has, a page, or names the project", () => {
    const live = new Set(["s-live"]);
    expect(openerOf(OPEN[1], live)).toEqual({ session: "s-live", project: "api" });
    expect(openerOf(OPEN[0], live)).toEqual({ href: "https://github.com/acme/infra/pull/31" });
    expect(openerOf(OPEN[2], live)).toEqual({ project: "okta-sync" });
    // A session the board no longer has still shows its project.
    expect(openerOf(OPEN[3], live)).toEqual({ project: "web" });
    expect(openerOf(item({ link: { kind: "url", url: "javascript:alert(1)" } }), live)).toEqual({});
  });

  it("knows what is overdue and what is snoozed, and when tomorrow morning is", () => {
    expect(isOverdue(OPEN[0], NOW)).toBe(true);
    expect(isSnoozed(OPEN[4], NOW)).toBe(true);
    expect(isSnoozed(OPEN[4], NOW + 7200_000)).toBe(false);
    const nine = new Date(tomorrowMorning(NOW));
    expect([nine.getHours(), nine.getMinutes()]).toEqual([9, 0]);
    expect(tomorrowMorning(NOW)).toBeGreaterThan(NOW);
  });
});

describe("the list's markup", () => {
  it("draws both headings, each item's source and origin, and links that open where they came from", () => {
    const html = draw();
    expect(html).toContain(">Waiting on you<");
    expect(html).toContain(">To do<");
    expect(html).toMatch(/<a class="stp-link" href="https:\/\/github.com\/acme\/infra\/pull\/31" target="_blank" rel="noreferrer noopener"/);
    expect(html).toMatch(/<button type="button" class="stp-link" title="Show this session&#x27;s card"><span class="stp-title">Webhook retries<\/span>/);
    // A project-only item, and a session the board no longer has, name their project and open nothing.
    expect(html).toMatch(/<span class="stp-link"><span class="stp-title">Hagai needs to approve the Okta PR<\/span><span class="stp-src"><span class="stp-sep">okta-sync<\/span><span class="stp-sep">from a session<\/span>/);
    // A note with no link starts with where it came from.
    expect(html).toMatch(/<span class="stp-src"><span class="stp-sep">your note<\/span><\/span>/);
    expect(html).toContain("from a session");
    expect(html).toContain("your note");
    expect(html).toContain("from the board");
  });

  it("marks what is overdue and what is snoozed", () => {
    const html = draw();
    expect(html).toMatch(/data-kind="follow-up" data-overdue=""/);
    expect(html).toMatch(/<span class="stp-due" data-overdue="">overdue since /);
    expect(html).toMatch(/data-snoozed=""/);
    expect(html).toMatch(/<span class="stp-due">snoozed until /);
    expect(html).toContain("stp-todo-wake");
  });

  it("keeps Recently closed, with the reason, and a way to reopen", () => {
    const html = draw();
    expect(html).toMatch(/<details class="stp-closed"><summary class="stp-h">Recently closed<span class="stp-n">1<\/span>/);
    expect(html).toMatch(/Review #12<\/span><span class="stp-detail">Approved<\/span>/);
    expect(html).toContain(">Reopen<");
  });

  it("says when the keeper is reading, and when it could not", () => {
    expect(draw(handle({ ...VIEW, keeperReading: true }))).toContain("Reading what you wrote…");
    // A brief's or a session's batch is not the user's words.
    expect(draw(handle({ ...VIEW, keeperQueued: 2, keeperRunning: true }))).not.toContain("Reading what you wrote…");
    expect(draw(handle({ ...VIEW, keeper: { lastRunAt: 1, lastCostUsd: null, error: { at: 1, code: "timeout", message: "took too long" } } }))).toContain("The list could not read that: took too long");
    // A deck without Claude Code says it once, in the brief's own line, not here too.
    expect(draw(handle({ ...VIEW, keeper: { lastRunAt: 1, lastCostUsd: null, error: { at: 1, code: "agent-off", message: "x" } } }))).not.toContain("could not read");
  });

  it("offers only its box, snooze, wake, close and reopen: nothing that posts anywhere else", () => {
    const html = draw();
    const classes = new Set([...html.matchAll(/<button[^>]*class="([^"]+)"/g)].map(m => m[1]));
    expect(classes).toEqual(new Set(["glyph-btn stp-say-send", "stp-link", "glyph-btn stp-todo-snooze", "glyph-btn stp-todo-done", "glyph-btn stp-todo-wake", "stp-chip stp-todo-reopen"]));
    expect(html).toMatch(/<input type="text" class="ui-input stp-say-input"/);
  });

  it("follows the deck's frames: the hook listens for the stream's status-todo event", () => {
    const stream = readFileSync(fileURLToPath(new URL("../use-event-stream.ts", import.meta.url)), "utf8");
    expect(stream).toMatch(/es\.addEventListener\("status-todo", \(e\) => \{\s*window\.dispatchEvent\(new CustomEvent\(STATUS_TODO_EVENT/);
    const hook = readFileSync(fileURLToPath(new URL("../use-status-todo.ts", import.meta.url)), "utf8");
    expect(hook).toMatch(/window\.addEventListener\(STATUS_TODO_EVENT, onFrame\)/);
  });
});
