// The Status pane on the page: the deck's own half (status-brief.ts), the
// pane's markup (components/StatusPane.tsx), its door on the rail, and the
// routes it reads and writes through (status-brief-routes.mjs).
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Readable } from "node:stream";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTempDir } from "./rm-temp-dir";
import { autoDue, liveItems, localBrief, peopleShown, safeHref, type BriefView } from "../status-brief";
import { StatusPaneView, countsLine } from "../components/StatusPane";
import type { Row } from "../components/SessionList";
import type { StatusBriefHandle } from "../use-status-brief";
import { railItems } from "../rail-items";
import { resetLanguageForTest, t } from "../i18n";
import { createStatusBrief } from "../../server/status-brief.mjs";
import { handleStatusBrief, useStatusBriefForTest } from "../../server/status-brief-routes.mjs";
import { GUARDED_READS, isGuardedRead } from "../../server/request-gates.mjs";

afterEach(() => resetLanguageForTest());

const row = (over: Partial<Row>): Row => ({
  sessionId: "s", label: "session", state: "active", waiting: null, toolCount: 0, cost: 0, startedAt: 0, lastActivity: 0,
  plan: null, planTitle: "", ...over,
}) as Row;

const ROWS: Row[] = [
  row({ sessionId: "ask", label: "schema", state: "active", waiting: { kind: "asked", message: "Which schema?", since: 1 } }),
  row({ sessionId: "perm", label: "deploy", state: "active", waiting: { kind: "permission", message: "Allow Bash?", since: 2 } }),
  row({ sessionId: "err", label: "migrate", state: "err", turnEndedAt: 5, unseen: true, task: "run the migration" }),
  row({ sessionId: "fresh", label: "docs", state: "done", turnEndedAt: 6, unseen: true }),
  row({ sessionId: "seen", label: "old", state: "done", turnEndedAt: 3, unseen: false }),
  row({ sessionId: "work", label: "build", state: "active" }),
  row({ sessionId: "idle", label: "idle box", state: "done", waiting: { kind: "idle", message: "", since: 4 }, turnEndedAt: 4 }),
];

describe("the deck's own half of the pane", () => {
  it("lists who is stuck, what failed and what finished unread, each linked to its card", () => {
    const local = localBrief(ROWS);
    expect(local.waiting.map(i => [i.kind, i.sessionId, i.detail])).toEqual([["answer", "ask", "Which schema?"], ["answer", "perm", "Allow Bash?"]]);
    expect(local.todo.map(i => [i.kind, i.sessionId])).toEqual([["failed", "err"], ["read", "fresh"]]);
    expect(local.counts).toEqual({ needs: 2, working: 1, fresh: 2, failed: 1, total: 7 });
    for (const i of [...local.waiting, ...local.todo]) expect(i).toMatchObject({ source: "session", local: true });
  });

  it("says the counts in one line, and something on a quiet deck", () => {
    expect(countsLine(localBrief(ROWS).counts, t)).toBe("2 waiting on you · 1 failed · 2 done, unread · 1 working");
    expect(countsLine(localBrief([row({ sessionId: "a", state: "done", turnEndedAt: 1, unseen: false })]).counts, t)).toBe("Nothing waiting on you");
    expect(countsLine(localBrief([]).counts, t)).toBe("No sessions on this deck yet");
  });
});

describe("the brief's half", () => {
  it("draws https links only", () => {
    expect(safeHref("https://github.com/o/r/pull/1")).toBe("https://github.com/o/r/pull/1");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("http://example.com")).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });

  it("keeps a link to a session only while the session is on the board", () => {
    const items = liveItems([
      { kind: "decide", title: "gone", source: "session", sessionId: "gone" },
      { kind: "review", title: "pr", source: "github", url: "https://github.com/o/r/pull/2", sessionId: "gone" },
      { kind: "decide", title: "here", source: "session", sessionId: "here" },
      { kind: "review", title: "bad", source: "github", url: "javascript:x" },
    ], new Set(["here"]));
    expect(items.map(i => [i.title, i.url ?? null, i.sessionId ?? null])).toEqual([
      ["pr", "https://github.com/o/r/pull/2", null], ["here", null, "here"],
    ]);
  });

  it("puts pinned people first, keeps them between briefs, and leaves hidden ones out", () => {
    const shown = peopleShown(
      [{ key: "dana", name: "Dana", why: "reviews" }, { key: "bot", name: "Bot" }, { key: "lee", name: "Lee" }],
      { pinned: [{ key: "lee", name: "Lee" }, { key: "sam", name: "Sam", why: "last week" }], hidden: ["bot"] },
    );
    expect(shown.map(p => [p.key, p.pinned])).toEqual([["lee", true], ["sam", true], ["dana", false]]);
  });

  it("asks for an automatic run only when the deck says one is due", () => {
    expect(autoDue({ agent: "ready", running: false, nextAutoAt: 10 }, 10)).toBe(true);
    expect(autoDue({ agent: "ready", running: false, nextAutoAt: 11 }, 10)).toBe(false);
    expect(autoDue({ agent: "ready", running: true, nextAutoAt: 1 }, 10)).toBe(false);
    expect(autoDue({ agent: "ready", running: false, nextAutoAt: null }, 10)).toBe(false);
    expect(autoDue({ agent: "off", running: false, nextAutoAt: 1 }, 10)).toBe(false);
  });
});

