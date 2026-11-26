// Which PRs and tickets each session works on, worked out with no model from
// what the session itself did (src/server/session-links.mjs, folded on the
// transcript scan in transcript-scan.mjs), the route that serves them with the
// session each Todo item is about (session-links-routes.mjs), and how Mission
// shows them: chips under a live session, and "Open in Claude Desktop" on an
// item whose PR or ticket a session works on (session-links.ts,
// MissionView.tsx, status-todo.ts openerOf).
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTempDir } from "./rm-temp-dir";
import {
  MAX_PRS, foldLinksLine, matchItems, newLinksState, ownedBranch, prFacts, prOf, sessionLinks, ticketBases, ticketOf,
} from "../../server/session-links.mjs";
import { computeSessionLinks, inLinkedWorktree, recentTranscripts, transcriptPaths } from "../../server/session-links-routes.mjs";
import { scanTranscript } from "../../server/transcript-scan.mjs";
import { normalisePrs } from "../../server/status-gh.mjs";
import { GUARDED_READS } from "../../server/request-gates.mjs";
import { linksFrom, prStateWords, prTone, NO_LINKS, type SessionPr } from "../session-links";
import { openerOf, type TodoItem, type TodoView } from "../status-todo";
import { MissionPage, SessionChips } from "../components/MissionView";
import type { StatusBriefHandle } from "../use-status-brief";
import type { Row } from "../components/SessionList";
import { resetLanguageForTest, t } from "../i18n";

afterEach(() => resetLanguageForTest());

const PR = "https://github.com/acme/api/pull/412";
const PR2 = "https://github.com/acme/web/pull/88";
const T0 = Date.parse("2026-11-25T10:00:00Z");
const ts = (n: number) => new Date(T0 + n * 1000).toISOString();

// Transcript lines as Claude Code writes them.
const use = (id: string, name: string, input: object, n = 0, over: object = {}) => JSON.stringify({
  type: "assistant", timestamp: ts(n), gitBranch: "main", message: { model: "claude-opus-5", content: [{ type: "tool_use", id, name, input }] }, ...over,
});
const bash = (id: string, command: string, n = 0) => use(id, "Bash", { command }, n);
const result = (id: string, toolUseResult: object | null, content: unknown = "ok", n = 1) => JSON.stringify({
  type: "user", timestamp: ts(n), message: { content: [{ type: "tool_result", tool_use_id: id, content }] }, ...(toolUseResult ? { toolUseResult } : {}),
});
const fold = (lines: string[]) => {
  const s = newLinksState();
  for (const l of lines) foldLinksLine(s, l, l.includes('"model"') ? JSON.parse(l) : null);
  return s;
};
const prsOf = (s: ReturnType<typeof newLinksState>) => Object.fromEntries(s.prs.map((p: { url: string; how: string }) => [p.url, p.how]));
const keysOf = (s: ReturnType<typeof newLinksState>) => Object.fromEntries(s.keys.map((k: { key: string; how: string }) => [k.key, k.how]));

