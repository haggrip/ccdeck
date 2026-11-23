// The board's half of group titles: a SessionNamed carrying `groupName` and
// `goalTitle` lands on the session root, the cluster pill leads with the goal
// and keeps the folder after it, a person's title wins over the titler's, the
// rename field gets the facts it needs, and a board card offers its pencil.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "reactflow";
import { applyEvent, initialState } from "../reducer";
import { clusterBounds, shallowEqualClusters, type ClusterNode } from "../cluster-bounds";
import { clusterHeader, SEP } from "../cluster-header";
import { groupRenameFacts, requestGoalTitle, saveGroupName, goalTitleReasonKey } from "../group-rename";
import { saveAsk } from "../session-rename";
import AgentNode from "../components/AgentNode";
import { onCardRename, requestCardRename } from "../card-rename";
import { ownsKeystroke } from "../shortcuts";
import { en } from "../i18n/en";
import type { AgentNodeData, HookEnvelope, HookPayload } from "../types";

const SESSION = "0b9a2f7e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
let seq = 0;
const envelope = (payload: HookPayload): HookEnvelope => ({ seq: ++seq, receivedAt: Date.now(), source: "hook", payload });
const rooted = () => applyEvent(initialState(), envelope({ hook_event_name: "SessionStart", session_id: SESSION, cwd: "/dev/web-app" }));
const named = (s: ReturnType<typeof rooted>, fields: Partial<HookPayload>) =>
  applyEvent(s, envelope({ hook_event_name: "SessionNamed", session_id: SESSION, ...fields } as HookPayload));

describe("SessionNamed with a group's titles", () => {
  it("stamps the person's title and the titler's on the root", () => {
    const s = named(rooted(), { groupName: "Billing + invoices", goalTitle: "Fix billing retry loop" });
    const root = s.agents.get(SESSION)!;
    expect(root.groupName).toBe("Billing + invoices");
    expect(root.goalTitle).toBe("Fix billing retry loop");
  });

  it("clears one with null and leaves the other, and a transcript pass touches neither", () => {
    let s = named(rooted(), { groupName: "Mine", goalTitle: "Auto" });
    s = named(s, { sessionTitle: "Inspect repository" });
    expect(s.agents.get(SESSION)).toMatchObject({ groupName: "Mine", goalTitle: "Auto" });
    s = named(s, { groupName: null });
    expect(s.agents.get(SESSION)!.groupName).toBeUndefined();
    expect(s.agents.get(SESSION)!.goalTitle).toBe("Auto");
  });

  it("waits for a session that has no card yet, and lands when it does", () => {
    let s = applyEvent(initialState(), envelope({ hook_event_name: "SessionNamed", session_id: SESSION, goalTitle: "Early title" } as HookPayload));
    s = applyEvent(s, envelope({ hook_event_name: "SessionStart", session_id: SESSION, cwd: "/dev/x" }));
    expect(s.agents.get(SESSION)?.goalTitle).toBe("Early title");
  });
});

describe("the pill", () => {
  it("leads with the goal and keeps the folder after it, in the tooltip too", () => {
    const h = clusterHeader("web-app", "Dark mode cleanup", SESSION, [], { goalTitle: "Ship dark mode settings" });
    expect(h.label).toBe("Ship dark mode settings");
    expect(h.folder).toBe("web-app");
    expect(h.goalBy).toBe("auto");
    expect(h.fullLabel).toBe(`Ship dark mode settings${SEP}web-app${SEP}Dark mode cleanup`);
    expect(h.title.split("\n")[0]).toBe(h.fullLabel);
  });

  it("lets a person's title win over the titler's", () => {
    const h = clusterHeader("web-app", undefined, SESSION, [], { groupName: "Billing + invoices", goalTitle: "Fix billing retry loop" });
    expect(h.label).toBe("Billing + invoices");
    expect(h.goalBy).toBe("person");
  });

  it("reads exactly as before with no goal title: the folder leads and no folder field", () => {
    const before = clusterHeader("web-app", "CSV export", SESSION, []);
    expect(before.label).toBe("web-app");
    expect(before.folder).toBeUndefined();
    expect(before.goalBy).toBeUndefined();
    expect(before.fullLabel).toBe(`web-app${SEP}CSV export`);
  });

  it("drops a session name that only repeats the goal", () => {
    const h = clusterHeader("scratch-2026-11-12-e1d41a", "Fix billing retry loop", SESSION, [], { goalTitle: "Fix billing retry loop" });
    expect(h.name).toBeUndefined();
  });

  it("is built from the root card's titles, and a change of title is a change of cluster", () => {
    const node = (data: Partial<AgentNodeData>): ClusterNode => ({
      type: "agent", position: { x: 0, y: 0 }, width: 240, height: 120,
      data: { sessionId: SESSION, kind: "root", label: "web-app", provider: "claude", startedAt: 1, ...data } as AgentNodeData,
    });
    const [a] = clusterBounds([node({ goalTitle: "Ship dark mode settings" })]);
    expect(a).toMatchObject({ label: "Ship dark mode settings", folder: "web-app", goalTitle: "Ship dark mode settings", provider: "claude", workspace: "web-app" });
    const [b] = clusterBounds([node({ goalTitle: "Ship dark mode settings", groupName: "Mine" })]);
    expect(b.label).toBe("Mine");
    expect(shallowEqualClusters([a], [b])).toBe(false);
  });
});

