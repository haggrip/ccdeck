// Mission: the Todo list and the brief as the deck's main page (use-mission.ts,
// StatusPane.tsx variant "mission", ViewSwitch.tsx), and its sessions opening
// in the Claude desktop app (desktop-links.ts, desktop-sessions.mjs, the
// desktop shell's nav.mjs).
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmTempDir } from "./rm-temp-dir";
import { readMission, writeMission, MISSION_KEY } from "../use-mission";
import { desktopHref } from "../desktop-links";
import { openerOf, type TodoItem, type TodoView } from "../status-todo";
import StatusTodo from "../components/StatusTodo";
import { StatusPaneView } from "../components/StatusPane";
import ViewSwitch from "../components/ViewSwitch";
import type { StatusTodoHandle } from "../use-status-todo";
import type { StatusBriefHandle } from "../use-status-brief";
import { resetLanguageForTest, t } from "../i18n";
import { createDesktopSessions, desktopSessionsRoot, linkOf, desktopLinksVetoed } from "../../server/desktop-sessions.mjs";
import { GUARDED_READS } from "../../server/request-gates.mjs";
import { SETTING_VARS } from "../../server/login-service.mjs";
import { navigationFor, claudeSessionLink } from "../../../desktop/nav.mjs";

afterEach(() => resetLanguageForTest());

const LOCAL = "local_bda3155a-32db-4c0a-ac48-8a971213245c";
const CLI = "1bedd631-f6d2-4e5d-a5bf-37d4edded680";
const NOW = Date.parse("2026-11-24T10:00:00Z");
const item = (over: Partial<TodoItem>): TodoItem => ({
  id: "t_000001", title: "x", kind: "todo", origin: "hagai", link: null, state: "open", createdAt: 1, updatedAt: 1, ...over,
});

describe("Mission is the page a browser lands on", () => {
  it("is on unless this browser turned it off", () => {
    expect(readMission(() => null)).toBe(true);
    expect(readMission(k => (k === MISSION_KEY ? "1" : null))).toBe(true);
    expect(readMission(k => (k === MISSION_KEY ? "0" : null))).toBe(false);
    const kept: Record<string, string> = {};
    writeMission(false, (k, v) => { kept[k] = v; });
    expect(kept).toEqual({ [MISSION_KEY]: "0" });
  });

  it("is the first of the topbar's views, with Workspace only where it is on offer", () => {
    const three = renderToStaticMarkup(createElement(ViewSwitch, { view: "mission", workspace: true, onChange() {} }));
    expect(three.match(/class="view-opt"/g)).toHaveLength(3);
    expect(three).toMatch(/aria-pressed="true"[^>]*>.*Mission/);
    const two = renderToStaticMarkup(createElement(ViewSwitch, { view: "board", workspace: false, onChange() {} }));
    expect(two.match(/class="view-opt"/g)).toHaveLength(2);
    expect(two).not.toMatch(/Workspace/);
  });
});

describe("a session's link into the desktop app", () => {
  it("is the app's own continue link, for a session the app runs, and nothing else", () => {
    expect(desktopHref(CLI, { [CLI]: LOCAL })).toBe(`claude://code/continue?session=${LOCAL}`);
    expect(desktopHref("other", { [CLI]: LOCAL })).toBeNull();
    expect(desktopHref(CLI, { [CLI]: "local_x&prompt=rm" })).toBeNull();
    expect(desktopHref(CLI, { [CLI]: "session_abc" })).toBeNull();
    expect(desktopHref("constructor", {})).toBeNull();
    expect(desktopHref(null, { [CLI]: LOCAL })).toBeNull();
  });

  it("comes first on a Todo item, with the card still offered while the board has it", () => {
    const it1 = item({ link: { kind: "session", sessionId: CLI, project: "api" } });
    expect(openerOf(it1, new Set([CLI]), { [CLI]: LOCAL })).toEqual({ session: CLI, desktop: `claude://code/continue?session=${LOCAL}`, project: "api" });
    // Off the board, the app still opens it.
    expect(openerOf(it1, new Set(), { [CLI]: LOCAL })).toEqual({ desktop: `claude://code/continue?session=${LOCAL}`, project: "api" });
    // Not the app's: the card, as before.
    expect(openerOf(it1, new Set([CLI]), {})).toEqual({ session: CLI, project: "api" });
  });

  it("is drawn as a plain link with no new tab, and a board button beside it", () => {
    const view: TodoView = { ok: true, now: NOW, closed: [], keeper: { lastRunAt: null, lastCostUsd: null, error: null },
      open: [item({ title: "Which schema?", kind: "answer", origin: "deck", link: { kind: "session", sessionId: CLI, project: "api" } })] };
    const todo: StatusTodoHandle = { view, say() {}, act() {} };
    const html = renderToStaticMarkup(createElement(StatusTodo, { todo, now: NOW, sessions: new Set([CLI]), desktop: { [CLI]: LOCAL }, onOpenSession() {}, t }));
    const a = html.match(/<a class="stp-link"[^>]*>/)?.[0] ?? "";
    expect(a).toContain(`href="claude://code/continue?session=${LOCAL}"`);
    expect(a).not.toMatch(/target=/);
    expect(html).toContain("Claude app");
    expect(html).toMatch(/class="glyph-btn stp-todo-card"/);
  });
});