describe("what a session's transcript says it works on", () => {
  it("takes the PR a real `gh pr create` opened, from Claude Code's own gitOperation", () => {
    const s = fold([
      bash("c1", "cd ../wt && git push -u origin dis-412-retries\ngh pr create --base main --title \"DIS-412: Webhook retries\" --body-file b.md", 0),
      result("c1", { stdout: PR, gitOperation: { push: { branch: "dis-412-retries" }, pr: { number: 412, url: PR, action: "created" } } }),
    ]);
    expect(prsOf(s)).toEqual({ [PR]: "created" });
    expect(s.pushed).toEqual(["dis-412-retries"]);
    expect(keysOf(s)).toEqual({ "DIS-412": "pr" });
  });

  it("does not believe a gitOperation on a command that only names gh inside it", () => {
    // Claude Code said "created" for a grep that printed a PR's address.
    const s = fold([
      bash("g1", "grep -E 'gh pr create' events.jsonl | python3 -c 'print(1)'"),
      result("g1", { stdout: PR, gitOperation: { pr: { number: 412, url: PR, action: "created" } } }),
    ]);
    expect(s.prs).toEqual([]);
  });

  it("tells working on a PR from looking at one, and reads a number only with its repository", () => {
    const s = fold([
      bash("v1", `gh pr view ${PR} --json state`, 0),
      bash("d1", "gh pr diff 88 --repo acme/web | head", 1),
      bash("n1", "gh pr view 99 --json title", 2),
      bash("a1", "gh api repos/acme/infra/pulls/7/comments --jq '.[].body'", 3),
    ]);
    expect(prsOf(s)).toEqual({ [PR]: "viewed", [PR2]: "worked", "https://github.com/acme/infra/pull/7": "viewed" });
  });

  it("keeps the stronger of two ways to a PR, and a merge by number only for its own PR", () => {
    const s = fold([
      bash("v1", `gh pr view ${PR}`, 0),
      bash("c1", "gh pr create --fill", 1),
      result("c1", { gitOperation: { pr: { number: 412, url: PR, action: "created" } } }, "ok", 2),
      bash("m1", "gh pr merge 412 --squash", 3),
      result("m1", { gitOperation: { pr: { number: 412, action: "merged" } } }, "ok", 4),
      bash("m2", "gh pr merge 5 --squash", 5),
      result("m2", { gitOperation: { pr: { number: 5, action: "merged" } } }, "ok", 6),
    ]);
    expect(prsOf(s)).toEqual({ [PR]: "created" });
    expect(s.prs[0].at).toBe(T0 + 4000);
  });

  it("takes the tickets its Jira and Linear tools named, and the key a create answered with", () => {
    const s = fold([
      use("j1", "mcp__atlassian__getJiraIssue", { cloudId: "acme.atlassian.net", issueIdOrKey: "DIS-25534" }, 0),
      use("j2", "mcp__atlassian__editJiraIssue", { cloudId: "acme.atlassian.net", issueIdOrKey: "DIS-25535", fields: {} }, 1),
      use("j3", "mcp__atlassian__createJiraIssue", { cloudId: "acme.atlassian.net", projectKey: "DIS", summary: "x" }, 2),
      result("j3", null, [{ type: "text", text: "{\"key\":\"DIS-25600\",\"self\":\"…\"}" }], 3),
      use("l1", "mcp__b67c06e7__get_issue", { id: "SAAS-119" }, 4),
      use("l2", "mcp__b67c06e7__get_team", { id: "TEAM-1" }, 5),
    ]);
    expect(keysOf(s)).toEqual({ "DIS-25534": "read", "DIS-25535": "wrote", "DIS-25600": "wrote", "SAAS-119": "read" });
    expect(s.keys.find((k: { key: string }) => k.key === "SAAS-119").src).toBe("linear");
    expect(s.keys.find((k: { key: string }) => k.key === "DIS-25534").src).toBe("jira");
    expect(s.jiraHost).toBe("acme.atlassian.net");
    expect(s.creating).toEqual([]);
  });

  it("takes the ticket a commit's message leads with", () => {
    const s = fold([
      bash("k0", "gh pr create --title \"DIS-0000: placeholder\" --fill", 0),
      bash("k1", "git add -A && git commit -m \"DIS-9: fix the retry\"", 0),
      bash("k2", "git commit -q -F - <<'EOF'\nignored\nEOF", 1),
      bash("k3", "git commit -m \"$(cat <<'EOF'\nDIS-10: second\n\nSee DIS-11\nEOF\n)\"", 2),
    ]);
    expect(keysOf(s)).toEqual({ "DIS-9": "commit", "DIS-10": "commit" });
  });

  it("reads no prose, and no request blob that repeats earlier calls", () => {
    const s = fold([
      JSON.stringify({ type: "user", timestamp: ts(0), message: { content: "please look at DIS-1 and " + PR } }),
      JSON.stringify({ type: "assistant", timestamp: ts(1), message: { model: "claude-opus-5", content: [{ type: "text", text: `gh pr view ${PR} shows DIS-2` }] } }),
      JSON.stringify({ type: "api-request-blob", timestamp: ts(2), message: { model: "claude-opus-5", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: `gh pr diff ${PR}` } }] } }),
    ]);
    expect(s.prs).toEqual([]);
    expect(s.keys).toEqual([]);
  });

  it("keeps a capped list, the weakest and oldest going first", () => {
    const lines = [bash("c1", "gh pr create --fill", 0), result("c1", { gitOperation: { pr: { number: 1, url: "https://github.com/a/b/pull/1", action: "created" } } })];
    for (let i = 2; i < 30; i++) lines.push(bash(`v${i}`, `gh pr view https://github.com/a/b/pull/${i}`, i));
    const s = fold(lines);
    expect(s.prs).toHaveLength(MAX_PRS);
    expect(prsOf(s)["https://github.com/a/b/pull/1"]).toBe("created");
    expect(prsOf(s)["https://github.com/a/b/pull/29"]).toBe("viewed");
    expect(prsOf(s)["https://github.com/a/b/pull/2"]).toBeUndefined();
  });

  it("rides the deck's own transcript scan", async () => {
    const dir = mkdtempSync(join(tmpdir(), "session-links-"));
    try {
      const path = join(dir, "s.jsonl");
      writeFileSync(path, [
        bash("c1", "gh pr create --fill", 0),
        result("c1", { gitOperation: { pr: { number: 412, url: PR, action: "created" } } }),
        use("j1", "mcp__atlassian__getJiraIssue", { cloudId: "acme.atlassian.net", issueIdOrKey: "DIS-7" }, 2),
        "",
      ].join("\n"));
      const state = await scanTranscript(path);
      expect(prsOf(state.links)).toEqual({ [PR]: "created" });
      expect(keysOf(state.links)).toEqual({ "DIS-7": "read" });
    } finally { rmTempDir(dir); }
  });
});

