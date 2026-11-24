// A new session on a paired deck (lan-control.mjs `start`): the one command
// that makes a session rather than acting on one. Pinned here: it takes only a
// folder, as a path; the deck it runs on checks that folder as its own panel's
// picker does and launches Claude Code there through its Command Panel's
// engine — Claude, no options, a launch key — noted in the panel's record
// first; it is held to a tighter rate than the other commands; it is logged
// with the folder and the session it made; and the asking page offers it under
// a machine that takes commands, even one with no sessions yet.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// @ts-expect-error — plain .mjs server module, no types
import { checkCommand, createControlLog, createRateLimit, keyFrames, MAX_FOLDER, RATE, START_RATE, stateRefuses } from "../../server/lan-control.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { createLocalControl, expandHome } from "../../server/lan-control-local.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { createServe } from "../../server/lan-serve.mjs";
import { announce, rigDeck, stopAll } from "./lan-engine-rig";

afterEach(stopAll);

const NEW_SID = "7e2a0f6e-2b3a-4c5d-9e8f-0000000000aa";

describe("the command", () => {
  it("takes a folder as a path and an optional launch key, and nothing else", () => {
    expect(checkCommand({ action: "start", cwd: " /home/hagai/saas-platform ", sid: "x", text: "rm -rf /", options: { permissionMode: "bypassPermissions" } }))
      .toEqual({ ok: true, command: { action: "start", cwd: "/home/hagai/saas-platform" } });
    expect(checkCommand({ action: "start", cwd: "~/ccdeck", key: "lan-abc_123" }))
      .toEqual({ ok: true, command: { action: "start", cwd: "~/ccdeck", key: "lan-abc_123" } });
    expect(checkCommand({ action: "start", cwd: "~" })).toEqual({ ok: true, command: { action: "start", cwd: "~" } });
  });

  it("refuses a folder that is not a path: relative, empty, with control bytes, too long, or a key that is not one", () => {
    for (const raw of [
      { action: "start" },
      { action: "start", cwd: "" },
      { action: "start", cwd: "projects/api" },
      { action: "start", cwd: "~other/x" },
      { action: "start", cwd: "/tmp/a\nb" },
      { action: "start", cwd: "/tmp/\u001b[2J" },
      { action: "start", cwd: `/${"a".repeat(MAX_FOLDER)}` },
      { action: "start", cwd: 42 },
      { action: "start", cwd: "/tmp", key: "../../x" },
      { action: "start", cwd: "/tmp", key: 7 },
    ]) expect(checkCommand(raw).ok, JSON.stringify(raw)).toBe(false);
  });

  it("needs no session, and types nothing", () => {
    expect(stateRefuses({ action: "start", cwd: "/tmp" }, undefined)).toBeNull();
    expect(keyFrames({ action: "start", cwd: "/tmp" })).toEqual([]);
  });

  it("expands ~ under the deck's own home, and nothing else", () => {
    expect(expandHome("~", "/home/h")).toBe("/home/h");
    expect(expandHome("~/a/b", "/home/h")).toBe("/home/h/a/b");
    expect(expandHome("/srv/x", "/home/h")).toBe("/srv/x");
  });
});

