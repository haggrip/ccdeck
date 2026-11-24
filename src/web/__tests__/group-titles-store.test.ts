// The board's group titles, the server's half without a server: the store
// (group-titles.mjs), the routes that write a person's title and ask the goal
// titler, and how a held title reaches the pages (group-title-route.mjs).
//
// A group carries two titles — a person's, which always wins, and the goal
// titler's — kept in group-titles.json in the deck's data folder, keyed by
// provider and session id. Every path below is a fresh temp folder.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { rmTempDir } from "./rm-temp-dir";
// @ts-expect-error — plain .mjs server module, no types
import * as store from "../../server/group-titles.mjs";
// @ts-expect-error — plain .mjs server module, no types
import * as route from "../../server/group-title-route.mjs";

const DIR = mkdtempSync(join(tmpdir(), "ccdeck-group-titles-"));
let n = 0;
const fresh = () => join(DIR, `case-${++n}`, "group-titles.json");
const onDisk = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const SID = "0b9a2f7e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const SID2 = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

beforeEach(() => { store.resetGroupTitlesForTest(); route.resetGroupAnnouncedForTest(); });
afterAll(() => { store.resetGroupTitlesForTest(); route.resetGroupAnnouncedForTest(); rmTempDir(DIR); });

describe("a title as it is kept", () => {
  it("cleans a person's title the way a session name is cleaned", () => {
    expect(store.cleanGroupName("  Ship   dark\nmode ")).toBe("Ship dark mode");
    expect(store.cleanGroupName("")).toBeNull();
    expect(store.cleanGroupName(null)).toBeNull();
    expect(store.cleanGroupName(42)).toBeUndefined();
  });

  it("strips the quotes and full stop a model wraps a title in, and cuts a long one at a word", () => {
    expect(store.cleanGoalTitle('"Fix invoice PDF export."')).toBe("Fix invoice PDF export");
    expect(store.cleanGoalTitle("**Ship dark mode settings**")).toBe("Ship dark mode settings");
    const long = "Investigate why the dark mode rollout keeps failing on the settings page for some users";
    const kept = store.cleanGoalTitle(long);
    expect([...kept].length).toBeLessThanOrEqual(store.GOAL_TITLE_MAX);
    expect(long.startsWith(kept)).toBe(true);
    expect(kept.endsWith(" ")).toBe(false);
    expect(store.cleanGoalTitle("   ")).toBeNull();
    expect(store.cleanGoalTitle(undefined)).toBeNull();
  });

  it("is keyed like the deck's session names, and refuses what is not a session", () => {
    expect(store.groupTitleKey("claude", SID)).toBe(`claude:${SID}`);
    expect(store.groupTitleKey(undefined, SID)).toBe(`claude:${SID}`);
    expect(store.groupTitleKey("opencode", SID)).toBeNull();
    expect(store.groupTitleKey("claude", "../../etc/passwd")).toBeNull();
  });
});

