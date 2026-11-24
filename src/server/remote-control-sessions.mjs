// The person's Claude Remote Control sessions on their other machines, listed
// read-only, each with the link that opens it in Claude (claude.ai/code or the
// desktop app), where the person prompts it and approves its tools.
//
// WHY OVER SSH. A machine that runs Remote Control sessions (the owner's
// ThinkPad runs them under a systemd service, with no deck of its own) knows
// them as Claude Code sessions: `claude agents --json` lists each one with its
// id, name, state and folder, and a Remote Control session's folder carries its
// cloud id, `cse_<id>`. The cloud's own list (claude.ai's /v1/code/sessions)
// needs Claude Code's OAuth token, which on macOS sits in the Keychain and which
// the deck does not read (owner's choice, 2026-11-24: option 2). So the deck
// asks each machine the person names over ssh, with the key and the host alias
// this Mac already has, and never holds a credential of its own for it.
//
// WHAT RUNS THERE. One fixed script per poll (REMOTE_SCRIPT): `claude agents
// --json`, then the naming lines (custom-title, agent-name, ai-title) of each
// listed Remote Control session's transcript, found by its cloud id, and its first prompt — the same records the deck reads for
// its own sessions (transcript-scan.mjs). Nothing the deck or a page sends is
// spliced into it: the host alias is held to SAFE_HOST and passed after `--`,
// and the script is a constant. It writes nothing, starts nothing, and sends
// nothing to any session.
//
// THE LINK. Claude Code's own rule (2.1.327, `toCompatSessionId`): a cloud id
// `cse_X` is the session `session_X`, opened at https://claude.ai/code/session_X.
//
// HOW OFTEN. At most once per LIST_TTL_MS per page ask, one ssh per host, and
// one listing at a time: a page that asks while one runs shares it.
//
// OFF SWITCHES. AGENTS_DECK_NO_REMOTE_CONTROL=1, or AGENTS_DECK_NO_AGENT=1 (the
// deck's veto on running the person's Claude Code at all), and no machine is
// ever asked. With AGENTS_DECK_REMOTE_CONTROL_HOSTS unset there is nothing to
// ask either.
import { run as execRun } from "./exec.mjs";

export const REMOTE_CONTROL_VETO_ENV = "AGENTS_DECK_NO_REMOTE_CONTROL";
export const REMOTE_CONTROL_HOSTS_ENV = "AGENTS_DECK_REMOTE_CONTROL_HOSTS";
export const LIST_TTL_MS = 30_000;
export const SSH_TIMEOUT_MS = 15_000;
export const MAX_HOSTS = 8;
export const MAX_SESSIONS = 200;
const TITLE_MARK = "@@ccdeck-titles@@";

/** An ssh destination as typed in ~/.ssh/config or as user@host: letters,
 *  digits and `._@-`, never starting with `-` (which ssh would read as an
 *  option). Anything else is dropped, not quoted. */
const SAFE_HOST = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,120}$/;
/** A Remote Control session's cloud id, as it appears in its folder's name. */
const CSE = /cse_([A-Za-z0-9]{10,64})/;

/**
 * Run on the remote machine by its login shell. `claude` is looked for where
 * its installer puts it as well as on PATH, since a non-interactive ssh shell
 * reads no profile. Prints the agents' JSON, the mark, then one line per naming
 * record, `<cloud id>\t<the JSONL line>`, and one for the first prompt,
 * `<cloud id>\tprompt\t<the JSONL line>`.
 */