describe("the Mission page", () => {
  const brief: StatusBriefHandle = { view: null, unreachable: false, refresh() {}, setSettings() {}, person() {} };
  const todo: StatusTodoHandle = { view: { ok: true, now: NOW, open: [], closed: [], keeper: { lastRunAt: null, lastCostUsd: null, error: null } }, say() {}, act() {} };
  const draw = (variant: "pane" | "mission") => renderToStaticMarkup(createElement(StatusPaneView, {
    rows: [], now: NOW, brief, todo, pinned: false, onTogglePin() {}, besideInspector: true, onOpenSession() {}, onClose() {}, variant,
  }));

  it("is the pane's contents in two columns, with no pin, close or fold", () => {
    const html = draw("mission");
    expect(html).toMatch(/^<section class="status-pane mission"/);
    expect(html).toContain('class="mission-cols"');
    expect(html).toMatch(/class="mission-main">.*class="stp-todo"/);
    expect(html).not.toMatch(/stp-pin|stp-close|fold-row/);
    expect(html).toContain("stp-refresh");
  });

  it("leaves the pane as it was", () => {
    const html = draw("pane");
    expect(html).toMatch(/^<aside class="status-pane"/);
    expect(html).not.toContain("mission-cols");
  });
});

describe("reading the desktop app's session ids", () => {
  const root = mkdtempSync(join(tmpdir(), "ccdeck-desktop-"));
  afterAll(() => rmTempDir(root));
  const org = join(root, "acct", "org");
  mkdirSync(org, { recursive: true });
  const put = (name: string, body: object, mtime: number) => {
    const p = join(org, name);
    writeFileSync(p, JSON.stringify(body));
    utimesSync(p, mtime, mtime);
    return p;
  };

  it("keeps the app's id and the Claude Code ids, and nothing else", () => {
    expect(linkOf(JSON.stringify({ sessionId: LOCAL, cliSessionId: CLI, title: "secret", cwd: "/x" }))).toEqual({ local: LOCAL, cli: [CLI], archived: false });
    expect(linkOf(JSON.stringify({ sessionId: "nope", cliSessionId: CLI }))).toBeNull();
    expect(linkOf(JSON.stringify({ sessionId: LOCAL }))).toBeNull();
    expect(linkOf("{ not json")).toBeNull();
  });

  it("maps each live session, skips archived ones, prefers the newest, and parses a file again only when it changes", async () => {
    put("local_aaaaaaaa-0001.json", { sessionId: "local_aaaaaaaa-0001", cliSessionId: "cli-aaaa-0001" }, 1000);
    put("local_aaaaaaaa-0002.json", { sessionId: "local_aaaaaaaa-0002", cliSessionId: "cli-bbbb-0002", isArchived: true }, 1000);
    // Two app sessions on one conversation (a resume): the newer one wins.
    put("local_aaaaaaaa-0003.json", { sessionId: "local_aaaaaaaa-0003", cliSessionId: "cli-cccc-0003" }, 1000);
    put("local_aaaaaaaa-0004.json", { sessionId: "local_aaaaaaaa-0004", cliSessionId: "cli-dddd-0004", lastAssistantCliSessionId: "cli-cccc-0003" }, 2000);
    writeFileSync(join(org, "notes.json"), "{}");
    let reads = 0;
    let clock = 0;
    const reader = createDesktopSessions({ root, env: {}, now: () => clock, fs: { stat, readFile: (p: string, e: BufferEncoding) => { reads++; return readFile(p, e); } } });
    expect(await reader.links()).toEqual({
      "cli-aaaa-0001": "local_aaaaaaaa-0001",
      "cli-cccc-0003": "local_aaaaaaaa-0004",
      "cli-dddd-0004": "local_aaaaaaaa-0004",
    });
    expect(reads).toBe(4);
    clock = 60_000;
    put("local_aaaaaaaa-0004.json", { sessionId: "local_aaaaaaaa-0004", cliSessionId: "cli-dddd-0004", isArchived: true }, 3000);
    const next = await reader.links();
    expect(reads).toBe(5);
    expect(next).toEqual({ "cli-aaaa-0001": "local_aaaaaaaa-0001", "cli-cccc-0003": "local_aaaaaaaa-0003" });
  });

  it("reads nothing under its off switch, and looks where the app keeps them", async () => {
    expect(desktopLinksVetoed({ AGENTS_DECK_NO_DESKTOP_LINKS: "1" })).toBe(true);
    const reader = createDesktopSessions({ root, env: { AGENTS_DECK_NO_DESKTOP_LINKS: "1" }, now: () => 0 });
    expect(await reader.links()).toEqual({});
    expect(desktopSessionsRoot("darwin", {}, "/Users/me")).toBe("/Users/me/Library/Application Support/Claude/claude-code-sessions");
  });
});

describe("the wiring", () => {
  const server = (f: string) => readFileSync(fileURLToPath(new URL(`../../server/${f}`, import.meta.url)), "utf8");
  it("is a guarded read for this computer only, whose off switch a login item carries", () => {
    expect([...GUARDED_READS]).toContain("/api/desktop-sessions");
    expect(server("index.mjs")).toMatch(/GET".*\/api\/desktop-sessions".*handleDesktopSessionsRead/);
    expect(server("remote-control-routes.mjs")).toMatch(/handleDesktopSessionsRead[\s\S]*?loopback\(req\)/);
    expect(SETTING_VARS).toContain("AGENTS_DECK_NO_DESKTOP_LINKS");
  });

  it("lets the desktop shell hand only the deck's two claude:// shapes to the OS", () => {
    const origin = "http://127.0.0.1:4317";
    expect(navigationFor(`claude://code/continue?session=${LOCAL}`, origin)).toBe("external");
    expect(navigationFor("claude://code/session_017qTQardmNuDpppY8EFZziJ", origin)).toBe("external");
    for (const url of ["claude://code/new?q=rm%20-rf", "claude://code/continue?session=last", `claude://code/continue?session=${LOCAL}&x=1`, "claude://claude.ai/new"]) {
      expect(claudeSessionLink(url), url).toBe(false);
      expect(navigationFor(url, origin), url).toBe("block");
    }
  });
});