describe("one session's PRs and tickets", () => {
  it("counts a branch only in a linked worktree or when the session pushed it", () => {
    const links = { ...newLinksState(), pushed: ["dis-5-pushed"] };
    expect(ownedBranch({ links, branch: "dev/DIS-25374-retry", worktree: false })).toBeNull();
    expect(ownedBranch({ links, branch: "dev/DIS-25374-retry", worktree: true })).toBe("dev/DIS-25374-retry");
    expect(ownedBranch({ links, branch: "dis-5-pushed", worktree: false })).toBe("dis-5-pushed");
    expect(ownedBranch({ links, branch: "main", worktree: true })).toBeNull();
    // A main checkout's branch names no ticket for the session sitting in it.
    expect(sessionLinks({ links, branch: "dev/DIS-25374-retry", worktree: false }).keys.map(k => k.key)).toEqual(["DIS-5"]);
  });

  it("joins the brief's PR on its branch, the ticket its title names, and its state", () => {
    const facts = prFacts({
      prs: normalisePrs([{ url: PR, title: "DIS-412: Webhook retries", branch: "dis-412-retries", review: "CHANGES_REQUESTED", checks: { passed: 3, failed: 0, pending: 1 } }]),
      activity: { items: [{ url: PR2, state: "merged", title: "DIS-77: Old" }] },
      linkStates: [{ url: "https://github.com/acme/x/pull/3", state: "green" }],
    });
    const links = fold([bash("v1", `gh pr view ${PR2}`)]);
    const out = sessionLinks({ links, branch: "dis-412-retries", worktree: true, names: ["Retries · DIS-400"], facts });
    expect(out.prs).toEqual([
      { url: PR, repo: "api", number: 412, how: "branch", state: "open", checks: "pending", review: "changes" },
      { url: PR2, repo: "web", number: 88, how: "viewed", state: "merged", checks: null, review: null },
    ]);
    // A PR it only looked at lends it no ticket.
    expect(out.keys.map(k => `${k.key}:${k.how}`)).toEqual(["DIS-412:branch", "DIS-400:title"]);
    expect(prFacts({ linkStates: [{ url: "https://github.com/acme/x/pull/3", state: "green" }] }).get("https://github.com/acme/x/pull/3")).toMatchObject({ checks: "pass" });
  });

  it("links a ticket to its tracker's page, and a key from nowhere known to none", () => {
    const states = [{ ...newLinksState(), jiraHost: "acme.atlassian.net", keys: [{ key: "OPS-1", how: "read", at: 0, src: "jira" }] }];
    const bases = ticketBases({ urls: ["https://acme.atlassian.net/browse/DIS-24903", "https://linear.app/acme/issue/SAAS-1/x", "https://example.com/x"], states });
    expect(Object.fromEntries(bases)).toEqual({ DIS: "https://acme.atlassian.net/browse/", SAAS: "https://linear.app/acme/issue/", OPS: "https://acme.atlassian.net/browse/" });
    const links = { ...newLinksState(), keys: [{ key: "SAAS-9", how: "read", at: 0, src: "linear" }, { key: "ZZ-1", how: "read", at: 0, src: "linear" }, { key: "DIS-1", how: "wrote", at: 0 }] };
    const out = sessionLinks({ links, bases });
    expect(out.keys).toEqual([
      { key: "DIS-1", how: "wrote", url: "https://acme.atlassian.net/browse/DIS-1" },
      { key: "SAAS-9", how: "read", url: "https://linear.app/acme/issue/SAAS-9" },
      { key: "ZZ-1", how: "read" },
    ]);
  });

  it("reads PR and ticket addresses only in their own shapes", () => {
    expect(prOf(`${PR}/files?w=1`)).toBe(PR);
    expect(prOf(`${PR}0`)).toBe(`${PR}0`);
    expect(prOf("https://github.com/acme/api/pull/412x")).toBeNull();
    expect(prOf("http://github.com/acme/api/pull/412")).toBeNull();
    expect(ticketOf("https://acme.atlassian.net/browse/DIS-25534")).toBe("DIS-25534");
    expect(ticketOf("https://linear.app/acme/issue/SAAS-1/slug")).toBe("SAAS-1");
    expect(ticketOf("https://example.com/issue/SAAS-1")).toBeNull();
  });
});

