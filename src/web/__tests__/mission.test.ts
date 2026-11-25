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
import { MissionPage, liveState, sourceOf, toneOf } from "../components/MissionView";
import ViewSwitch from "../components/ViewSwitch";
import type { StatusTodoHandle } from "../use-status-todo";
import type { StatusBriefHandle } from "../use-status-brief";
import type { Row } from "../components/SessionList";
import { resetLanguageForTest, t } from "../i18n";
import { createDesktopSessions, desktopSessionsRoot, linkOf, desktopLinksVetoed, openInDesktop } from "../../server/desktop-sessions.mjs";
import { GUARDED_READS } from "../../server/request-gates.mjs";
import { SETTING_VARS } from "../../server/login-service.mjs";
import { navigationFor, claudeSessionLink } from "../../../desktop/nav.mjs";
import { railItems } from "../rail-items";
import { REMOVED_SURFACES } from "../focused-deck";

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

  it("marks a Todo item whose session the app runs, by the session, whether or not the board has it", () => {
    const it1 = item({ link: { kind: "session", sessionId: CLI, project: "api" } });
    expect(openerOf(it1, new Set([CLI]), { [CLI]: LOCAL })).toEqual({ session: CLI, desktop: CLI, project: "api" });
    expect(openerOf(it1, new Set(), { [CLI]: LOCAL })).toEqual({ desktop: CLI, project: "api" });
    expect(openerOf(it1, new Set([CLI]), {})).toEqual({ session: CLI, project: "api" });
  });

});