describe("the store", () => {
  it("keeps a person's title and the titler's side by side, and a restart reads both back", async () => {
    const path = fresh();
    expect(await store.writeGoalTitle("claude", SID, "Fix invoice PDF export", { path, basis: "abc", now: 1 })).toBe("Fix invoice PDF export");
    expect(await store.writeGroupName("claude", SID, "Billing + invoices", { path, now: 2 })).toBe("Billing + invoices");
    expect(onDisk(path)).toEqual({
      version: 1,
      groups: { [`claude:${SID}`]: { auto: "Fix invoice PDF export", autoAt: 1, basis: "abc", name: "Billing + invoices", nameAt: 2 } },
    });
    // A new process: nothing held until the boot read.
    store.resetGroupTitlesForTest();
    expect(store.groupTitlesFor("claude", SID)).toBeUndefined();
    await store.loadGroupTitles(path);
    expect(store.groupTitlesFor("claude", SID)).toMatchObject({ name: "Billing + invoices", auto: "Fix invoice PDF export", basis: "abc" });
  });

  it("clears a person's title and keeps the automatic one, which is what the board falls back to", async () => {
    const path = fresh();
    await store.writeGoalTitle("claude", SID, "Fix invoice PDF export", { path });
    await store.writeGroupName("claude", SID, "Mine", { path });
    expect(await store.writeGroupName("claude", SID, null, { path })).toBeNull();
    expect(store.groupTitlesFor("claude", SID)).toEqual(expect.objectContaining({ auto: "Fix invoice PDF export" }));
    expect(store.groupTitlesFor("claude", SID).name).toBeUndefined();
  });

  it("drops a group with neither title from the file", async () => {
    const path = fresh();
    await store.writeGroupName("codex", SID, "Mine", { path });
    await store.writeGroupName("codex", SID, null, { path });
    expect(onDisk(path).groups).toEqual({});
  });

  it("reads a file it cannot parse, or one with junk in it, as no titles rather than failing", async () => {
    const path = fresh();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json");
    expect((await store.loadGroupTitles(path)).size).toBe(0);
    store.resetGroupTitlesForTest();
    writeFileSync(path, JSON.stringify({ groups: { "claude:../x": { name: "bad key" }, [`claude:${SID}`]: { name: 7, auto: "Ok title" }, [`codex:${SID2}`]: "junk" } }));
    const held = await store.loadGroupTitles(path);
    expect([...held.keys()]).toEqual([`claude:${SID}`]);
    expect(held.get(`claude:${SID}`)).toEqual({ auto: "Ok title", autoAt: 0 });
  });

  it("keeps the newest GROUP_TITLES_CAP groups", () => {
    const map = new Map();
    for (let i = 0; i < store.GROUP_TITLES_CAP + 5; i++) map.set(`claude:s${i}`, { name: `n${i}`, nameAt: i });
    const kept = store.capGroupTitles(map);
    expect(kept.size).toBe(store.GROUP_TITLES_CAP);
    expect(kept.has("claude:s0")).toBe(false);
    expect(kept.has(`claude:s${store.GROUP_TITLES_CAP + 4}`)).toBe(true);
  });

  it("leaves both the file and memory as they were when a write fails", async () => {
    const path = fresh();
    await store.writeGroupName("claude", SID, "Before", { path });
    const failing = () => Promise.reject(Object.assign(new Error("disk"), { code: "EACCES" }));
    await expect(store.writeGroupName("claude", SID, "After", { path, writeFile: failing })).rejects.toThrow();
    expect(store.groupTitlesFor("claude", SID).name).toBe("Before");
    expect(onDisk(path).groups[`claude:${SID}`].name).toBe("Before");
  });
});

type Answer = { status: number; body: Record<string, unknown> };
async function call(handler: (req: unknown, res: unknown, deps?: unknown) => Promise<void>, body: unknown, deps?: unknown): Promise<Answer> {
  const req = Readable.from([Buffer.from(typeof body === "string" ? body : JSON.stringify(body))]);
  const out = { status: 0, body: null as unknown };
  const res = {
    headersSent: false,
    writeHead(status: number) { out.status = status; },
    end(text: string) { out.body = JSON.parse(text); this.headersSent = true; },
  };
  await handler(req, res, deps);
  return out as Answer;
}

describe("POST /api/group-title", () => {
  it("keeps a person's title and announces it as groupName", async () => {
    const announce = vi.fn();
    const write = vi.fn(async (_p: string, _s: string, name: string | null) => name);
    const out = await call(route.handleGroupTitleWrite, { provider: "claude", sessionId: SID, name: "  Billing retry " }, { write, announce });
    expect(out).toEqual({ status: 200, body: { ok: true, name: "Billing retry" } });
    expect(write).toHaveBeenCalledWith("claude", SID, "Billing retry");
    expect(announce).toHaveBeenCalledWith(SID, { groupName: "Billing retry" });
  });

  it("clears with an empty name or null, announced as groupName: null", async () => {
    const announce = vi.fn();
    const write = vi.fn(async () => null);
    for (const name of ["", null]) {
      const out = await call(route.handleGroupTitleWrite, { sessionId: SID, name }, { write, announce });
      expect(out.body).toEqual({ ok: true, name: null });
    }
    expect(announce).toHaveBeenCalledWith(SID, { groupName: null });
  });

  it("refuses a body that names no session or holds no name, and announces nothing", async () => {
    const announce = vi.fn();
    for (const body of ["nope", { name: "x" }, { sessionId: "../x", name: "x" }, { sessionId: SID, name: 3 }, { provider: "opencode", sessionId: SID, name: "x" }]) {
      const out = await call(route.handleGroupTitleWrite, body, { announce, write: vi.fn() });
      expect(out.status, JSON.stringify(body)).toBe(400);
    }
    expect(announce).not.toHaveBeenCalled();
  });

  it("says not_saved, and announces nothing, when the file cannot be written", async () => {
    const announce = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await call(route.handleGroupTitleWrite, { sessionId: SID, name: "x" }, { announce, write: () => Promise.reject(Object.assign(new Error(), { code: "EACCES" })) });
    spy.mockRestore();
    expect(out).toEqual({ status: 500, body: { ok: false, reason: "not_saved" } });
    expect(announce).not.toHaveBeenCalled();
  });
});