describe("the session a Todo item is about", () => {
  const item = (id: string, url: string, sessionId?: string) => ({ id, link: { url, ...(sessionId ? { sessionId } : {}) } });
  const sessions = {
    opener: { prs: [{ url: PR, how: "created" }], keys: [{ key: "DIS-25544", how: "pr" }], lastEventAt: 1 },
    looker: { prs: [{ url: PR, how: "viewed" }], keys: [{ key: "DIS-25534", how: "read" }], lastEventAt: 9 },
    later: { prs: [], keys: [{ key: "DIS-25534", how: "read" }], lastEventAt: 20 },
    elsewhere: { prs: [{ url: PR2, how: "created" }], keys: [], lastEventAt: 30 },
  };

  it("is the session whose link to its PR or ticket is strongest, then the one heard from last", () => {
    expect(matchItems([
      item("t_000001", `${PR}/files`),
      item("t_000002", "https://acme.atlassian.net/browse/DIS-25534"),
      item("t_000003", "https://acme.atlassian.net/browse/DIS-25544"),
      item("t_000004", "https://slack.com/archives/C1/p1"),
      item("t_000005", "https://acme.atlassian.net/browse/DIS-1"),
    ], sessions)).toEqual({ t_000001: "opener", t_000002: "later", t_000003: "opener" });
  });

  it("is one the desktop app runs, and never overrides a session the item names", () => {
    expect(matchItems([item("t_000001", PR)], sessions, { opens: (id: string) => id === "looker" })).toEqual({ t_000001: "looker" });
    expect(matchItems([item("t_000001", PR2, "someone")], sessions)).toEqual({});
  });
});

