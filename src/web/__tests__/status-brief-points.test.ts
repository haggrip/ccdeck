// The brief's summary as bullets (owner, 2026-11-26: "needs way better
// formatting, bullet points"). Two or three sentences ran six facts into one
// paragraph: a merged PR, new commits after a review, a failing check, four
// sessions waiting on a decision. The brief now asks for 3 to 6 bullets, each
// led by its subject, and the page sets the subject in bold.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPrompt, createStatusBrief, normaliseBrief, RUN_LIMITS } from "../../server/status-brief.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pointLead } from "../status-brief";
import BriefPoints from "../components/BriefPoints";

const reach = (github = "on") => ({ github, slack: "on", jira: "on", linear: "off" });

describe("what the brief is asked for", () => {
  it("is bullets, not sentences: short, one fact each, subject first", () => {
    const p = buildPrompt({ sessions: [], reach: reach(), since: null, now: 0 });
    expect(p).toContain('"points": ["3 to 6 short bullets, most important first, one fact each, under 120 characters.');
    expect(p).toContain("Start each with what it is about (a PR as repo#number, a ticket key, a Slack person or channel, a session's name) and a colon");
    expect(p).not.toContain('"summary"');
    expect(p).not.toContain("two or three plain sentences");
  });

  it("leads with GitHub when the deck read what moved there", () => {
    const github = { status: "on", activity: { since: 0, until: 1, items: [] }, mine: [], review: [] };
    const p = buildPrompt({ sessions: [], reach: reach(), since: null, now: 0, github });
    expect(p).toContain("The first says what moved on GitHub since the last brief");
    expect(p).toContain("open the points with what moved on my PRs");
  });
});

describe("what is kept of the bullets", () => {
  it("keeps up to six, words only, a list marker taken off", () => {
    const b = normaliseBrief({ points: ["- saas-platform#18515: failing check", "• DIS-25534:  still   To Do", "3) Noga: no reply", "", 4, ...Array.from({ length: 9 }, (_, i) => `p${i}`)] });
    expect(b.points).toEqual(["saas-platform#18515: failing check", "DIS-25534: still To Do", "Noga: no reply", "p0", "p1", "p2"]);
  });

  it("cuts a long one, and gives the summary the same words for older readers", () => {
    const b = normaliseBrief({ points: ["a: " + "x".repeat(400), "b: two"] });
    expect(b.points[0].length).toBeLessThanOrEqual(200);
    expect(b.summary.startsWith("a: xxx")).toBe(true);
    expect(normaliseBrief({ summary: "Older brief.", points: ["new"] }).summary).toBe("Older brief.");
  });

  it("is empty for a brief written before, which keeps its summary", () => {
    expect(normaliseBrief({ summary: "Two PRs wait on you." })).toMatchObject({ summary: "Two PRs wait on you.", points: [] });
  });
});

describe("the bullets on the page", () => {
  it("sets the subject in bold when it leads the bullet", () => {
    expect(pointLead("saas-platform#18515: failing enforce-pr-title check")).toEqual({ lead: "saas-platform#18515", rest: "failing enforce-pr-title check" });
    expect(pointLead("PR 18520 merged at 15:33Z after approval")).toEqual({ lead: null, rest: "PR 18520 merged at 15:33Z after approval" });
    expect(pointLead("Nothing moved. Next: wait")).toEqual({ lead: null, rest: "Nothing moved. Next: wait" });
    expect(pointLead(`${"x".repeat(70)}: late colon`).lead).toBeNull();
  });

  it("draws a list, the subject bold and the words as text", () => {
    const html = renderToStaticMarkup(BriefPoints({ points: ["DIS-25534: still <b>To Do</b>", "Nothing else moved"], className: "mi-points" }));
    expect(html).toBe('<ul class="mi-points"><li><strong>DIS-25534</strong>: still &lt;b&gt;To Do&lt;/b&gt;</li><li>Nothing else moved</li></ul>');
  });
});

describe("what one brief may take and spend", () => {
  it("is set by its model: Sonnet gets more time and a higher cap than Haiku", async () => {
    expect(RUN_LIMITS.haiku).toEqual({ timeoutMs: 240_000, maxBudgetUsd: 0.5 });
    expect(RUN_LIMITS.sonnet.timeoutMs).toBeGreaterThan(RUN_LIMITS.haiku.timeoutMs);
    expect(RUN_LIMITS.sonnet.maxBudgetUsd).toBeGreaterThan(RUN_LIMITS.haiku.maxBudgetUsd);
    const calls: { model: string; timeoutMs: number; maxBudgetUsd: number }[] = [];
    const b = createStatusBrief({
      dir: mkdtempSync(join(tmpdir(), "brief-limits-")),
      sessions: async () => ({ rows: [], envelopes: [] }),
      agent: async () => ({ listConnectors: async () => [], runAgent: async (c: { model: string; timeoutMs: number; maxBudgetUsd: number }) => { calls.push(c); return { ok: true, json: { points: ["ok"] } }; } }),
    });
    await b.setSettings({ model: "sonnet", everyMinutes: 0 });
    await b.refresh(); await b.settled();
    expect(calls[0]).toMatchObject({ model: "sonnet", timeoutMs: RUN_LIMITS.sonnet.timeoutMs, maxBudgetUsd: RUN_LIMITS.sonnet.maxBudgetUsd });
  });
});
