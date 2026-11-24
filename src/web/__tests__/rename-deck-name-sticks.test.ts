// A rename typed in the deck is kept even when Claude's own title cannot be
// written (the route used to answer 409 and keep nothing). These pin the rule
// for the best-effort half: which refusals are asked again, how often, and what
// the page is told.
import { describe, expect, it } from "vitest";
import { saveSessionName } from "../session-rename";

// @ts-expect-error — .mjs server module, no types
const { syncProviderName, MID_WRITE_RETRY_MS } = await import("../../server/session-name-route.mjs");

const refusal = (reason: string) => Object.assign(new Error("provider_name_not_saved"), { code: "provider_name_not_saved", reason });

function provider(script: (string | null)[]) {
  const calls: unknown[][] = [];
  const fn = async (...args: unknown[]) => {
    calls.push(args);
    const next = script[calls.length - 1] ?? null;
    if (next === "ENOENT") throw Object.assign(new Error("gone"), { code: "ENOENT" });
    if (next) throw refusal(next);
  };
  return { fn, calls };
}

const noWait = { sleep: async () => {} };

describe("Claude's own title, written after the deck's name", () => {
  it("asks again only while the transcript is mid-line, and twice at most", async () => {
    expect(MID_WRITE_RETRY_MS).toHaveLength(2);
    const settles = provider(["mid_write", "mid_write", null]);
    expect(await syncProviderName(settles.fn, "claude", "sid", "Name", noWait)).toEqual({ synced: true });
    expect(settles.calls).toHaveLength(3);

    const never = provider(["mid_write", "mid_write", "mid_write", null]);
    expect(await syncProviderName(never.fn, "claude", "sid", "Name", noWait)).toEqual({ synced: false, reason: "mid_write" });
    expect(never.calls).toHaveLength(3);
  });

  it("gives up at once for a reason waiting cannot change", async () => {
    for (const reason of ["no_transcript", "ambiguous", "not_plain_file", "not_owner"]) {
      const p = provider([reason]);
      expect(await syncProviderName(p.fn, "claude", "sid", "Name", noWait)).toEqual({ synced: false, reason });
      expect(p.calls).toHaveLength(1);
    }
    expect(await syncProviderName(provider(["ENOENT"]).fn, "claude", "sid", "Name", noWait)).toEqual({ synced: false, reason: "no_transcript" });
  });

  it("waits the stated pauses between tries", async () => {
    const waited: number[] = [];
    await syncProviderName(provider(["mid_write", "mid_write", "mid_write"]).fn, "claude", "sid", "Name", { sleep: async (ms: number) => { waited.push(ms); } });
    expect(waited).toEqual([...MID_WRITE_RETRY_MS]);
  });
});

describe("what the page is told", () => {
  const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("is a save, with providerSynced false, when only the deck kept the name", async () => {
    expect(await saveSessionName({ provider: "claude", sessionId: "s" }, "Mine", answer({ ok: true, name: "Mine", providerSynced: false, reason: "no_transcript" })))
      .toEqual({ ok: true, name: "Mine", providerSynced: false });
    expect(await saveSessionName({ provider: "claude", sessionId: "s" }, "Mine", answer({ ok: true, name: "Mine", providerSynced: true })))
      .toEqual({ ok: true, name: "Mine", providerSynced: true });
    expect(await saveSessionName({ provider: "claude", sessionId: "s" }, null, answer({ ok: true, name: null })))
      .toEqual({ ok: true, name: null });
  });

  it("is still a failure when the deck kept nothing", async () => {
    expect(await saveSessionName({ provider: "claude", sessionId: "s" }, "Mine", answer({ ok: false, reason: "not_saved" }, 500))).toEqual({ ok: false });
  });
});