describe("carrying it out here", () => {
  function local({ folder = { ok: true, cwd: "/home/h/api" }, answer = { status: 200, body: { ok: true, sessionId: NEW_SID, name: "ccdeck-claude-1", ticket: null }, handle: "b".repeat(64) }, enabled = true } = {}) {
    const order: string[] = [];
    const asked: Array<{ method: string; body: Record<string, unknown> }> = [];
    const checked: string[] = [];
    const engine = {
      enabled,
      route: async (method: string, body: Record<string, unknown>) => { order.push(`engine:${method}`); asked.push({ method, body }); return answer; },
      type: async () => ({ ok: true }),
    };
    const provenance = {
      started: (method: string) => { order.push(`started:${method}`); return "ref-1"; },
      answered: (method: string, _q: unknown, ref: unknown, status: number) => { order.push(`answered:${method}:${ref}:${status}`); },
    };
    const run = createLocalControl({
      rows: () => [], engine: async () => engine, home: "/home/h",
      checkFolder: async (p: string) => { checked.push(p); return folder; },
      provenance: async () => provenance,
    });
    return { run, asked, checked, order };
  }

  it("launches Claude Code in the checked folder through the panel's engine, noted in its record first", async () => {
    const { run, asked, checked, order } = local();
    expect(await run({ action: "start", cwd: "~/api", key: "lan-k1" })).toEqual({ ok: true, sid: NEW_SID });
    expect(checked).toEqual(["/home/h/api"]);
    // Claude, the folder the check answered, the key — and no options: Claude
    // Code's own default model and permission mode.
    expect(asked).toEqual([{ method: "launch", body: { agent: "claude", cwd: "/home/h/api", key: "lan-k1" } }]);
    expect(order).toEqual(["started:launch", "engine:launch", "answered:launch:ref-1:200"]);
  });

  it("makes its own launch key when none came", async () => {
    const { run, asked } = local();
    await run({ action: "start", cwd: "/home/h/api" });
    expect(asked[0].body.key).toMatch(/^lan-[0-9a-f]{18}$/);
  });

  it("refuses a folder the check refuses, before the engine is asked anything", async () => {
    const { run, asked, order } = local({ folder: { ok: false, code: "missing" } as never });
    expect(await run({ action: "start", cwd: "/nope" })).toEqual({ ok: false, why: "folder missing" });
    expect(asked).toEqual([]);
    expect(order).toEqual([]);
  });

  it("refuses with no Command Panel, and says what the engine refused", async () => {
    expect(await local({ enabled: false }).run({ action: "start", cwd: "/home/h/api" })).toEqual({ ok: false, why: "no command panel" });
    const refused = local({ answer: { status: 409, body: { ok: false, code: "no-tmux" } } as never });
    expect(await refused.run({ action: "start", cwd: "/home/h/api" })).toEqual({ ok: false, why: "launch no-tmux" });
    const none = createLocalControl({ rows: () => [], engine: async () => null, checkFolder: async () => ({ ok: true, cwd: "/x" }) });
    expect(await none({ action: "start", cwd: "/x" })).toEqual({ ok: false, why: "no command panel" });
  });
});

describe("the frame, at the deck that runs it", () => {
  const PEER = "fp-mac";
  function rig() {
    const ran: unknown[] = [];
    const log = createControlLog();
    const { serve } = createServe({
      settings: () => ({ enabled: true, trusted: [{ fp: PEER, name: "Mac" }], acceptControl: true }),
      serverNow: () => ({}), myFp: () => "fp-pad",
      inbound: { spoke() {} }, learnCaller() {}, keepManifest() {}, manifestFrame: () => ({}),
      localAccounts: async () => [], liveLogin: null, exportAccount: async () => null, onError() {},
      localControl: async (c: { action: string }) => { ran.push(c); return c.action === "start" ? { ok: true, sid: NEW_SID } : { ok: true }; },
      controlFrom: () => true, controlLimit: createRateLimit(), startLimit: createRateLimit({ rate: START_RATE }), controlLog: log,
    });
    const ask = async (command: unknown) => {
      let got: Record<string, unknown> | null = null;
      await serve({ t: "control", command }, { peerFp: PEER, peerAddr: "100.86.23.45", peerName: "?", key: "k", send: (f: Record<string, unknown>) => { got = f; } });
      return got;
    };
    return { ask, ran, log };
  }

  it("answers the new session's id, and logs the folder and the session", async () => {
    const { ask, log } = rig();
    expect(await ask({ action: "start", cwd: "/home/h/api" })).toEqual({ t: "control", ok: true, sid: NEW_SID });
    expect(log.list().at(-1)).toMatchObject({ action: "start", cwd: "/home/h/api", sid: NEW_SID, ok: true, from: "Mac" });
  });

  it("holds a deck to one new session at a time, more tightly than its other commands", async () => {
    expect(START_RATE.burst).toBeLessThan(RATE.burst);
    const { ask, ran } = rig();
    expect((await ask({ action: "start", cwd: "/a" }))?.ok).toBe(true);
    expect(await ask({ action: "start", cwd: "/b" })).toEqual({ t: "control", ok: false, why: "too many" });
    // The other commands still have their own room.
    expect((await ask({ action: "interrupt", sid: "s-1" }))?.ok).toBe(true);
    expect(ran).toHaveLength(2);
  });
});