const VIEW: BriefView = {
  ok: true, now: 2_000_000, running: false, lastRunAt: 1_000_000, nextAutoAt: 2_800_000, agent: "ready", error: null,
  settings: { model: "haiku", everyMinutes: 30, sources: { github: true, slack: true, jira: true } },
  people: { pinned: [], hidden: [] },
  brief: {
    at: 1_000_000, model: "haiku", summary: "Two PRs wait on you.", reach: { github: "on", slack: "on", jira: "none" },
    waiting: [
      { kind: "review", title: "Review #12", source: "github", url: "https://github.com/o/r/pull/12" },
      { kind: "decide", title: "Pick a schema", source: "session", sessionId: "ask" },
    ],
    todo: [{ kind: "todo", title: "DIS-1", source: "jira", url: "https://x.atlassian.net/browse/DIS-1" }],
    talkTo: [{ kind: "talk", person: "Dana", title: "env stopper", source: "slack", url: "https://x.slack.com/archives/C1/p2" }],
    people: [{ key: "dana", name: "Dana", handle: "dana", why: "reviews your PRs", source: "github", url: "https://github.com/dana" }],
  },
};

const handle = (view: BriefView | null): StatusBriefHandle => ({ view, unreachable: false, refresh() {}, setSettings() {}, person() {} });
const draw = (over: Partial<Parameters<typeof StatusPaneView>[0]> = {}) => renderToStaticMarkup(createElement(StatusPaneView, {
  rows: ROWS, now: 2_000_000, brief: handle(VIEW), pinned: false, onTogglePin() {}, besideInspector: false,
  onOpenSession() {}, onClose() {}, ...over,
}));

