// AGENTS_DECK_NO_CODEX=1: --no-codex in the form a login item keeps. What is
// pinned here is the reach of that switch past the board: the login item
// carries it, and a paired deck gets no Codex login from a deck without Codex.
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
// @ts-expect-error — plain .mjs server module, no types
import { createServe } from "../../server/lan-serve.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { transferChallenge } from "../../server/lan-sync.mjs";
// @ts-expect-error — plain .mjs server module, no types
import { SETTING_VARS } from "../../server/login-service.mjs";

const ME = "fp-me";
const PEER = "fp-peer";
const CODEX = "codex:a@x|ws-1";

describe("a deck without Codex", () => {
  it("keeps the switch across a start at login", () => {
    expect(SETTING_VARS).toContain("AGENTS_DECK_NO_CODEX");
  });

  it("gives a paired deck none of its Codex logins, and never exports one", async () => {
    const exported: string[] = [];
    const { serve } = createServe({
      settings: () => ({ enabled: true, trusted: [{ fp: PEER }], shared: [CODEX] }),
      serverNow: () => ({}),
      myFp: () => ME,
      inbound: { spoke: () => {} },
      learnCaller: () => {},
      keepManifest: () => {},
      manifestFrame: () => ({ t: "manifest" }),
      localAccounts: async () => [],
      // The engine's localCodex on a deck whose Codex is off: null, not a list.
      localCodex: async () => null,
      exportCodex: async (_num: number, key: string) => { exported.push(key); return "blob"; },
      exportAccount: async () => null,
      onError: () => {},
    });
    const key = randomBytes(32);
    const sent: Array<Record<string, unknown>> = [];
    const nonce = randomBytes(12).toString("hex");
    const want = { t: "want", key: CODEX, nonce, proof: transferChallenge(key, { nonce, accountKey: CODEX, fromFp: PEER, toFp: ME }) };
    await serve(want, { peerFp: PEER, peerAddr: "100.97.147.63", key, send: (f: Record<string, unknown>) => { sent.push(f); } });
    expect(sent.at(-1)).toEqual({ t: "no", why: "not mine to give" });
    expect(exported).toEqual([]);
  });
});