describe("POST /api/group-title/auto", () => {
  it("answers with the run's outcome for one group", async () => {
    const titler = { request: vi.fn(async () => ({ ok: true, title: "Fix billing retry" })), requestAll: vi.fn() };
    const out = await call(route.handleGoalTitleRequest, { provider: "claude", sessionId: SID }, { titler });
    expect(out.body).toEqual({ ok: true, title: "Fix billing retry" });
    expect(titler.request).toHaveBeenCalledWith("claude", SID);
  });

  it("queues every group on the board for { all: true }", async () => {
    const titler = { request: vi.fn(), requestAll: vi.fn(() => ({ ok: true, queued: 2 })) };
    const sessions = () => [{ provider: "claude", sid: SID }, { provider: "codex", sid: SID2 }];
    const out = await call(route.handleGoalTitleRequest, { all: true }, { titler, sessions });
    expect(out.body).toEqual({ ok: true, queued: 2 });
    expect(titler.requestAll).toHaveBeenCalledWith(sessions());
  });

  it("answers unavailable on a deck with no titler, and bad_request for no session", async () => {
    expect((await call(route.handleGoalTitleRequest, { sessionId: SID }, { titler: null })).body).toEqual({ ok: false, reason: "unavailable" });
    expect((await call(route.handleGoalTitleRequest, { sessionId: "../x" }, { titler: { request: vi.fn() } })).status).toBe(400);
  });
});

describe("how a held title reaches the pages", () => {
  it("is told at boot for each session the log replay put back, and not logged again", async () => {
    const path = fresh();
    await store.writeGroupName("claude", SID, "Mine", { path });
    await store.writeGoalTitle("claude", SID2, "Auto one", { path });
    const announce = vi.fn();
    const told = route.announceKeptGroupTitles([{ payload: { session_id: SID } }], announce);
    expect(told).toBe(1);
    expect(announce).toHaveBeenCalledWith(SID, { groupName: "Mine" }, { persist: false });
  });

  it("is told once per run on a session's first live word, again after a Clear, never on a replay", async () => {
    const path = fresh();
    await store.writeGoalTitle("claude", SID, "Auto one", { path });
    const announce = vi.fn();
    const titler = { note: vi.fn() };
    const hook = { hook_event_name: "PreToolUse", session_id: SID };
    route.noteGroupEvent(hook, "hook", { replay: true }, { titler, announce });
    route.noteGroupEvent(hook, "hook", {}, { titler, announce });
    route.noteGroupEvent(hook, "hook", {}, { titler, announce });
    await Promise.resolve();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(SID, { goalTitle: "Auto one" }, { persist: false });
    route.noteGroupEvent({ hook_event_name: "__clear" }, "internal", {}, { titler, announce });
    route.noteGroupEvent(hook, "hook", {}, { titler, announce });
    await Promise.resolve();
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it("hands the titler a session's own events and its transcript naming, not other internal events", () => {
    const titler = { note: vi.fn() };
    const announce = vi.fn();
    route.noteGroupEvent({ hook_event_name: "UserPromptSubmit", session_id: SID, prompt: "x" }, "hook", {}, { titler, announce });
    route.noteGroupEvent({ hook_event_name: "SessionNamed", session_id: SID, sessionTitle: "t" }, "internal", {}, { titler, announce });
    route.noteGroupEvent({ hook_event_name: "ModelObserved", session_id: SID }, "internal", {}, { titler, announce });
    route.noteGroupEvent({ hook_event_name: "UserPromptSubmit", session_id: SID, provider: "opencode" }, "hook", {}, { titler, announce });
    expect(titler.note).toHaveBeenCalledTimes(2);
    expect(titler.note.mock.calls.map(c => c[1])).toEqual(["claude", "claude"]);
  });
});
