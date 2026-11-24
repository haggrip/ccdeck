// A paired deck's sessions on this deck's board, read-only (lan-sessions.mjs).
//
// Pinned here: the switch is off until the owner turns it on, and the machine
// can hold it off; what goes out is a whitelist — no prompt, question, tool
// input or path, whatever summarizeSessions held; it is answered only to a
// deck that finished the handshake and was accepted, only while sharing is on,
// and only to a tailnet address on a deck held to the tailnet; the asking deck
// keeps the rows in memory and drops them when the other deck stops sharing,
// is unpaired or goes quiet; and the rows the page draws are not controls.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomBytes } from "node:crypto";
// @ts-expect-error — plain .mjs server module, no types
import { DEFAULTS, lanSessionsVetoed, normalise, pagePatch } from "../../server/deck-prefs.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { lanApplyFields } from "../../server/lan-deck.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { createRemoteSessions, MAX_SHARED_SESSIONS, shareRows } from "../../server/lan-sessions.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { createServe } from "../../server/lan-serve.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { REMOTE_SESSIONS_STALE_MS } from "../../server/lan-engine.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { summarizeSessions } from "../../server/session-summary.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { SETTING_VARS } from "../../server/login-service.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { GUARDED_READS } from "../../server/request-gates.mjs";
import { announce, rigDeck, stopAll } from "./lan-engine-rig";

vi.mock("react-dom", async (orig) => ({ ...(await orig<typeof import("react-dom")>()), createPortal: (node: unknown) => node }));
const { default: RemoteSessionRows } = await import("../components/RemoteSessionRows");
const { default: LanSetupModal } = await import("../components/LanSetupModal");
const { readRemoteMachines, remoteWaitingCount } = await import("../remote-sessions");

afterEach(stopAll);

// ── what a session holds that must never leave ──────────────────────────────
const SECRET_PROMPT = "deploy the thing with token sk-live-PROMPT-SECRET";
const SECRET_QUESTION = "May I run rm -rf /home/hagai/QUESTION-SECRET?";
const SECRET_CWD = "/Users/hagai/very/private/CWD-SECRET/ccdeck-dev";
const SECRET_TOOL_INPUT = "cat /etc/TOOL-SECRET";
const SECRETS = [SECRET_PROMPT, SECRET_QUESTION, "CWD-SECRET", "/Users/hagai", "TOOL-SECRET", "PROMPT-SECRET", "QUESTION-SECRET"];

function ring(t: number) {
  let seq = 0;
  const env = (dt: number, payload: Record<string, unknown>) => ({ seq: ++seq, receivedAt: t + dt, payload });
  return [
    env(0, { hook_event_name: "SessionStart", session_id: "s-wait", cwd: SECRET_CWD }),
    env(1, { hook_event_name: "UserPromptSubmit", session_id: "s-wait", cwd: SECRET_CWD, prompt: SECRET_PROMPT }),
    env(2, { hook_event_name: "PreToolUse", session_id: "s-wait", tool_use_id: "tu1", tool_name: "Bash", tool_input: { command: SECRET_TOOL_INPUT } }),
    env(3, { hook_event_name: "Notification", session_id: "s-wait", notification_type: "permission_prompt", message: SECRET_QUESTION }),
    env(4, { hook_event_name: "SessionNamed", session_id: "s-wait", sessionTitle: "Fix the build" }),
    env(5, { hook_event_name: "UserPromptSubmit", session_id: "s-work", cwd: "/srv/other/api", prompt: SECRET_PROMPT }),
  ];
}

const noLeak = (value: unknown) => {
  const s = JSON.stringify(value);
  for (const secret of SECRETS) expect(s, secret).not.toContain(secret);
};

