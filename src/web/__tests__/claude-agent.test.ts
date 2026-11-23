// The bridge to the person's own Claude connectors (claude-agent.mjs), run
// against a fake `claude` that speaks the same stream-json control protocol:
// initialize, mcp_status, a user turn, an init message, tool uses and a
// result. Every scenario is a JSON file the fake reads, and every run of the
// fake appends what it was given — argv, cwd, the hook marker, the prompt it
// read from stdin — to a log the assertions read back.
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTempDir } from "./rm-temp-dir";

// @ts-expect-error — .mjs server module, no types
const agentModule = await import("../../server/claude-agent.mjs");
const {
  createClaudeAgent, agentArgs, agentEnv, mcpServerId, isReadOnly, connectorsFrom, denyList, oneJsonObject,
  SYSTEM_PROMPT, AGENT_VETO_ENV,
} = agentModule;

const ROOT = mkdtempSync(join(tmpdir(), "ccdeck-claude-agent-"));
afterAll(() => rmTempDir(ROOT));

const FAKE = join(ROOT, "fake-claude.mjs");
writeFileSync(FAKE, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const scenario = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_SCENARIO, "utf8"));
const log = (entry) => appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ pid: process.pid, at: Date.now(), ...entry }) + "\\n");
log({ start: true, argv: process.argv.slice(2), cwd: process.cwd(), internal: process.env.AGENTS_DECK_INTERNAL ?? null,
  leaked: Object.keys(process.env).filter(k => k.startsWith("CCDECK_") || k === "CLAUDECODE") });