describe("the Mission page", () => {
  const row = (over: Partial<Row>): Row => ({ sessionId: "s", label: "session", state: "active", waiting: null, toolCount: 0, cost: 0, startedAt: 0, lastActivity: 0, plan: null, planTitle: "", ...over }) as Row;
  const brief: StatusBriefHandle = { view: null, unreachable: false, refresh() {}, setSettings() {}, person() {} };
  const view: TodoView = { ok: true, now: NOW, closed: [], keeper: { lastRunAt: null, lastCostUsd: null, error: null }, open: [
    item({ id: "t_000001", title: "Which schema?", kind: "answer", origin: "deck", link: { kind: "session", sessionId: CLI, project: "api" } }),
    item({ id: "t_000002", title: "Review acme#1", kind: "review", origin: "brief", link: { kind: "pr", url: "https://github.com/acme/x/pull/1" } }),
    item({ id: "t_000003", title: "Write notes", kind: "todo", origin: "hagai" }),
  ] };
  const rows = [row({ sessionId: CLI, label: "schema", waiting: { kind: "asked", message: "Which schema?", since: 1 } }), row({ sessionId: "w", label: "build" })];
  const opened: string[] = [];
  const draw = () => renderToStaticMarkup(createElement(MissionPage, {
    rows, now: NOW, desktop: { [CLI]: LOCAL }, brief, todo: { view, say() {}, act() {} },
    onOpenSession: (id: string) => opened.push(`card:${id}`), onOpenDesktop: (id: string) => opened.push(`app:${id}`),
  }));

  it("colours each task by the kind of ask it is", () => {
    const html = draw();
    expect(html).toMatch(/class="mi-task" data-tone="ask"[\s\S]*Which schema\?/);
    expect(html).toMatch(/class="mi-task" data-tone="review"/);
    expect(html).toMatch(/class="mi-task" data-tone="do"/);
    expect([toneOf("failed"), toneOf("reply"), toneOf("note")]).toEqual(["err", "talk", "note"]);
  });

  it("offers Open in Claude Desktop on a session the app runs, as a button, never a claude:// link", () => {
    const html = draw();
    expect(html).toMatch(/class="mi-desktop"[^>]*title="Open in Claude Desktop"/);
    expect(html).not.toContain("claude://");
    // The live list carries it too, beside the session's row.
    expect(html).toMatch(/data-live="waiting"[\s\S]*?mi-desktop/);
    expect(sourceOf(view.open[0], true)).toEqual({ key: "claude", name: "Claude Desktop" });
  });

  it("counts what matters, and lists the live sessions by what they need", () => {
    const html = draw();
    // A review waits on you too (status-todo.ts splitOpen).
    expect(html).toMatch(/data-stat="ask"[^>]*><span class="mi-stat-n">2</);
    expect(html).toMatch(/data-stat="do"[^>]*><span class="mi-stat-n">1</);
    expect(liveState(rows[0])).toBe("waiting");
    expect(liveState(rows[1])).toBe("working");
    expect(liveState(row({ state: "done", unseen: false, turnEndedAt: 3 }))).toBeNull();
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

describe("opening a session in the desktop app", () => {
  it("builds the app's link itself and hands it to the OS opener, with no shell", async () => {
    const calls: [string, string[]][] = [];
    const run = async (cmd: string, args: string[]) => { calls.push([cmd, args]); return { ok: true }; };
    expect(await openInDesktop(CLI, { env: {}, platform: "darwin", run, links: { [CLI]: LOCAL } })).toEqual({ ok: true });
    expect(calls).toEqual([["open", [`claude://code/continue?session=${LOCAL}`]]]);
  });

  it("opens only a session the app runs, and nothing under its off switch", async () => {
    const run = async () => { throw new Error("never"); };
    expect(await openInDesktop("other-session-1", { env: {}, platform: "darwin", run, links: { [CLI]: LOCAL } })).toEqual({ ok: false, error: "not-in-app" });
    expect(await openInDesktop("x; rm -rf /", { env: {}, platform: "darwin", run, links: {} })).toEqual({ ok: false, error: "bad-session" });
    expect(await openInDesktop(CLI, { env: {}, platform: "darwin", run, links: { [CLI]: "local_x&q=1" } })).toEqual({ ok: false, error: "not-in-app" });
    expect(await openInDesktop(CLI, { env: { AGENTS_DECK_NO_DESKTOP_LINKS: "1" }, platform: "darwin", run, links: { [CLI]: LOCAL } })).toEqual({ ok: false, error: "off" });
  });
});

describe("the wiring", () => {
  const server = (f: string) => readFileSync(fileURLToPath(new URL(`../../server/${f}`, import.meta.url)), "utf8");
  it("is a guarded read for this computer only, whose off switch a login item carries", () => {
    expect([...GUARDED_READS]).toContain("/api/desktop-sessions");
    expect(server("index.mjs")).toMatch(/GET".*\/api\/desktop-sessions".*handleDesktopSessionsRead/);
    expect(server("remote-control-routes.mjs")).toMatch(/handleDesktopSessionsRead[\s\S]*?loopback\(req\)/);
    expect(SETTING_VARS).toContain("AGENTS_DECK_NO_DESKTOP_LINKS");
    expect(server("index.mjs")).toMatch(/POST".*\/api\/desktop-sessions\/open".*handleDesktopOpen/);
    expect(server("remote-control-routes.mjs")).toMatch(/handleDesktopOpen[\s\S]*?loopback\(req\)/);
  });

  it("leaves Mission for the Board when a session is opened, and draws the Status pane on a phone only", () => {
    const app = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
    expect(app).toMatch(/const openSession = useCallback\(\(sessionId: string\) => \{\s*leaveMission\(\);/);
    expect(app).toMatch(/const focusSessionOnView = useCallback\(\(sessionId: string\) => \{\s*leaveMission\(\);/);
    expect(app).toContain("const statusShown = phone && statusPane.open");
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

describe("the focused deck", () => {
  const noop = () => {};
  const ref = () => ({ current: null });
  const base = {
    providers: { kind: "reported" as const, claude: true, codex: false },
    sessionListOpen: false, toggleSessionList: noop, accountsPanelOpen: false, toggleAccountsPanel: noop,
    usagePanelOpen: false, setUsagePanelOpen: noop, machinePanelOpen: false, setMachinePanelOpen: noop,
    setUsageHistoryOpen: noop, watchOn: false, watchUnseen: 0, setBrowserWatchOpen: noop,
    setTrafficRadarOpen: noop, setRadioOpen: noop, openToolActivity: noop, openCapacity: noop,
    openSettings: noop, onFeedback: noop, openQuickOpen: noop, openExploreIntegrations: noop, toggleStatusPane: noop,
    toggles: { sessionList: ref(), usage: ref(), accounts: ref(), machine: ref() },
  };
  const every = (r: ReturnType<typeof railItems>) => [
    ...r.left, ...r.leftStripe.flat(), ...r.leftFoot, ...r.rightStripe.flat(), ...r.capacity, ...r.right.flat(), ...r.utilities,
  ].map(i => i.id);

  it("draws no door to a removed surface, anywhere the rails are read (Quick Open included)", () => {
    const all = every(railItems(base as Parameters<typeof railItems>[0]));
    const focused = every(railItems({ ...base, focused: true } as Parameters<typeof railItems>[0]));
    for (const id of REMOVED_SURFACES) {
      expect(all, id).toContain(id);
      expect(focused, id).not.toContain(id);
    }
    expect(new Set(focused)).toEqual(new Set(["accounts", "session-list", "explore-integrations", "settings", "status", "browser-watch", "feedback"]));
  });

  it("is what this deck runs", () => {
    const app = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
    expect(app).toContain("const FOCUSED_DECK = true;");
    expect(app).toContain('readView() === "workspace", FOCUSED_DECK);');
    expect(app).toContain("const detailOpen = detailOpenStored && !inspectorGone;");
  });
});
