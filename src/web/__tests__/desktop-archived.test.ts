// A session archived in the Claude desktop app leaves the deck's lists: the
// Sessions list, Mission, the brief and the Todo list (desktop-sessions.mjs,
// use-desktop-links.ts, SessionList.tsx archivedAway, status-todo.mjs
// reconcileDeck). One that needs the person, or is at work, stays.
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmTempDir } from "./rm-temp-dir";
import { applyEvent, initialState, type GraphState } from "../reducer";
import type { HookEnvelope, HookPayload } from "../types";
import { archivedAway, buildRows, type Row } from "../components/SessionList";
import { liveState } from "../components/MissionView";
import { archivedFrom } from "../use-desktop-links";
import { createDesktopSessions, shownDespiteArchive, withoutArchived } from "../../server/desktop-sessions.mjs";
import { addItem, normaliseStore, reconcileDeck } from "../../server/status-todo.mjs";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("reading which sessions the desktop app archived", () => {
  const root = mkdtempSync(join(tmpdir(), "ccdeck-archived-"));
  afterAll(() => rmTempDir(root));
  const org = join(root, "acct", "org");
  mkdirSync(org, { recursive: true });
  const put = (n: string, body: object, mtime = 1000) => {
    const p = join(org, `local_aaaaaaaa-${n}.json`);
    writeFileSync(p, JSON.stringify({ sessionId: `local_aaaaaaaa-${n}`, ...body }));
    utimesSync(p, mtime, mtime);
  };

  it("names a conversation only archived app sessions name, and follows the flag both ways", async () => {
    put("0001", { cliSessionId: "cli-live-0001" });
    put("0002", { cliSessionId: "cli-gone-0002", isArchived: true });
    // Archived in one app session, resumed in a live one: not archived.
    put("0003", { cliSessionId: "cli-both-0003", isArchived: true });
    put("0004", { cliSessionId: "cli-next-0004", lastAssistantCliSessionId: "cli-both-0003" });
    let clock = 0;
    const reader = createDesktopSessions({ root, env: {}, now: () => clock });
    const first = await reader.read();
    expect(first.archived).toEqual(["cli-gone-0002"]);
    expect(Object.keys(first.links).sort()).toEqual(["cli-both-0003", "cli-live-0001", "cli-next-0004"]);
    expect(await reader.links()).toBe(first.links);
    // Archived later, and the other one restored.
    clock = 60_000;
    put("0001", { cliSessionId: "cli-live-0001", isArchived: true }, 2000);
    put("0002", { cliSessionId: "cli-gone-0002" }, 2000);
    expect((await reader.read()).archived).toEqual(["cli-live-0001"]);
  });

  it("reads nothing under the off switch", async () => {
    const reader = createDesktopSessions({ root, env: { AGENTS_DECK_NO_DESKTOP_LINKS: "1" }, now: () => 0 });
    expect(await reader.read()).toEqual({ links: {}, archived: [] });
  });

  it("keeps the page's set when the answer did not change, and takes strings only", () => {
    const had = archivedFrom(["a", "b"], new Set());
    expect([...had]).toEqual(["a", "b"]);
    expect(archivedFrom(["b", "a"], had)).toBe(had);
    expect([...archivedFrom(["a", 7, null], had)]).toEqual(["a"]);
    expect(archivedFrom(undefined, had).size).toBe(0);
  });
});