describe("the route's answer", () => {
  const env = (seq: number, sid: string, cwd: string, over: object = {}) => ({
    seq, receivedAt: T0 + seq, payload: { session_id: sid, hook_event_name: "UserPromptSubmit", prompt: "go", cwd, transcript_path: `/t/${sid}.jsonl`, ...over },
  });

  it("is a guarded read", () => {
    expect(GUARDED_READS.has("/api/session-links")).toBe(true);
  });

  it("names each session's PRs and tickets, and the item each opens, leaving out what the app archived", async () => {
    const states: Record<string, object> = {
      "/t/s1.jsonl": { gitBranch: "dis-412-retries", customTitle: "Retries", links: fold([bash("c1", "gh pr create --fill"), result("c1", { gitOperation: { pr: { number: 412, url: PR, action: "created" } } })]) },
      "/t/s2.jsonl": { gitBranch: "dev/DIS-25374-x", links: fold([use("j1", "mcp__atlassian__getJiraIssue", { cloudId: "acme.atlassian.net", issueIdOrKey: "DIS-25534" })]) },
      "/t/s3.jsonl": { gitBranch: "dis-9-gone", links: newLinksState() },
    };
    const out = await computeSessionLinks({
      // s3 is archived and resting, so it goes (an archived session at work would stay).
      envelopes: [env(1, "s1", "/repo/.claude/worktrees/wt"), env(2, "s2", "/repo"), env(3, "s3", "/repo/.claude/worktrees/gone"), env(4, "s3", "/repo/.claude/worktrees/gone", { hook_event_name: "Stop" })],
      archived: new Set(["s3"]),
      desktop: { s1: "local_1", s2: "local_2" },
      brief: { prs: [{ url: PR, title: "Webhook retries", branch: "dis-412-retries", draft: true }] },
      todo: { open: [
        { id: "t_000001", link: { url: PR } },
        { id: "t_000002", link: { url: "https://acme.atlassian.net/browse/DIS-25534" } },
      ] },
      scan: async (p: string) => states[p] ?? null,
      worktree: async (cwd: string) => cwd.includes("/worktrees/"),
      recent: async () => [],
      now: T0 + 10,
    });
    expect(out.sessions).toEqual({
      s1: { prs: [{ url: PR, repo: "api", number: 412, how: "created", state: "draft", checks: null, review: null }], keys: [{ key: "DIS-412", how: "branch", url: "https://acme.atlassian.net/browse/DIS-412" }] },
      s2: { prs: [], keys: [{ key: "DIS-25534", how: "read", url: "https://acme.atlassian.net/browse/DIS-25534" }] },
    });
    expect(out.items).toEqual({ t_000001: "s1", t_000002: "s2" });
  });

  it("matches items against the desktop app's other recent sessions too, without drawing their chips", async () => {
    const asked: string[][] = [];
    const quiet = { gitBranch: "dis-25534-drawer", links: { ...fold([use("j1", "mcp__atlassian__getJiraIssue", { cloudId: "acme.atlassian.net", issueIdOrKey: "DIS-25534" })]), cwd: "/r/.claude/worktrees/q" } };
    const out = await computeSessionLinks({
      envelopes: [env(1, "s1", "/repo")],
      archived: new Set(["gone"]),
      desktop: { s1: "local_1", quiet: "local_2", gone: "local_3" },
      todo: { open: [{ id: "t_000001", link: { url: "https://acme.atlassian.net/browse/DIS-25534" } }] },
      scan: async (p: string) => (p === "/t/quiet.jsonl" ? quiet : null),
      worktree: async (cwd: string) => cwd === "/r/.claude/worktrees/q",
      recent: async (ids: string[]) => { asked.push(ids); return [{ id: "quiet", path: "/t/quiet.jsonl", at: T0 }]; },
      now: T0 + 10,
    });
    // Only the app's sessions the ring does not hold, less the archived.
    expect(asked).toEqual([["quiet"]]);
    expect(out.items).toEqual({ t_000001: "quiet" });
    expect(out.sessions).toEqual({});
  });

  it("finds the app's sessions' transcripts by one listing per project folder, newest and recent only", async () => {
    const now = T0;
    const tree: Record<string, string[]> = { "/p": ["proj-a", "proj-b", "file.txt"], "/p/proj-a": ["aaaaaaaa-1.jsonl", "bbbbbbbb-2.jsonl"], "/p/proj-b": ["cccccccc-3.jsonl", "notes.md"] };
    const mtimes: Record<string, number> = { "/p/proj-a/aaaaaaaa-1.jsonl": now - 1000, "/p/proj-a/bbbbbbbb-2.jsonl": now - 10 * 24 * 3600_000, "/p/proj-b/cccccccc-3.jsonl": now - 10 };
    const fs = {
      readdir: async (dir: string, opts?: { withFileTypes?: boolean }) => {
        const names = tree[dir];
        if (!names) throw new Error("ENOENT");
        return opts?.withFileTypes ? names.map(n => ({ name: n, isDirectory: () => `${dir}/${n}` in tree })) : names;
      },
      stat: async (p: string) => { if (!(p in mtimes)) throw new Error("ENOENT"); return { mtimeMs: mtimes[p] }; },
    };
    const got = await recentTranscripts(["aaaaaaaa-1", "bbbbbbbb-2", "cccccccc-3", "dddddddd-4", "../x"], { roots: ["/p"], now, fs: fs as never });
    expect(got.map((g: { id: string }) => g.id)).toEqual(["cccccccc-3", "aaaaaaaa-1"]);
    expect((await recentTranscripts(["aaaaaaaa-1", "cccccccc-3"], { roots: ["/p"], now, max: 1, fs: fs as never })).map((g: { id: string }) => g.id)).toEqual(["cccccccc-3"]);
  });

  it("reads each session's newest transcript off the ring", () => {
    const paths = transcriptPaths([env(1, "a", "/x"), env(2, "a", "/x", { transcript_path: "/t/a2.jsonl" }), { seq: 3, payload: { session_id: "b" } }]);
    expect(Object.fromEntries(paths)).toEqual({ a: "/t/a2.jsonl" });
  });

  it("knows a linked worktree by its .git file", async () => {
    const fs: Record<string, "file" | "dir"> = { "/r/.git": "dir", "/r/.claude/worktrees/w/.git": "file" };
    const statFn = async (p: string) => {
      if (!fs[p]) throw new Error("ENOENT");
      return { isFile: () => fs[p] === "file" };
    };
    expect(await inLinkedWorktree("/r/.claude/worktrees/w/src/deep", { statFn: statFn as never, now: 1 })).toBe(true);
    expect(await inLinkedWorktree("/r/src", { statFn: statFn as never, now: 1 })).toBe(false);
    expect(await inLinkedWorktree("/nowhere", { statFn: statFn as never, now: 1 })).toBe(false);
  });
});