export const REMOTE_SCRIPT = [
  'PATH="$HOME/.local/bin:$HOME/.claude/local:$PATH"',
  "out=$(claude agents --json 2>/dev/null) || out='[]'",
  'printf "%s\\n" "$out"',
  `echo '${TITLE_MARK}'`,
  'dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"',
  // A Remote Control session's transcript is the newest one in the project
  // folder named after its cloud id (…-bridge-cse-<id>); its file name is a
  // conversation id of its own, not the `sessionId` the agents list gives.
  "for c in $(printf '%s' \"$out\" | grep -o 'cse_[A-Za-z0-9]*' | cut -c5- | sort -u | head -n 200); do",
  "  f=$(ls -t \"$dir\"/*-cse-\"$c\"/*.jsonl 2>/dev/null | head -n 1)",
  "  [ -n \"$f\" ] || continue",
  "  grep -h -E '\"type\":\"(custom-title|agent-name|ai-title)\"' \"$f\" 2>/dev/null | tail -n 6 | while IFS= read -r l; do printf '%s\\t%s\\n' \"$c\" \"$l\"; done",
  "  grep -m 1 -h '\"type\":\"user\"' \"$f\" 2>/dev/null | cut -c1-6000 | while IFS= read -r l; do printf '%s\\tprompt\\t%s\\n' \"$c\" \"$l\"; done",
  "done",
].join("\n");

export function remoteControlVetoed(env = process.env) {
  return env?.[REMOTE_CONTROL_VETO_ENV] === "1" || env?.AGENTS_DECK_NO_AGENT === "1";
}

/** The machines to ask, from AGENTS_DECK_REMOTE_CONTROL_HOSTS (commas or spaces). */
export function remoteHosts(env = process.env) {
  const raw = typeof env?.[REMOTE_CONTROL_HOSTS_ENV] === "string" ? env[REMOTE_CONTROL_HOSTS_ENV] : "";
  return [...new Set(raw.split(/[\s,]+/).filter(h => SAFE_HOST.test(h)))].slice(0, MAX_HOSTS);
}

/** ssh's argument vector: never a prompt (BatchMode), a short connect, no tty,
 *  and the host after `--`. */
export function sshArgs(host) {
  return ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
    "-T", "--", host, REMOTE_SCRIPT];
}

/** The page's link for a cloud id: claude.ai's own `session_` form. */
export function sessionUrl(cseId) {
  return `https://claude.ai/code/session_${cseId}`;
}

/** The newest title a session's naming lines give, by Claude Code's order:
 *  the name given to it, then its short name, then the sentence. */
function titleFrom(lines) {
  let custom = "", agent = "", ai = "";
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const pick = v => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 200) : "");
    if (o?.type === "custom-title" && pick(o.customTitle)) custom = pick(o.customTitle);
    else if (o?.type === "agent-name" && pick(o.agentName)) agent = pick(o.agentName);
    else if (o?.type === "ai-title" && pick(o.aiTitle)) ai = pick(o.aiTitle);
  }
  return custom || agent || ai;
}

/** A session's first prompt as a title, the way Claude Desktop titles one it
 *  has not named: its first line, cut at PROMPT_TITLE_MAX. The line may have
 *  been cut at 6000 bytes on the way, so a line that is no longer JSON gives
 *  its `content` string as far as it goes. */
export const PROMPT_TITLE_MAX = 60;
function promptFrom(line) {
  let text = "";
  try {
    const c = JSON.parse(line)?.message?.content;
    text = typeof c === "string" ? c : Array.isArray(c) ? (c.find(b => b?.type === "text")?.text ?? "") : "";
  } catch {
    const m = /"content":"((?:[^"\\]|\\.){1,400})/.exec(line);
    if (m) { try { text = JSON.parse(`"${m[1]}"`); } catch { text = m[1]; } }
  }
  // A link's query string can carry a key (an artifact's `?sk=`): never shown.
  const first = (String(text).split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? "")
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/gi, "$1");
  if (!first || first.startsWith("<")) return "";   // a command or a notice, not a prompt
  return first.length > PROMPT_TITLE_MAX ? `${first.slice(0, PROMPT_TITLE_MAX - 1)}…` : first;
}

/**
 * One machine's answer to REMOTE_SCRIPT, as the page shows it: its Remote
 * Control sessions only (those whose folder carries a `cse_` id), newest first,
 * each `{ id, title, status, startedAt, url }`. Other sessions on that machine
 * — a terminal someone opened there — are not Remote Control's and are left out.
 */