describe("the server's sessions without the archived ones", () => {
  const row = (id: string, state: string) => ({ id, state, name: id, since: 1, lastEventAt: 1, waiting: null });

  it("drops an archived session unless it works or waits right now", () => {
    const rows = [row("idle", "idle"), row("ended", "ended"), row("working", "working"), row("waiting", "waiting"), row("kept", "idle")];
    const archived = new Set(["idle", "ended", "working", "waiting"]);
    expect(withoutArchived(rows, archived).map(r => r.id)).toEqual(["working", "waiting", "kept"]);
    expect(withoutArchived(rows, new Set())).toBe(rows);
    expect([shownDespiteArchive("working"), shownDespiteArchive("waiting"), shownDespiteArchive("idle")]).toEqual([true, true, false]);
  });

  it("closes what the deck and the brief added for an archived session, and keeps what was written by hand", () => {
    const s = normaliseStore(null);
    const waitingRow = { id: "s1", name: "schema", project: "api", cwd: "/w/api", state: "waiting", since: 5, lastEventAt: 5, waiting: { kind: "asked", message: "Which?", since: 5 } };
    reconcileDeck(s, [waitingRow], [], 10);
    addItem(s, { origin: "brief", kind: "todo", title: "Finish the schema", link: { sessionId: "s1" } }, 10);
    addItem(s, { origin: "hagai", kind: "todo", title: "Tell Dana about s1", link: { sessionId: "s1" } }, 10);
    addItem(s, { origin: "session", kind: "review", title: "Review the s1 PR", link: { sessionId: "s1" } }, 10);
    addItem(s, { origin: "brief", kind: "todo", title: "Other session", link: { sessionId: "s2" } }, 10);
    const open = () => s.items.filter((i: { state: string }) => i.state === "open").map((i: { title: string }) => i.title).sort();
    expect(open()).toHaveLength(5);

    // Archived but still waiting: it is in the rows, and nothing closes.
    expect(reconcileDeck(s, [waitingRow], [], 20, { archived: new Set(["s1"]) })).toBe(false);

    // Archived and put away.
    expect(reconcileDeck(s, [], [], 30, { archived: new Set(["s1"]) })).toBe(true);
    expect(open()).toEqual(["Other session", "Review the s1 PR", "Tell Dana about s1"]);
    const closed = s.items.filter((i: { state: string }) => i.state === "closed");
    expect(closed.map((i: { closedReason?: string }) => i.closedReason)).toEqual(["Archived in Claude Desktop", "Archived in Claude Desktop"]);
  });

  it("is what the brief and the Todo list read, and the Todo list looks again when only the archive moved", () => {
    const brief = src("../../server/status-brief-routes.mjs");
    // CHANGED ON PURPOSE: the paired decks' sessions join after the archived
    // are dropped from this deck's own (paired-sessions.mjs).
    expect(brief).toContain("const local = withoutArchived(summarizeSessions(envelopes), await archivedDesktopSessions());");
    expect(brief).toContain("rows: withPairedRows(local, await pairedSessionRows())");
    const todo = src("../../server/status-todo-routes.mjs");
    expect(todo).toContain("const rows = withPairedRows(withoutArchived(summarizeSessions(envelopes), archived), await pairedSessionRows());");
    expect(todo).toMatch(/if \(seq === seenSeq && archived === seenArchived && paired === seenPaired\) return false;/);
    expect(src("../../server/status-todo.mjs")).toContain("reconcileDeck(store, rows, digest, now(), { archived })");
  });
});

describe("the page's lists without the archived sessions", () => {
  let seq = 0;
  let at = 1_800_000_000_000;
  const send = (state: GraphState, sid: string, payload: Partial<HookPayload>) =>
    applyEvent(state, { seq: ++seq, receivedAt: (at += 1_000), source: "hook", payload: { session_id: sid, cwd: "/work/saas-platform", ...payload } as HookPayload } as HookEnvelope);

  /** Five sessions: one never prompted (Ready), one done, one at work, one
   *  waiting on a permission, and one more Ready that nobody archived. */
  function board(): GraphState {
    const s = initialState();
    for (const sid of ["ready", "done", "working", "waiting", "kept"]) send(s, sid, { hook_event_name: "SessionStart" });
    for (const sid of ["done", "working", "waiting"]) send(s, sid, { hook_event_name: "UserPromptSubmit", prompt: `do ${sid}` });
    send(s, "done", { hook_event_name: "Stop" });
    send(s, "waiting", { hook_event_name: "Notification", notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" } as Partial<HookPayload>);
    return s;
  }
  const archived = new Set(["ready", "done", "working", "waiting"]);

  it("drops an archived Ready or Done row, keeps one that needs you or is at work, and the rest", () => {
    const s = board();
    expect(buildRows(s, at).map(r => r.sessionId).sort()).toEqual(["done", "kept", "ready", "waiting", "working"]);
    expect(buildRows(s, at, undefined, archived).map(r => r.sessionId).sort()).toEqual(["kept", "waiting", "working"]);
    expect(buildRows(s, at, undefined, new Set()).length).toBe(5);
  });

  it("asks rank, so a background job keeps its row as Working does", () => {
    const r = { sessionId: "j", label: "j", state: "done", waiting: null, job: { state: "working" } } as unknown as Row;
    expect(archivedAway(r, new Set(["j"]))).toBe(false);
    expect(archivedAway({ ...r, job: null } as Row, new Set(["j"]))).toBe(true);
    expect(archivedAway({ ...r, job: null } as Row, undefined)).toBe(false);
  });

  it("never lists a session that was never prompted as working in Mission", () => {
    const rows = buildRows(board(), at);
    const by = (id: string) => rows.find(r => r.sessionId === id)!;
    expect(liveState(by("ready"))).toBeNull();
    expect(liveState(by("kept"))).toBeNull();
    expect(liveState(by("working"))).toBe("working");
    expect(liveState(by("waiting"))).toBe("waiting");
  });

  it("is wired into the Sessions list, Mission and the Status pane", () => {
    const app = src("../App.tsx");
    expect(app).toContain("const { links: desktopLinks, archived: archivedSessions } = useDesktopSessions();");
    expect(app).toContain("archived={archivedSessions}");
    expect(app).toContain("<MissionView rows={buildRows(stateRef.current, now, watchingSessions, archivedSessions)}");
    expect(app).toContain("<StatusPane rows={buildRows(stateRef.current, now, watchingSessions, archivedSessions)}");
    expect(src("../components/SessionList.tsx")).toContain("buildRows(state, now, watching, archived)");
  });
});