describe("Mission shows them", () => {
  const LOCAL = "local_bda3155a-32db-4c0a-ac48-8a971213245c";
  const CLI = "1bedd631-f6d2-4e5d-a5bf-37d4edded680";
  const prOpen = (over: Partial<SessionPr>): SessionPr => ({ url: PR, repo: "api", number: 412, how: "created", state: "open", checks: null, review: null, ...over });

  it("holds the route's answer to its shapes", () => {
    const v = linksFrom({ ok: true, sessions: {
      [CLI]: { prs: [prOpen({}), { url: "http://github.com/a/b/pull/1" }, { url: "https://evil.example/pull/1" }], keys: [{ key: "DIS-1", url: "javascript:alert(1)" }, { key: "nope" }] },
      "bad id!": { prs: [prOpen({})], keys: [] },
    }, items: { t_000001: CLI, x: CLI, t_000002: 5 } });
    expect(v.sessions[CLI].prs.map(p => p.url)).toEqual([PR]);
    expect(v.sessions[CLI].keys).toEqual([{ key: "DIS-1", how: "read" }]);
    expect(Object.keys(v.sessions)).toEqual([CLI]);
    expect(v.items).toEqual({ t_000001: CLI });
    expect(linksFrom({ ok: false })).toBe(NO_LINKS);
  });

  it("colours a PR by what is most pressing about it, and says it in words", () => {
    expect(prTone(prOpen({ state: undefined }))).toBeNull();
    expect(prTone(prOpen({ state: "merged", checks: "fail" }))).toBe("merged");
    expect(prTone(prOpen({ checks: "fail", review: "approved" }))).toBe("fail");
    expect(prTone(prOpen({ checks: "pending", review: "changes" }))).toBe("changes");
    expect(prTone(prOpen({ checks: "pass", review: "approved" }))).toBe("approved");
    expect(prTone(prOpen({}))).toBe("open");
    expect(prStateWords(prOpen({ checks: "fail", review: "approved" })).map(k => t(k))).toEqual(["checks failed", "approved"]);
    expect(prStateWords(prOpen({ state: "draft" })).map(k => t(k))).toEqual(["draft"]);
  });

  it("draws a session's PRs and tickets as chips that open their pages", () => {
    const html = renderToStaticMarkup(createElement(SessionChips, { t, links: {
      prs: [prOpen({ checks: "fail" }), prOpen({ url: PR2, repo: "web", number: 88, state: undefined })],
      keys: [{ key: "DIS-412", how: "branch", url: "https://acme.atlassian.net/browse/DIS-412" }, { key: "SAAS-1", how: "read" }],
    } }));
    expect(html).toContain(`<a class="mi-chip" data-kind="pr" data-tone="fail" href="${PR}" target="_blank" rel="noreferrer noopener" title="api#412 · checks failed"`);
    expect(html).toMatch(/data-kind="pr" href="https:\/\/github.com\/acme\/web\/pull\/88"[^>]*title="web#88"[^>]*>#88</);
    expect(html).toContain(`href="https://acme.atlassian.net/browse/DIS-412"`);
    expect(html).toContain(`<span class="mi-chip" data-kind="ticket">SAAS-1</span>`);
    expect(renderToStaticMarkup(createElement(SessionChips, { t, links: undefined }))).toBe("");
  });

  it("gives an item its PR's session in the desktop app, and keeps its title on the PR", () => {
    const i: TodoItem = { id: "t_000002", title: "Review acme#412", kind: "review", origin: "brief", link: { kind: "pr", url: PR }, state: "open", createdAt: 1, updatedAt: 1 };
    expect(openerOf(i, new Set(), { [CLI]: LOCAL }, CLI)).toEqual({ href: PR, desktop: CLI });
    expect(openerOf(i, new Set(), {}, CLI)).toEqual({ href: PR });
    const named: TodoItem = { ...i, link: { kind: "pr", url: PR, sessionId: "other" } };
    expect(openerOf(named, new Set(), { [CLI]: LOCAL }, CLI)).toEqual({ href: PR });

    const row = { sessionId: CLI, label: "retries", state: "active", waiting: null, toolCount: 0, cost: 0, startedAt: 0, lastActivity: 0, plan: null, planTitle: "" } as unknown as Row;
    const brief: StatusBriefHandle = { view: null, unreachable: false, refresh() {}, setSettings() {}, person() {} };
    const view: TodoView = { ok: true, now: T0, closed: [], keeper: { lastRunAt: null, lastCostUsd: null, error: null }, open: [i] };
    const html = renderToStaticMarkup(createElement(MissionPage, {
      rows: [row], now: T0, desktop: { [CLI]: LOCAL }, brief, todo: { view, say() {}, act() {} },
      links: { sessions: { [CLI]: { prs: [prOpen({})], keys: [] } }, items: { t_000002: CLI } },
      onOpenSession() {}, onOpenDesktop() {},
    }));
    // The task: its title still opens the PR, and the desktop button is there.
    expect(html).toMatch(/<a class="mi-task-title" href="https:\/\/github.com\/acme\/api\/pull\/412"[\s\S]*?class="mi-desktop"/);
    // The live row: its chips on a line of their own.
    expect(html).toMatch(/data-live="working"[\s\S]*?<ul class="mi-live-links"[^>]*><li><a class="mi-chip" data-kind="pr" data-tone="open"/);
  });
});