if (scenario.exitAtOnce) { process.stderr.write(scenario.stderr ?? "boom\\n"); process.exit(scenario.exitAtOnce); }
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const flag = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.type === "control_request") {
      const id = m.request_id;
      if (m.request.subtype === "initialize") {
        out({ type: "control_response", response: { subtype: "success", request_id: id, response: { account: scenario.account ?? { email: "me@example.com", tokenSource: "claude.ai" } } } });
      } else if (m.request.subtype === "mcp_status") {
        out({ type: "control_response", response: { subtype: "success", request_id: id, response: { mcpServers: scenario.servers ?? [] } } });
      }
      continue;
    }
    if (m.type === "user") {
      log({ prompt: m.message.content });
      if (scenario.hang) continue;
      const allowed = (flag("--allowedTools") ?? "").split(",").filter(Boolean);
      out({ type: "system", subtype: "init", tools: scenario.offer ?? allowed, mcp_servers: [] });
      for (const name of scenario.toolUses ?? []) {
        out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name, input: {} }] } });
      }
      const delay = scenario.delayMs ?? 0;
      setTimeout(() => {
        out({ type: "result", subtype: scenario.subtype ?? "success", is_error: scenario.isError ?? false,
          result: scenario.answer ?? "{\\"ok\\": true}", total_cost_usd: 0.0123, num_turns: 2, duration_ms: 900,
          usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
          modelUsage: { "claude-haiku-test": {} }, ...(scenario.structured ? { structured_output: scenario.structured } : {}) });
        log({ end: true });
      }, delay);
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`);
chmodSync(FAKE, 0o755);

const SERVERS = [
  {
    name: "claude.ai Slack", status: "connected", source: "claudeai", config: { url: "https://secret.example/key-123" },
    urlHost: "secret.example",
    tools: [
      { name: "slack_search_public", annotations: { readOnly: true, openWorld: true } },
      { name: "slack_send_message", annotations: { openWorld: true } },
      { name: "slack_update_canvas", annotations: { readOnly: true, destructive: true } },
    ],
  },
  {
    name: "claude.ai Linear", status: "connected", source: "claudeai",
    tools: [{ name: "list_issues", annotations: { readOnly: true } }, { name: "save_issue", annotations: {} }],
  },
  { name: "claude.ai Wiz", status: "needs-auth", source: "claudeai" },
];
const SEARCH = "mcp__claude_ai_Slack__slack_search_public";

let n = 0;
function setup(scenario: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) {
  const dir = join(ROOT, `case-${++n}`);
  mkdirSync(dir, { recursive: true });
  const scenarioFile = join(dir, "scenario.json");
  const logFile = join(dir, "log.jsonl");
  writeFileSync(scenarioFile, JSON.stringify({ servers: SERVERS, ...scenario }));
  const env = {
    PATH: process.env.PATH ?? "", HOME: dir, FAKE_CLAUDE_SCENARIO: scenarioFile, FAKE_CLAUDE_LOG: logFile,
    CCDECK_HOME: dir, CLAUDECODE: "1", ...(opts.env as Record<string, string> ?? {}),
  };
  const dataDir = join(dir, "data");
  const agent = createClaudeAgent({ env, bin: () => (opts.bin as string) ?? FAKE, dataDir: () => dataDir, pollMs: 20, mcpWaitMs: 2_000 });
  const entries = () => existsSync(logFile)
    ? readFileSync(logFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
  return { agent, entries, dataDir, scenarioFile };
}

const isWin = process.platform === "win32";

describe("the argument vector", () => {
  it("holds Claude Code to no built-in tools, refused permissions and no saved session, and never carries the prompt", () => {
    const args: string[] = agentArgs({ model: "haiku" });
    for (const flag of ["-p", "--restricted", "--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config"]) {
      expect(args).toContain(flag);
    }
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args[args.indexOf("--permission-prompts") + 1]).toBe("none");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe(SYSTEM_PROMPT);
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("names the allowlist and the deny list, and lets MCP servers connect only when a tool is allowed", () => {
    const args: string[] = agentArgs({ allow: [SEARCH], deny: ["mcp__claude_ai_Linear", "mcp__claude_ai_Slack__slack_send_message"] });
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(SEARCH);
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe("mcp__claude_ai_Linear,mcp__claude_ai_Slack__slack_send_message");
    expect(args).not.toContain("--strict-mcp-config");
  });

  it("is the bare protocol for a listing, which sends no prompt and names no model", () => {
    const args: string[] = agentArgs({ listing: true });
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--system-prompt");
    expect(args).toContain("--restricted");
  });
});

describe("what the deck reads of Claude Code's servers", () => {
  it("spells a server's id the way Claude Code puts it in a tool name", () => {
    expect(mcpServerId("claude.ai Slack")).toBe("claude_ai_Slack");
    expect(mcpServerId("claude.ai Claude Data")).toBe("claude_ai_Claude_Data");
    expect(mcpServerId("claude.ai monday.com")).toBe("claude_ai_monday_com");
    expect(mcpServerId("plugin:1password:1password")).toBe("plugin_1password_1password");
    expect(mcpServerId("ask-grip")).toBe("ask-grip");
  });

  it("calls a tool read-only only when its server says so and not also destructive", () => {
    expect(isReadOnly({ readOnly: true })).toBe(true);
    expect(isReadOnly({ readOnlyHint: true })).toBe(true);
    expect(isReadOnly({ readOnly: true, destructive: true })).toBe(false);
    expect(isReadOnly({})).toBe(false);
    expect(isReadOnly(undefined)).toBe(false);
    expect(isReadOnly({ openWorld: true })).toBe(false);
  });

  it("keeps a server's id, label, status and tools, and nothing of its address or config", () => {
    const list = connectorsFrom(SERVERS);
    expect(list.map((c: { label: string }) => c.label)).toEqual(["Slack", "Linear", "Wiz"]);
    expect(list[0].tools).toEqual([
      { name: SEARCH, title: "slack_search_public", readOnly: true },
      { name: "mcp__claude_ai_Slack__slack_send_message", title: "slack_send_message", readOnly: false },
      { name: "mcp__claude_ai_Slack__slack_update_canvas", title: "slack_update_canvas", readOnly: false },
    ]);
    expect(JSON.stringify(list)).not.toContain("secret.example");
    expect(list[2]).toMatchObject({ server: "claude_ai_Wiz", status: "needs-auth", tools: [] });
  });

  it("denies whole servers with nothing allowed and the other tools of a server with something allowed", () => {
    const deny = denyList(connectorsFrom(SERVERS), [SEARCH]);
    expect(deny).toEqual(expect.arrayContaining([
      "mcp__claude_ai_Slack__slack_send_message", "mcp__claude_ai_Slack__slack_update_canvas",
      "mcp__claude_ai_Linear", "mcp__claude_ai_Wiz",
    ]));
    expect(deny).not.toContain(SEARCH);
    expect(deny).not.toContain("mcp__claude_ai_Slack");
  });

  it("reads one JSON object out of an answer, fenced or with words around it, and nothing else", () => {
    expect(oneJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(oneJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(oneJsonObject('Here you go: {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
    expect(oneJsonObject("[1,2]")).toBeNull();
    expect(oneJsonObject("no json here")).toBeNull();
  });

  it("starts the run without the deck's variables or another session's markers, and with the hook's quiet marker", () => {
    const env = agentEnv({ PATH: "/bin", CLAUDE_CONFIG_DIR: "/c", CCDECK_HOME: "/h", AGENTS_DECK_NO_LAN: "1", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "x" });
    expect(env).toMatchObject({ PATH: "/bin", CLAUDE_CONFIG_DIR: "/c", AGENTS_DECK_INTERNAL: "1" });
    expect(env).not.toHaveProperty("CCDECK_HOME");
    expect(env).not.toHaveProperty("AGENTS_DECK_NO_LAN");
    expect(env).not.toHaveProperty("CLAUDECODE");
    expect(env).not.toHaveProperty("CLAUDE_CODE_SESSION_ID");
  });
});

describe.skipIf(isWin)("a run against a fake claude", () => {
  beforeEach(() => { /* each case builds its own folder */ });

  it("answers with the one JSON object, the usage, and the prompt sent over stdin rather than argv", async () => {
    const { agent, entries, dataDir } = setup({ answer: '{"title": "Fix the login bug"}' });
    const prompt = "Name this group of sessions: PROMPT-MARKER-91";
    const r = await agent.runAgent({ prompt, tag: "goal-titles" });
    expect(r).toMatchObject({ ok: true, json: { title: "Fix the login bug" } });
    expect(r.usage).toMatchObject({ costUsd: 0.0123, inputTokens: 10, outputTokens: 20, turns: 2, toolCalls: 0, model: "claude-haiku-test" });
    const log = entries();
    const start = log.find(e => e.start);
    expect(start.argv.join(" ")).not.toContain("PROMPT-MARKER-91");
    expect(start.argv).toContain("--strict-mcp-config");
    expect(start.internal).toBe("1");
    expect(start.leaked).toEqual([]);
    expect(start.cwd.endsWith(join("data", "agent"))).toBe(true);
    expect(log.find(e => e.prompt)?.prompt).toBe(prompt);
    expect(dataDir).toBeTruthy();
    const ledger = agent.recentRuns();
    expect(ledger[0]).toMatchObject({ ok: true, tag: "goal-titles", costUsd: 0.0123 });
    expect(JSON.stringify(ledger)).not.toContain("PROMPT-MARKER-91");
    expect(JSON.stringify(ledger)).not.toContain("login bug");
  });

  it("takes the structured answer when a schema was given", async () => {
    const { agent, entries } = setup({ answer: "", structured: { title: "From the schema" } });
    const r = await agent.runAgent({ prompt: "x", schema: { type: "object", properties: { title: { type: "string" } } } });
    expect(r).toMatchObject({ ok: true, json: { title: "From the schema" } });
    expect(entries().find(e => e.start).argv).toContain("--json-schema");
  });

  it("says bad_json when the answer is not one JSON object", async () => {
    const { agent } = setup({ answer: "Sure! The title is Fix the login bug." });
    expect(await agent.runAgent({ prompt: "x" })).toMatchObject({ ok: false, code: "bad_json" });
  });

  it("starts nothing under AGENTS_DECK_NO_AGENT=1", async () => {
    const { agent, entries } = setup({}, { env: { [AGENT_VETO_ENV]: "1" } });
    expect(await agent.runAgent({ prompt: "x" })).toMatchObject({ ok: false, code: "vetoed" });
    expect(await agent.listConnectors()).toEqual([]);
    expect(entries()).toEqual([]);
  });

  it("says claude_missing when there is no claude to run", async () => {
    const { agent } = setup({}, { bin: join(ROOT, "no-such-claude") });
    expect(await agent.runAgent({ prompt: "x" })).toMatchObject({ ok: false, code: "claude_missing" });
  });

  it("says not_signed_in before sending anything when Claude Code has no login", async () => {
    const { agent, entries } = setup({ account: { tokenSource: "none", apiProvider: "firstParty" } });
    expect(await agent.runAgent({ prompt: "x" })).toMatchObject({ ok: false, code: "not_signed_in" });
    expect(entries().some(e => e.prompt)).toBe(false);
  });

  it("refuses a tool nobody enabled in Settings, without starting claude", async () => {
    const { agent, entries } = setup();
    expect(await agent.runAgent({ prompt: "x", tools: [SEARCH] })).toMatchObject({ ok: false, code: "tool_not_enabled" });
    expect(entries()).toEqual([]);
  });

  it("refuses names that are not connector tools", async () => {
    const { agent } = setup();
    for (const tools of [["Bash"], ["Edit"], ["WebFetch"], ["mcp__x"], [""]]) {
      expect(await agent.runAgent({ prompt: "x", tools })).toMatchObject({ ok: false, code: "bad_request" });
    }
  });

  it("lets only a read-only tool be enabled", async () => {
    const { agent } = setup();
    const r = await agent.setEnabledTools([SEARCH, "mcp__claude_ai_Slack__slack_send_message", "mcp__claude_ai_Slack__slack_update_canvas", "Bash"]);
    expect(r).toMatchObject({ ok: true, enabled: [SEARCH] });
    expect(r.refused).toHaveLength(3);
    expect(await agent.enabledTools()).toEqual([SEARCH]);
  });

  it("runs an enabled read-only tool with it alone allowed and every other tool denied", async () => {
    const { agent, entries } = setup({ toolUses: [SEARCH], answer: '{"hits": 3}' });
    await agent.setEnabledTools([SEARCH]);
    const r = await agent.runAgent({ prompt: "x", tools: [SEARCH] });
    expect(r).toMatchObject({ ok: true, json: { hits: 3 } });
    expect(r.usage.toolCalls).toBe(1);
    const run = entries().filter(e => e.start).at(-1);
    expect(run.argv[run.argv.indexOf("--allowedTools") + 1]).toBe(SEARCH);
    const deny = run.argv[run.argv.indexOf("--disallowedTools") + 1].split(",");
    expect(deny).toEqual(expect.arrayContaining(["mcp__claude_ai_Slack__slack_send_message", "mcp__claude_ai_Linear", "mcp__claude_ai_Wiz"]));
    expect(run.argv).not.toContain("--strict-mcp-config");
  });

  it("ends the run when Claude Code offers the model a tool outside the allowlist", async () => {
    const { agent, entries } = setup({ offer: [SEARCH, "mcp__claude_ai_Slack__slack_send_message"], delayMs: 3_000 });
    await agent.setEnabledTools([SEARCH]);
    const r = await agent.runAgent({ prompt: "x", tools: [SEARCH] });
    expect(r).toMatchObject({ ok: false, code: "tool_violation" });
    expect(entries().some(e => e.end)).toBe(false);
  });

  it("ends the run when the model calls a tool outside the allowlist", async () => {
    const { agent } = setup({ toolUses: ["mcp__claude_ai_Slack__slack_send_message"], delayMs: 3_000 });
    await agent.setEnabledTools([SEARCH]);
    expect(await agent.runAgent({ prompt: "x", tools: [SEARCH] })).toMatchObject({ ok: false, code: "tool_violation" });
  });

  it("refuses a tool whose server stopped calling it read-only since it was enabled", async () => {
    const { agent, scenarioFile } = setup();
    await agent.setEnabledTools([SEARCH]);
    const changed = structuredClone(SERVERS);
    changed[0].tools[0].annotations = { openWorld: true };
    writeFileSync(scenarioFile, JSON.stringify({ servers: changed }));
    agent.forgetListing();
    expect(await agent.runAgent({ prompt: "x", tools: [SEARCH] })).toMatchObject({ ok: false, code: "not_read_only" });
  });

  it("gives up at its deadline and kills the run", async () => {
    const { agent } = setup({ hang: true });
    const t0 = Date.now();
    expect(await agent.runAgent({ prompt: "x", timeoutMs: 1_000 })).toMatchObject({ ok: false, code: "timeout" });
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("stops when the caller aborts", async () => {
    const { agent } = setup({ hang: true });
    const ac = new AbortController();
    const p = agent.runAgent({ prompt: "x", signal: ac.signal });
    setTimeout(() => ac.abort(), 300);
    expect(await p).toMatchObject({ ok: false, code: "aborted" });
  });

  it("runs one at a time", async () => {
    const { agent, entries } = setup({ delayMs: 400 });
    const [a, b] = await Promise.all([agent.runAgent({ prompt: "one" }), agent.runAgent({ prompt: "two" })]);
    expect(a.ok && b.ok).toBe(true);
    const log = entries();
    const starts = log.filter(e => e.start);
    const ends = log.filter(e => e.end);
    expect(starts).toHaveLength(2);
    expect(starts[1].at).toBeGreaterThanOrEqual(ends[0].at);
  });

  it("says why when claude dies before it answers", async () => {
    const { agent } = setup({ exitAtOnce: 1, stderr: "Not logged in · Please run /login\n" });
    expect(await agent.runAgent({ prompt: "x" })).toMatchObject({ ok: false, code: "not_signed_in" });
  });

  it("lists the connectors with their read-only tools, and why when it cannot", async () => {
    const { agent } = setup();
    const list = await agent.listConnectors();
    expect(list.map((c: { server: string }) => c.server)).toEqual(["claude_ai_Slack", "claude_ai_Linear", "claude_ai_Wiz"]);
    expect(JSON.stringify(list)).not.toContain("secret.example");
    const signedOut = setup({ account: { tokenSource: "none" } });
    expect(await signedOut.agent.connectorsState()).toMatchObject({ code: "not_signed_in", connectors: [] });
  });
});