describe("the switch", () => {
  it("is off by default and only a real true turns it on", () => {
    expect(DEFAULTS.lan.shareSessions).toBe(false);
    expect(normalise({}).lan.shareSessions).toBe(false);
    expect(normalise({ lan: { shareSessions: true } }).lan.shareSessions).toBe(true);
    expect(normalise({ lan: { shareSessions: "yes" } }).lan.shareSessions).toBe(false);
    expect(normalise({ lan: { shareSessions: 1 } }).lan.shareSessions).toBe(false);
  });

  it("is the page's to write, and the machine can hold it off", () => {
    expect(pagePatch({ lan: { shareSessions: true } })).toEqual({ lan: { shareSessions: true } });
    expect(lanSessionsVetoed({})).toBe(false);
    expect(lanSessionsVetoed({ AGENTS_DECK_NO_LAN_SESSIONS: "1" })).toBe(true);
    const on = { lan: { shareSessions: true } };
    expect(lanApplyFields(on, { env: {} })).toMatchObject({ shareSessions: true, sessionsVetoed: false });
    expect(lanApplyFields(on, { env: { AGENTS_DECK_NO_LAN_SESSIONS: "1" } })).toMatchObject({ sessionsVetoed: true });
    expect(lanApplyFields({}, { env: {} })).toMatchObject({ shareSessions: false });
  });

  it("is carried by a deck started at login, and its route is a guarded read", () => {
    expect(SETTING_VARS).toContain("AGENTS_DECK_NO_LAN_SESSIONS");
    expect(GUARDED_READS.has("/api/lan/remote-sessions")).toBe(true);
  });
});