describe("two decks on loopback", () => {
  it("start a session on the other deck and hear its id", async () => {
    const ran: unknown[] = [];
    const a = await rigDeck("Thinkpad", {
      settings: { autoAsk: true, autoAccept: true, pairingMode: "automatic", shareSessions: true, acceptControl: true },
      deps: {
        sessions: () => [],
        control: async (c: unknown) => { ran.push(c); return { ok: true, sid: NEW_SID }; },
        controlFrom: (addr: string) => addr.replace(/^::ffff:/, "") === "127.0.0.1",
      },
    });
    const b = await rigDeck("Mac", { settings: { autoAsk: true, autoAccept: true, pairingMode: "automatic", shareSessions: true }, deps: { sessions: () => [] } });
    announce(a, { fp: b.id.fp, port: b.port, name: "Mac" });
    announce(b, { fp: a.id.fp, port: a.port, name: "Thinkpad" });
    for (let i = 0; i < 3; i++) { await a.e.round(); await b.e.round(); }
    expect(await b.e.controlPeer(a.id.fp, { action: "start", cwd: "~/api", key: "lan-k2" })).toEqual({ ok: true, sid: NEW_SID });
    expect(ran).toEqual([{ action: "start", cwd: "~/api", key: "lan-k2" }]);
  }, 30_000);
});

describe("on the asking deck's page", () => {
  beforeAll(() => { vi.stubGlobal("document", { body: null }); });
  afterAll(() => { vi.unstubAllGlobals(); });

  const machine = (control: boolean) => ({ fp: "fp-pad", name: "hagai-thinkpad", via: "tailscale" as const, at: 1, control, sessions: [] });

  it("shows a machine that takes commands even with no sessions, with a New session row; one that does not stays hidden", async () => {
    const { default: RemoteSessionRows } = await import("../components/RemoteSessionRows");
    expect(renderToStaticMarkup(createElement(RemoteSessionRows, { machines: [machine(false)], now: 10 }))).toBe("");
    const on = renderToStaticMarkup(createElement(RemoteSessionRows, { machines: [machine(true)], now: 10 }));
    expect(on).toContain("hagai-thinkpad");
    expect(on).toContain('data-remote-start="fp-pad"');
    expect(on).toContain(">New session<");
    expect(on).toContain('aria-label="Folder on hagai-thinkpad to start Claude Code in"');
  });

  it("posts a start with the folder and a launch key, and no session id", async () => {
    const { sendControl } = await import("../components/RemoteSessionControl");
    const { startKey } = await import("../components/RemoteSessionStart");
    expect(startKey()).toMatch(/^lan-[0-9a-f]{18}$/);
    let sent: unknown = null;
    const fake = (async (_url: string, init: { body: string }) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true, sid: NEW_SID })); }) as unknown as typeof fetch;
    expect(await sendControl("fp-pad", "", "start", { cwd: "~/api", key: "lan-k3" }, fake)).toEqual({ ok: true, sid: NEW_SID });
    expect(sent).toEqual({ fp: "fp-pad", action: "start", cwd: "~/api", key: "lan-k3" });
  });
});