describe("renaming a group", () => {
  it("opens on the title drawn, and a clear gives back the titler's title, else the folder", () => {
    expect(groupRenameFacts({ sessionId: SESSION, provider: "claude", groupName: "Mine", goalTitle: "Auto", workspace: "web-app" }))
      .toEqual({ provider: "claude", sessionId: SESSION, current: "Mine", fallback: "Auto", deckNamed: true });
    expect(groupRenameFacts({ sessionId: SESSION, provider: "codex", workspace: "web-app" }))
      .toEqual({ provider: "codex", sessionId: SESSION, current: "web-app", fallback: "web-app", deckNamed: false });
  });

  it("offers nothing for a CLI the deck does not name", () => {
    expect(groupRenameFacts({ sessionId: SESSION, provider: "opencode" })).toBeNull();
    expect(groupRenameFacts({ sessionId: "" })).toBeNull();
  });

  it("follows the session name's rules: the fallback typed back clears a person's title, and changes nothing otherwise", () => {
    const person = groupRenameFacts({ sessionId: SESSION, groupName: "Mine", goalTitle: "Auto", workspace: "w" })!;
    expect(saveAsk("Auto", person)).toEqual({ kind: "save", name: null });
    expect(saveAsk("", person)).toEqual({ kind: "save", name: null });
    const auto = groupRenameFacts({ sessionId: SESSION, goalTitle: "Auto", workspace: "w" })!;
    expect(saveAsk("Auto", auto)).toEqual({ kind: "none" });
    expect(saveAsk("Better", auto)).toEqual({ kind: "save", name: "Better" });
  });

  it("posts the title to /api/group-title and reads the answer, never throwing", async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({ ok: true, name: "Mine" }), { status: 200 }));
    expect(await saveGroupName({ provider: "claude", sessionId: SESSION }, "Mine", send as unknown as typeof fetch)).toEqual({ ok: true, name: "Mine" });
    expect(send).toHaveBeenCalledWith("/api/group-title", expect.objectContaining({ method: "POST", body: JSON.stringify({ provider: "claude", sessionId: SESSION, name: "Mine" }) }));
    const broken = vi.fn(async () => { throw new Error("offline"); });
    expect(await saveGroupName({ provider: "claude", sessionId: SESSION }, "x", broken as unknown as typeof fetch)).toEqual({ ok: false });
  });

  it("asks the titler and says why there is no title in words the catalog has", async () => {
    const off = vi.fn(async () => new Response(JSON.stringify({ ok: false, reason: "off" })));
    const res = await requestGoalTitle({ provider: "claude", sessionId: SESSION }, off as unknown as typeof fetch);
    expect(res).toEqual({ ok: false, reason: "off" });
    for (const reason of ["off", "named", "empty", "budget", "unavailable", "failed", "bad_request", "network"] as const) {
      expect(en[goalTitleReasonKey(reason)], reason).toBeTruthy();
    }
    const odd = vi.fn(async () => new Response(JSON.stringify({ ok: false, reason: "<script>" })));
    expect(await requestGoalTitle({ provider: "claude", sessionId: SESSION }, odd as unknown as typeof fetch)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("a board card", () => {
  const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
  const data = (over: Partial<AgentNodeData>) => ({
    sessionId: SESSION, label: "web-app", kind: "root", state: "done", childCount: 0, tools: [],
    toolCount: 0, usage: NO_USAGE, prompts: [], startedAt: Date.now(), provider: "claude", ...over,
  }) as AgentNodeData;
  const board = (over: Partial<AgentNodeData>) => renderToStaticMarkup(createElement(ReactFlowProvider, null,
    createElement(AgentNode as never, { id: "s", data: data(over), selected: false } as never)));

  it("draws nothing new on a card at rest: the name is the title row's last word (V4)", () => {
    const out = board({ sessionTitle: "CSV export" });
    expect(out).toMatch(/<div class="title"><span class="label"[^>]*>CSV export<\/span><\/div>/);
    expect(out).not.toMatch(/glyph-btn|sn-field/);
  });

  it("opens a root card's field when F2 asks for it, and tells the asker whether a card took it", () => {
    const target = new EventTarget();
    const start = vi.fn();
    expect(requestCardRename(SESSION, target)).toBe(false);
    const off = onCardRename(SESSION, start, target);
    expect(requestCardRename("someone-else", target)).toBe(false);
    expect(requestCardRename(SESSION, target)).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    off();
    expect(requestCardRename(SESSION, target)).toBe(false);
  });

  it("lets F2 reach the deck past a button the mouse pressed, as Delete does, and not past one reached by Tab", () => {
    expect(ownsKeystroke({ tagName: "BUTTON", pointerFocused: true }, "F2")).toBe(false);
    expect(ownsKeystroke({ tagName: "BUTTON", pointerFocused: false }, "F2")).toBe(true);
    expect(ownsKeystroke({ tagName: "INPUT", pointerFocused: true }, "F2")).toBe(true);
  });

  it("answers no card for an ask on a page with nothing to speak through", () => {
    expect(requestCardRename(SESSION, {} as EventTarget)).toBe(false);
    expect(typeof onCardRename(SESSION, () => {}, {} as EventTarget)).toBe("function");
  });
});