export function parseRemoteListing(stdout) {
  const text = typeof stdout === "string" ? stdout : "";
  const cut = text.indexOf(`\n${TITLE_MARK}\n`);
  const head = cut >= 0 ? text.slice(0, cut) : text;
  const tail = cut >= 0 ? text.slice(cut + TITLE_MARK.length + 2) : "";
  let agents;
  try { agents = JSON.parse(head.trim() || "[]"); } catch { return null; }
  if (!Array.isArray(agents)) return null;
  const naming = new Map();
  const prompts = new Map();
  for (const line of tail.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const sid = line.slice(0, tab);
    if (!/^[A-Za-z0-9]{10,64}$/.test(sid)) continue;
    const rest = line.slice(tab + 1);
    if (rest.startsWith("prompt\t")) { if (!prompts.has(sid)) prompts.set(sid, promptFrom(rest.slice(7))); continue; }
    if (!naming.has(sid)) naming.set(sid, []);
    naming.get(sid).push(rest);
  }
  const sessions = [];
  for (const a of agents) {
    if (!a || typeof a !== "object") continue;
    const cse = CSE.exec(typeof a.cwd === "string" ? a.cwd : "")?.[1];
    if (!cse) continue;
    const name = typeof a.name === "string" ? a.name.trim().slice(0, 200) : "";
    // The service's own placeholder ("bridge-cse-<id>-xx") is no title.
    const ownName = name && !/^bridge-cse-/i.test(name) ? name : "";
    sessions.push({
      id: cse,
      title: titleFrom(naming.get(cse) ?? []) || ownName || prompts.get(cse) || "",
      status: typeof a.status === "string" ? a.status.slice(0, 24) : "unknown",
      startedAt: Number.isFinite(a.startedAt) ? a.startedAt : null,
      url: sessionUrl(cse),
    });
    if (sessions.length >= MAX_SESSIONS) break;
  }
  sessions.sort((x, y) => (y.startedAt ?? 0) - (x.startedAt ?? 0));
  return sessions;
}

/** Why a machine could not be read, in words for the page; never ssh's own
 *  output, which can name paths and keys. */
function reasonOf(r) {
  if (r.code === "ENOENT") return "ssh_missing";
  if (r.timedOut) return "timeout";
  if (/permission denied|host key|authentication/i.test(r.stderr ?? "")) return "ssh_refused";
  if (/could not resolve|no route|connection (refused|timed out)|network is unreachable/i.test(r.stderr ?? "")) return "unreachable";
  return "failed";
}

export function createRemoteControl({ env = process.env, run = execRun, now = Date.now, ttlMs = LIST_TTL_MS } = {}) {
  let cached = null;      // { at, hosts }
  let inflight = null;

  async function listHost(host) {
    const r = await run("ssh", sshArgs(host), { timeout: SSH_TIMEOUT_MS, maxBuffer: 2 << 20 });
    if (!r.ok) return { host, ok: false, reason: reasonOf(r), sessions: [] };
    const sessions = parseRemoteListing(r.stdout);
    if (!sessions) return { host, ok: false, reason: "bad_answer", sessions: [] };
    return { host, ok: true, sessions };
  }

  /** `{ vetoed, hosts: [{ host, ok, reason?, sessions }], listedAt }`. */
  async function state() {
    if (remoteControlVetoed(env)) return { vetoed: true, hosts: [], listedAt: null };
    const hosts = remoteHosts(env);
    if (!hosts.length) return { vetoed: false, hosts: [], listedAt: null };
    if (cached && now() - cached.at < ttlMs) return { vetoed: false, hosts: cached.hosts, listedAt: cached.at };
    inflight ??= Promise.all(hosts.map(listHost))
      .then(listed => { cached = { at: now(), hosts: listed }; return cached; })
      .finally(() => { inflight = null; });
    const done = await inflight;
    return { vetoed: false, hosts: done.hosts, listedAt: done.at };
  }

  return { state, forget() { cached = null; } };
}

const shared = createRemoteControl();
export const remoteControlState = () => shared.state();