describe("what goes out", () => {
  it("is the whitelist, built from summarizeSessions, with no prompt, question, tool input or path", () => {
    const t = Date.now() - 60_000;
    const rows = summarizeSessions(ring(t), { now: t + 10 });
    // The fold itself holds the secrets; the answer must not.
    expect(JSON.stringify(rows)).toContain("CWD-SECRET");
    expect(JSON.stringify(rows)).toContain("QUESTION-SECRET");
    const out = shareRows(rows);
    noLeak(out);
    expect(out).toHaveLength(2);
    for (const r of out) {
      expect(Object.keys(r).sort()).toEqual(["id", "lastEventAt", "name", "project", "provider", "since", "state", "waiting"]);
    }
    const wait = out.find((r: { id: string }) => r.id === "s-wait");
    expect(wait).toMatchObject({ name: "Fix the build", project: "ccdeck-dev", state: "waiting", waiting: "permission", provider: "claude" });
    expect(out.find((r: { id: string }) => r.id === "s-work")).toMatchObject({ project: "api", state: "working", waiting: null });
  });

  it("is cut to a folder name even when a row's project is itself a path, and to the field caps", () => {
    const [r] = shareRows([{
      id: "x".repeat(500), name: "n".repeat(500), project: "/home/someone/secret-place/proj", cwd: SECRET_CWD,
      state: "bogus", waiting: { kind: "asked", message: SECRET_QUESTION, tool: "Bash" }, prompt: SECRET_PROMPT,
    }]);
    noLeak(r);
    expect(r.project).toBe("proj");
    expect(r.id.length).toBe(128);
    expect(r.name.length).toBe(120);
    expect(r.state).toBe("idle");
    expect(r.waiting).toBe("asked");
  });

  it("is capped in count and in bytes", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, state: "idle" }));
    expect(shareRows(many)).toHaveLength(MAX_SHARED_SESSIONS);
    const fat = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}-${"i".repeat(120)}`, name: "n".repeat(120), project: "p".repeat(80) }));
    expect(Buffer.byteLength(JSON.stringify(shareRows(fat)))).toBeLessThanOrEqual(48 * 1024 + 2);
  });
});

describe("who is answered", () => {
  const PEER = "fp-peer";
  function rig(over: { cfg?: Record<string, unknown>; mayTalkTo?: (a: string) => boolean } = {}) {
    const st = { cfg: { enabled: true, trusted: [{ fp: PEER }], shared: [], shareSessions: true, ...(over.cfg ?? {}) } };
    const { serve } = createServe({
      settings: () => st.cfg, serverNow: () => ({}), myFp: () => "fp-me",
      inbound: { spoke() {} }, learnCaller() {}, keepManifest() {}, manifestFrame: () => ({}),
      localAccounts: async () => [], liveLogin: null, exportAccount: async () => null,
      localSessions: async () => summarizeSessions(ring(Date.now() - 1_000)),
      mayTalkTo: over.mayTalkTo ?? (() => true),
      onError() {},
    });
    const sent: Array<Record<string, unknown>> = [];
    const ctx = { peerFp: PEER, peerAddr: "100.97.1.2", key: randomBytes(32), send: (f: Record<string, unknown>) => { sent.push(f); } };
    return { st, ask: async (fp = PEER) => { await serve({ t: "sessions" }, { ...ctx, peerFp: fp }); return sent.at(-1)!; } };
  }

  it("a paired deck, while sharing is on, with the whitelist and nothing else", async () => {
    const got = await rig().ask();
    expect(got.t).toBe("sessions");
    expect(Array.isArray(got.rows)).toBe(true);
    expect((got.rows as unknown[]).length).toBe(2);
    noLeak(got);
  });

  it("nobody who is not paired (accepted), and nobody while the deck is off", async () => {
    expect(await rig().ask("fp-stranger")).toEqual({ t: "no", why: "not paired" });
    expect(await rig({ cfg: { trusted: [] } }).ask()).toEqual({ t: "no", why: "not paired" });
    expect(await rig({ cfg: { enabled: false } }).ask()).toEqual({ t: "no", why: "not paired" });
  });

  it("nobody while sharing is off, or vetoed by the machine", async () => {
    expect(await rig({ cfg: { shareSessions: false } }).ask()).toEqual({ t: "no", why: "not shared" });
    expect(await rig({ cfg: { shareSessions: undefined } }).ask()).toEqual({ t: "no", why: "not shared" });
    expect(await rig({ cfg: { sessionsVetoed: true } }).ask()).toEqual({ t: "no", why: "not shared" });
  });

  it("nobody at an address the tailnet rule refuses", async () => {
    expect(await rig({ mayTalkTo: () => false }).ask()).toEqual({ t: "no", why: "not shared" });
  });
});

describe("the asking side's memory", () => {
  it("drops a deck that went quiet, one unpaired, and one that stopped sharing", () => {
    let t = 1_000_000;
    const changes: number[] = [];
    const mem = createRemoteSessions({ now: () => t, staleMs: 1_000, onChange: () => changes.push(t) });
    mem.keep("a", [{ id: "s1", state: "working", prompt: SECRET_PROMPT }]);
    mem.keep("b", [{ id: "s2" }]);
    noLeak(mem.list());
    expect(mem.list().map((m: { fp: string }) => m.fp)).toEqual(["a", "b"]);
    expect(mem.list({ isPaired: (fp: string) => fp !== "b" }).map((m: { fp: string }) => m.fp)).toEqual(["a"]);
    mem.drop("a");
    expect(mem.list()).toEqual([]);
    mem.keep("c", []);
    t += 1_001;
    expect(mem.list()).toEqual([]);
    expect(changes.length).toBe(4);
  });
});

describe("two decks on loopback", () => {
  const SHIPPED = { autoAsk: true, autoAccept: true, pairingMode: "automatic" };

  async function pair(shareA: boolean) {
    const skew = { ms: 0 };
    const now = () => Date.now() + skew.ms;
    const t = Date.now() - 60_000;
    const a = await rigDeck("Thinkpad", {
      settings: { ...SHIPPED, shareSessions: shareA },
      deps: { now, sessions: () => summarizeSessions(ring(t), { now: t + 10 }) },
    });
    const b = await rigDeck("Mac", { settings: SHIPPED, deps: { now, sessions: () => [] } });
    announce(a, { fp: b.id.fp, port: b.port, name: "Mac" });
    announce(b, { fp: a.id.fp, port: a.port, name: "Thinkpad" });
    for (let i = 0; i < 3; i++) { await a.e.round(); await b.e.round(); }
    return { a, b, skew };
  }

  it("show the sharing deck's sessions on the other, under its name, whitelisted", async () => {
    const { a, b } = await pair(true);
    const seen = b.e.remoteSessions();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ fp: a.id.fp, name: "Thinkpad", via: "lan" });
    expect(seen[0].sessions.map((s: { id: string }) => s.id).sort()).toEqual(["s-wait", "s-work"]);
    noLeak(seen);
    // The deck that does not share is not shown on the one that does.
    expect(a.e.remoteSessions()).toEqual([]);
    expect(a.e.status()).toMatchObject({ shareSessions: true });
    expect(b.e.status()).toMatchObject({ shareSessions: false });
  }, 30_000);

  it("show nothing while the deck has not turned sharing on", async () => {
    const { b } = await pair(false);
    expect(b.e.remoteSessions()).toEqual([]);
  }, 30_000);

  it("drop them when that deck turns sharing off, at the next round", async () => {
    const { a, b } = await pair(true);
    expect(b.e.remoteSessions()).toHaveLength(1);
    await a.e.apply({ shareSessions: false });
    await b.e.round();
    expect(b.e.remoteSessions()).toEqual([]);
  }, 30_000);

  it("drop them at once on unpair", async () => {
    const { a, b } = await pair(true);
    expect(b.e.unpair(a.id.fp)).toBe(true);
    expect(b.e.remoteSessions()).toEqual([]);
  }, 30_000);

  it("drop them when the deck has not answered for a few rounds", async () => {
    const { b, skew } = await pair(true);
    expect(b.e.remoteSessions()).toHaveLength(1);
    skew.ms = REMOTE_SESSIONS_STALE_MS + 1_000;
    expect(b.e.remoteSessions()).toEqual([]);
  }, 30_000);
});

describe("on the page", () => {
  beforeAll(() => { vi.stubGlobal("document", { body: null }); });
  afterAll(() => { vi.unstubAllGlobals(); });

  const machines = readRemoteMachines({
    ok: true,
    machines: [{
      fp: "fp-t", name: "hagai-thinkpad", via: "tailscale", at: 1,
      sessions: [
        { id: "s1", name: "Fix the build", project: "ccdeck", state: "waiting", waiting: "permission", since: 1_000 },
        { id: "s2", name: null, project: "api", state: "working", since: 2_000 },
        { id: "s3", name: "old", project: "x", state: "ended", since: 3_000 },
        // A row a misbehaving deck sent with more than the whitelist.
        { id: "s4", name: "chat", state: "idle", prompt: SECRET_PROMPT, cwd: SECRET_CWD, waiting: { message: SECRET_QUESTION } },
      ],
    }],
  })!;

  it("are read-only rows under the machine's name, marked as another machine", () => {
    const html = renderToStaticMarkup(createElement(RemoteSessionRows, { machines, now: 60_000 }));
    expect(html).toContain("hagai-thinkpad");
    expect(html).toContain("other machine");
    expect(html).toContain("Fix the build");
    expect(html).toContain("waiting for permission");
    expect(html).toContain("1 ended");
    // No control of any kind: nothing to press, type into, link to or focus.
    expect(html).not.toMatch(/<(button|a|input|textarea|select)\b/);
    expect(html).not.toMatch(/tabindex|onclick|role="button"/i);
    noLeak(html);
  });

  it("count the remote sessions waiting on somebody", () => {
    expect(remoteWaitingCount(machines)).toBe(1);
  });

  it("the settings switch is off by default, and held off when the machine vetoed it", () => {
    const draw = (extra: Record<string, unknown>) => renderToStaticMarkup(createElement(LanSetupModal, {
      status: {
        enabled: true, running: true, name: "Mac", fp: "abcd", port: 1, pairingMode: "automatic", autoAsk: true,
        autoAccept: true, addrs: [], shared: [], peers: [], trusted: [], invite: null, pending: [], strangers: [], ...extra,
      } as never,
      accounts: [], onClose: () => {}, onChanged: () => {},
    }));
    const sw = (html: string) => /<button[^>]*role="switch"[^>]*aria-label="Share my sessions with paired decks"[^>]*>/.exec(html)?.[0] ?? "";
    expect(sw(draw({}))).toContain('aria-checked="false"');
    const on = draw({ shareSessions: true });
    expect(sw(on)).toContain('aria-checked="true"');
    expect(on).toContain("never a prompt, a question");
    const vetoed = draw({ shareSessions: true, sessionsVetoed: true });
    expect(sw(vetoed)).toContain('aria-checked="false"');
    expect(sw(vetoed)).toContain("disabled");
    expect(vetoed).toContain("AGENTS_DECK_NO_LAN_SESSIONS=1");
  });
});