describe("the pane's markup", () => {
  it("is a landmark named by its heading, with every section", () => {
    const html = draw();
    expect(html).toMatch(/<aside class="status-pane" id="status-pane" aria-labelledby="stp-title"/);
    expect(html).toMatch(/<h2 class="stp-heading" id="stp-title">Status<\/h2>/);
    for (const h of ["Waiting on you", "To do", "Talk to", "People of interest"]) expect(html).toContain(`>${h}<`);
    expect(html).toContain("Two PRs wait on you.");
    expect(html).toContain("Brief 16m ago · Haiku · GitHub, Slack");
  });

  it("opens each source in the browser, and each session on the board", () => {
    const html = draw();
    expect(html).toMatch(/<a class="stp-link" href="https:\/\/github.com\/o\/r\/pull\/12" target="_blank" rel="noreferrer noopener"/);
    expect(html).toMatch(/<button type="button" class="stp-link" title="Show this session&#x27;s card">/);
    // A session the deck lists live is said once: by its live row.
    expect(html.match(/Pick a schema/g)).toBeNull();
    expect(html).not.toMatch(/href="(?!https:)/);
  });

  it("folds to its header beside the Inspector, unless it is pinned", () => {
    const folded = draw({ besideInspector: true });
    expect(folded).toContain('data-fold="inspector"');
    expect(folded).not.toContain("stp-body");
    expect(folded).toContain("2 waiting on you");
    const pinned = draw({ besideInspector: true, pinned: true });
    expect(pinned).not.toContain("data-fold");
    expect(pinned).toContain("stp-body");
    expect(pinned).toMatch(/class="glyph-btn stp-pin" aria-pressed="true"/);
  });

  it("floats beside Workspace's docked column instead of over it", () => {
    expect(draw({ sideWidth: 320 })).toContain('style="--stp-side:320px"');
    expect(draw()).not.toContain("--stp-side");
  });

  it("says why there is no brief, and still lists the sessions", () => {
    const off = draw({ brief: handle({ ...VIEW, brief: null, agent: "off" }) });
    expect(off).toContain("Briefs need Claude Code on this deck.");
    expect(off).toContain("Which schema?");
    expect(off).toMatch(/class="glyph-btn stp-refresh" disabled=""/);
    // Running, it stays enabled and says it is busy (#620); the handler refuses a second press.
    const running = draw({ brief: handle({ ...VIEW, running: true }) });
    expect(running).toMatch(/class="glyph-btn stp-refresh" aria-busy="true"/);
    expect(running).toContain("Writing a brief…");
    const failed = draw({ brief: handle({ ...VIEW, error: { at: 1_500_000, code: "timeout", message: "took too long" } }) });
    expect(failed).toContain("The last brief failed: took too long");
    expect(failed).toContain("Two PRs wait on you.");
  });

  it("has no control that posts or sends: its only buttons refresh, configure, pin, close, open and pin people", () => {
    const html = draw();
    const classes = [...html.matchAll(/<button[^>]*class="([^"]+)"/g)].map(m => m[1]);
    expect(new Set(classes)).toEqual(new Set([
      "glyph-btn stp-refresh", "glyph-btn stp-settings-btn", "glyph-btn stp-pin", "glyph-btn stp-close",
      "stp-link", "glyph-btn stp-pin-person", "glyph-btn stp-hide-person",
    ]));
  });
});

describe("the pane's door", () => {
  const base = {
    providers: { claude: true, codex: false } as never, sessionListOpen: false, toggleSessionList() {}, accountsPanelOpen: false, toggleAccountsPanel() {},
    usagePanelOpen: false, setUsagePanelOpen() {}, machinePanelOpen: false, setMachinePanelOpen() {}, setUsageHistoryOpen() {},
    watchOn: null, watchUnseen: 0, setBrowserWatchOpen() {}, openSettings() {}, onFeedback() {},
    toggles: new Proxy({}, { get: () => ({ current: null }) }) as never, openQuickOpen() {},
  };
  it("stands under the Inspector's on the right stripe, and only when the deck offers the pane", () => {
    const withPane = railItems({ ...base, statusPaneOpen: true, toggleStatusPane() {} });
    expect(withPane.rightStripe[1].map(i => i.id)).toEqual(["status"]);
    expect(withPane.rightStripe[1][0]).toMatchObject({ kind: "panel", open: true, controls: "status-pane", label: "Status" });
    // On a phone the dock draws right[0] itself: Usage and This machine stay there, Status goes under More.
    expect(withPane.right[0].map(i => i.id)).toEqual(["usage", "machine"]);
    expect(withPane.right[1].map(i => i.id)).toEqual(["status"]);
    const without = railItems(base);
    expect(without.rightStripe.flat().some(i => i.id === "status")).toBe(false);
  });
});

describe("the pane's routes", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmTempDir(d); useStatusBriefForTest(null); });

  function request(method: string, path: string, body?: unknown) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as Readable & { method: string; headers: object; url: string };
    Object.assign(req, { method, headers: { host: "127.0.0.1:4317" }, url: path });
    let status = 0; let text = "";
    const res = {
      headersSent: false,
      writeHead(s: number) { status = s; this.headersSent = true; return this; },
      end(t: string) { text = t; },
      setHeader() {},
    };
    return handleStatusBrief(req, res, new URL(`http://127.0.0.1${path}`)).then(() => ({ status, json: JSON.parse(text || "null") }));
  }

  it("guards the read like the other session reads", () => {
    expect(GUARDED_READS.has("/api/status-brief")).toBe(true);
    expect(isGuardedRead("/api/status-brief")).toBe(true);
  });

  it("reads, refreshes, sets and pins, all in the deck's own file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "status-routes-")); dirs.push(dir);
    const calls: unknown[] = [];
    const brief = createStatusBrief({
      dir, now: () => 7_000_000,
      agent: async () => ({ listConnectors: async () => [], runAgent: async (c: unknown) => { calls.push(c); return { ok: true, json: { summary: "quiet" } }; } }),
      sessions: async () => ({ rows: [], envelopes: [] }),
    });
    useStatusBriefForTest(brief);
    expect((await request("GET", "/api/status-brief")).json).toMatchObject({ ok: true, brief: null, agent: "ready" });
    const r = await request("POST", "/api/status-brief/refresh", {});
    expect(r.json.outcome).toEqual({ started: true });
    await brief.settled();
    expect((await request("GET", "/api/status-brief")).json.brief.summary).toBe("quiet");
    expect(calls).toHaveLength(1);
    expect((await request("POST", "/api/status-brief/settings", { model: "opus" })).json.settings.model).toBe("opus");
    expect((await request("POST", "/api/status-brief/people", { action: "pin", person: { name: "Dana" } })).json.people.pinned[0].key).toBe("dana");
    expect((await request("POST", "/api/status-brief/people", { action: "nope" })).status).toBe(400);
    expect((await request("POST", "/api/status-brief/settings", [1])).status).toBe(400);
    expect((await request("DELETE", "/api/status-brief")).status).toBe(405);
    expect((await request("POST", "/api/status-brief/send", {})).status).toBe(404);
  });
});
