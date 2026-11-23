// The bridge to the person's own Claude connectors (claude-agent.mjs), run
// against a fake `claude` that speaks the same stream-json control protocol:
// initialize, mcp_status, a user turn, an init message, tool uses and a
// result. Every scenario is a JSON file the fake reads, and every run of the
// fake appends what it was given — argv, cwd, the hook marker, the prompt it
// read from stdin — to a log the assertions read back.
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn as nodeSpawn } from "node:child_process";
import { join } from "node:path";
import { rmTempDir } from "./rm-temp-dir";

// @ts-expect-error — .mjs server module, no types
const agentModule = await import("../../server/claude-agent.mjs");
const {
  createClaudeAgent, agentArgs, agentEnv, mcpServerId, isReadOnly, connectorsFrom, denyList, oneJsonObject,
  SYSTEM_PROMPT, AGENT_VETO_ENV, BUILTIN_TOOLS,
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
        log({ end: true });
        out({ type: "result", subtype: scenario.subtype ?? "success", is_error: scenario.isError ?? false,
          result: scenario.answer ?? "{\\"ok\\": true}", total_cost_usd: 0.0123, num_turns: 2, duration_ms: 900,
          usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
          modelUsage: { "claude-haiku-test": {} }, ...(scenario.structured ? { structured_output: scenario.structured } : {}) });
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
const SEND = "mcp__claude_ai_Slack__slack_send_message";
const CANVAS = "mcp__claude_ai_Slack__slack_update_canvas";
const ISSUES = "mcp__claude_ai_Linear__list_issues";

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
  // The fake is run through node itself rather than by its shebang, so the
  // same cases run on Windows, which has no shebangs; any other `bin` (the
  // missing one) is spawned as the bridge would spawn it.
  const spawn = (file: string, args: string[], o: object) => file === FAKE ? nodeSpawn(process.execPath, [FAKE, ...args], o) : nodeSpawn(file, args, o);
  const agent = createClaudeAgent({ env, bin: () => (opts.bin as string) ?? FAKE, dataDir: () => dataDir, pollMs: 20, mcpWaitMs: 2_000, spawn });
  const entries = () => existsSync(logFile)
    ? readFileSync(logFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
  return { agent, entries, dataDir, scenarioFile };
}

describe("the argument vector", () => {
  it("is a run with no tools and no MCP servers when it is given none, and never carries the prompt", () => {
    const args: string[] = agentArgs({ model: "haiku" });
    for (const flag of ["-p", "--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config"]) {
      expect(args).toContain(flag);
    }
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args[args.indexOf("--permission-prompts") + 1]).toBe("none");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe(SYSTEM_PROMPT);
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--restricted");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("offers the built-in tools it is given, keeps Claude Code's own prompt for them, and names the allowlist and the deny list", () => {
    const args: string[] = agentArgs({ builtins: ["Bash", "Read"], allow: ["Bash", "Read", SEARCH], deny: ["mcp__claude_ai_Linear", SEND] });
    expect(args[args.indexOf("--tools") + 1]).toBe("Bash,Read");
    expect(args[args.indexOf("--append-system-prompt") + 1]).toBe(SYSTEM_PROMPT);
    expect(args).not.toContain("--system-prompt");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(`Bash,Read,${SEARCH}`);
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe(`mcp__claude_ai_Linear,${SEND}`);
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).toContain("--disable-slash-commands");
    expect(agentArgs({ builtins: ["Skill"], allow: ["Skill"] })).not.toContain("--disable-slash-commands");
  });

  it("is the bare protocol for a listing, which sends no prompt and names no model", () => {
    const args: string[] = agentArgs({ listing: true });
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--system-prompt");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
  });

  it("knows Claude Code's own tools, and which of them only read", () => {
    const names = BUILTIN_TOOLS.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Bash", "Edit", "Write", "Read", "Task", "Skill", "WebSearch"]));
    expect(BUILTIN_TOOLS.find((t: { name: string }) => t.name === "Read").readOnly).toBe(true);
    expect(BUILTIN_TOOLS.find((t: { name: string }) => t.name === "Bash").readOnly).toBe(false);
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

describe("a run against a fake claude", () => {
  beforeEach(() => { /* each case builds its own folder */ });

  it("answers with the one JSON object, the usage, and the prompt sent over stdin rather than argv", async () => {
    const { agent, entries, dataDir } = setup({ answer: '{"title": "Fix the login bug"}' });
    const prompt = "Name this group of sessions: PROMPT-MARKER-91";
    const r = await agent.runAgent({ prompt, tag: "goal-titles", tools: [] });
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
    const r = await agent.runAgent({ prompt: "x", tools: [], schema: { type: "object", properties: { title: { type: "string" } } } });
    expect(r).toMatchObject({ ok: true, json: { title: "From the schema" } });
    expect(entries().find(e => e.start).argv).toContain("--json-schema");
  });

  it("says bad_json when the answer is not one JSON object", async () => {
    const { agent } = setup({ answer: "Sure! The title is Fix the login bug." });
    expect(await agent.runAgent({ prompt: "x", tools: [] })).toMatchObject({ ok: false, code: "bad_json" });
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

  it("refuses a tool the person switched off, without starting claude", async () => {
    const { agent, entries } = setup();
    await agent.setOffTools([SEND, "Bash"]);
    expect(await agent.runAgent({ prompt: "x", tools: [SEND] })).toMatchObject({ ok: false, code: "tool_not_enabled" });
    expect(await agent.runAgent({ prompt: "x", tools: ["Bash"] })).toMatchObject({ ok: false, code: "tool_not_enabled" });
    expect(entries()).toEqual([]);
  });

  it("refuses names that are not tool names", async () => {
    const { agent } = setup();
    for (const tools of [["WebFetch"], ["bash"], ["mcp__x"], [""], ["rm -rf /"], "everything"]) {
      expect(await agent.runAgent({ prompt: "x", tools }), JSON.stringify(tools)).toMatchObject({ ok: false, code: "bad_request" });
    }
  });

  it("has every tool on until it is switched off, built-in or connector", async () => {
    const { agent } = setup();
    await agent.listConnectors();
    const on = await agent.enabledTools();
    expect(on).toEqual(expect.arrayContaining(["Bash", "Edit", SEARCH, SEND, CANVAS, ISSUES]));
    const r = await agent.setOffTools(["Bash", SEND, "not a tool"]);
    expect(r).toMatchObject({ ok: true, off: ["Bash", SEND].sort(), refused: ["not a tool"] });
    expect(await agent.enabledTools()).not.toContain("Bash");
    expect(await agent.enabledTools()).not.toContain(SEND);
    expect((await agent.connectorsState()).off).toEqual(["Bash", SEND].sort());
    await agent.setOffTools([]);
    expect(await agent.enabledTools()).toEqual(on);
  });

  it("gives a run every tool that is on by default, and denies what is off", async () => {
    const { agent, entries } = setup({ offer: ["Bash", "Read", SEARCH, ISSUES], toolUses: ["Bash", ISSUES], answer: '{"done": true}' });
    await agent.setOffTools(["Edit", CANVAS]);
    const r = await agent.runAgent({ prompt: "x" });
    expect(r).toMatchObject({ ok: true, json: { done: true } });
    expect(r.usage.tools).toEqual(["Bash", ISSUES]);
    const run = entries().filter(e => e.start).at(-1);
    const builtins = run.argv[run.argv.indexOf("--tools") + 1].split(",");
    expect(builtins).toEqual(expect.arrayContaining(["Bash", "Read", "Write", "Task"]));
    expect(builtins).not.toContain("Edit");
    const allow = run.argv[run.argv.indexOf("--allowedTools") + 1].split(",");
    expect(allow).toEqual(expect.arrayContaining(["Bash", "mcp__claude_ai_Slack", "mcp__claude_ai_Linear"]));
    expect(allow).not.toContain("mcp__claude_ai_Wiz");
    expect(run.argv[run.argv.indexOf("--disallowedTools") + 1].split(",").sort()).toEqual(["Edit", CANVAS].sort());
    expect(run.argv).toContain("--append-system-prompt");
    expect(run.argv).not.toContain("--strict-mcp-config");
    expect(agent.recentRuns()[0]).toMatchObject({ ok: true, tools: ["Bash", ISSUES] });
  });

  it("ends a run given everything when Claude Code offers a tool that is switched off", async () => {
    const { agent } = setup({ offer: [SEARCH, SEND], delayMs: 3_000 });
    await agent.setOffTools([SEND]);
    expect(await agent.runAgent({ prompt: "x" })).toMatchObject({ ok: false, code: "tool_violation" });
  });

  it("runs named tools alone, a connector tool that can write and a built-in one, with every other tool denied", async () => {
    const { agent, entries } = setup({ offer: [SEND, "Bash"], toolUses: [SEND], answer: '{"sent": true}' });
    const r = await agent.runAgent({ prompt: "x", tools: [SEND, "Bash"] });
    expect(r).toMatchObject({ ok: true, json: { sent: true } });
    expect(r.usage.toolCalls).toBe(1);
    const run = entries().filter(e => e.start).at(-1);
    expect(run.argv[run.argv.indexOf("--tools") + 1]).toBe("Bash");
    expect(run.argv[run.argv.indexOf("--allowedTools") + 1]).toBe(`${SEND},Bash`);
    const deny = run.argv[run.argv.indexOf("--disallowedTools") + 1].split(",");
    expect(deny).toEqual(expect.arrayContaining([SEARCH, CANVAS, "mcp__claude_ai_Linear", "mcp__claude_ai_Wiz"]));
    expect(run.argv).not.toContain("--strict-mcp-config");
  });

  it("ends the run when Claude Code offers the model a tool it was not given", async () => {
    const { agent, entries } = setup({ offer: [SEARCH, SEND], delayMs: 3_000 });
    const r = await agent.runAgent({ prompt: "x", tools: [SEARCH] });
    expect(r).toMatchObject({ ok: false, code: "tool_violation" });
    expect(entries().some(e => e.end)).toBe(false);
  });

  it("ends the run when the model calls a tool it was not given", async () => {
    const { agent } = setup({ offer: [SEARCH], toolUses: [SEND], delayMs: 3_000 });
    expect(await agent.runAgent({ prompt: "x", tools: [SEARCH] })).toMatchObject({ ok: false, code: "tool_violation" });
  });

  it("says tool_unavailable when a named connector tool is not there", async () => {
    const { agent } = setup();
    expect(await agent.runAgent({ prompt: "x", tools: ["mcp__claude_ai_Slack__slack_gone"] })).toMatchObject({ ok: false, code: "tool_unavailable" });
  });

  it("gives up at its deadline and kills the run", async () => {
    const { agent } = setup({ hang: true });
    const t0 = Date.now();
    expect(await agent.runAgent({ prompt: "x", tools: [], timeoutMs: 1_000 })).toMatchObject({ ok: false, code: "timeout" });
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("stops when the caller aborts", async () => {
    const { agent } = setup({ hang: true });
    const ac = new AbortController();
    const p = agent.runAgent({ prompt: "x", tools: [], signal: ac.signal });
    setTimeout(() => ac.abort(), 300);
    expect(await p).toMatchObject({ ok: false, code: "aborted" });
  });

  it("runs one at a time", async () => {
    const { agent, entries } = setup({ delayMs: 400 });
    const [a, b] = await Promise.all([agent.runAgent({ prompt: "one", tools: [] }), agent.runAgent({ prompt: "two", tools: [] })]);
    expect(a.ok && b.ok).toBe(true);
    const log = entries();
    const starts = log.filter(e => e.start);
    const ends = log.filter(e => e.end);
    expect(starts).toHaveLength(2);
    expect(starts[1].at).toBeGreaterThanOrEqual(ends[0].at);
  });

  it("says why when claude dies before it answers", async () => {
    const { agent } = setup({ exitAtOnce: 1, stderr: "Not logged in · Please run /login\n" });
    expect(await agent.runAgent({ prompt: "x", tools: [] })).toMatchObject({ ok: false, code: "not_signed_in" });
  });

  it("lists Claude Code's own tools first, then the connectors, and why when it cannot", async () => {
    const { agent } = setup();
    const list = await agent.listConnectors();
    expect(list.map((c: { server: string }) => c.server)).toEqual(["builtin", "claude_ai_Slack", "claude_ai_Linear", "claude_ai_Wiz"]);
    expect(JSON.stringify(list)).not.toContain("secret.example");
    const signedOut = setup({ account: { tokenSource: "none" } });
    const state = await signedOut.agent.connectorsState();
    expect(state).toMatchObject({ code: "not_signed_in" });
    expect(state.connectors.map((c: { server: string }) => c.server)).toEqual(["builtin"]);
  });
});

// @ts-expect-error — .mjs server module, no types
const { handleConnectorsRead, handleConnectorsWrite, CONNECTORS_ROUTE } = await import("../../server/connectors-routes.mjs");
// @ts-expect-error — .mjs server module, no types
const { GUARDED_READS, OPEN_MUTATIONS } = await import("../../server/request-gates.mjs");
const { Readable } = await import("node:stream");

function call(method: string, { body, query = "", remoteAddress = "127.0.0.1", agent }: { body?: unknown; query?: string; remoteAddress?: string; agent: object }) {
  const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))]), {
    method, headers: {}, socket: { remoteAddress },
  });
  let status = 0, text = "";
  const res = { headersSent: false, writeHead: (s: number) => { status = s; }, end: (s: string) => { text = s; } };
  const handled = method === "POST" ? handleConnectorsWrite(req, res, agent)
    : handleConnectorsRead(req, res, new URL(`http://127.0.0.1${CONNECTORS_ROUTE}${query}`), agent);
  return handled.then(() => ({ status, body: JSON.parse(text) }));
}

describe("GET and POST /api/connectors", () => {
  const seen: unknown[] = [];
  const agent = {
    connectorsState: async (opts: unknown) => { seen.push(opts); return { vetoed: false, code: "", error: "", connectors: [], enabled: ["a"], runs: [] }; },
    setEnabledTools: async (tools: unknown) => Array.isArray(tools) ? { ok: true, enabled: [], refused: tools } : { ok: false, code: "bad_request", error: "tools must be a list" },
    setOffTools: async (off: unknown) => ({ ok: true, off, refused: [] }),
  };

  it("is a guarded read and a gated write, wired into the server", () => {
    expect(GUARDED_READS.has(CONNECTORS_ROUTE)).toBe(true);
    expect(OPEN_MUTATIONS.has(CONNECTORS_ROUTE)).toBe(false);
    const index = readFileSync(new URL("../../server/index.mjs", import.meta.url), "utf8");
    expect(index).toContain('url.pathname === "/api/connectors") return guard(handleConnectorsRead(req, res, url), res);');
    expect(index).toContain('url.pathname === "/api/connectors") return guard(handleConnectorsWrite(req, res), res);');
  });

  it("answers this computer only", async () => {
    for (const method of ["GET", "POST"]) {
      expect((await call(method, { body: { tools: [] }, remoteAddress: "192.0.2.10", agent })).status).toBe(403);
    }
  });

  it("lists, lists again on refresh=1, and saves with what was refused said back", async () => {
    expect(await call("GET", { agent })).toMatchObject({ status: 200, body: { ok: true, enabled: ["a"] } });
    await call("GET", { query: "?refresh=1", agent });
    expect(seen.slice(-2)).toEqual([{ refresh: false }, { refresh: true }]);
    expect(await call("POST", { body: { tools: ["mcp__x__y"] }, agent })).toMatchObject({ status: 200, body: { ok: true, refused: ["mcp__x__y"] } });
    expect((await call("POST", { body: "not json", agent })).status).toBe(400);
    expect(await call("POST", { body: { off: ["Bash"] }, agent })).toMatchObject({ status: 200, body: { ok: true, refused: [] } });
  });
});

describe("Settings › Connectors' own sums", async () => {
  const { money, splitConnectors, flipped } = await import("../components/ConnectorsSection");
  it("prints a cost in cents, or to four places under a cent", () => {
    expect(money(0)).toBe("$0.00");
    expect(money(0.0025)).toBe("$0.0025");
    expect(money(0.42)).toBe("$0.42");
    expect(money(Number.NaN)).toBe("$0.00");
  });
  it("draws a group for every connected connector with tools, and names the rest", () => {
    const servers = [...SERVERS, { name: "claude.ai PostHog", status: "connected", source: "claudeai", tools: [{ name: "docs-search", annotations: { openWorld: true } }] }];
    const { reachable, offline } = splitConnectors(connectorsFrom(servers));
    expect(reachable.map(c => c.label)).toEqual(["Slack", "Linear", "PostHog"]);
    expect(offline).toEqual(["Wiz"]);
  });
  it("switches one tool the other way", () => {
    expect(flipped(["Bash"], "Bash")).toEqual([]);
    expect(flipped(["Bash"], "Edit")).toEqual(["Bash", "Edit"]);
  });
});
