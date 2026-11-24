// A deck terminal that switched conversations with /resume, followed — and a
// conversation left running in two deck terminals, said and, on request, put
// right.
//
// THE BUG. A deck pane carries the session it was started for in its tmux
// option `@ccdeck-session` (terminal-sessions.mjs), and the Command Panel's
// engine finds a card's terminal by that option. Typing /resume inside the
// pane and picking another conversation does not start a new process: the
// same Claude Code ends one session and starts the other. Nothing told the
// pane, so it went on saying the first id: the card of the conversation the
// pane had left opened the live pane, and the card of the one it now held
// opened whatever other pane still said that id — on 2026-11-24, one the deck
// had resumed three hours earlier, still running, idle. Two Claude processes
// on one conversation, and the two cards' terminals crossed.
//
// HOW THE TWO HALVES ARE PAIRED. Read off that day's events.jsonl and the one
// before it, every in-process /resume (4 of 4) is a `SessionEnd` with reason
// `resume` followed 46–239 ms later by a `SessionStart` with source `resume`,
// and both carry the same `prompt_id` — the id of the /resume prompt itself.
// A `claude --resume` that starts a process (38 of them) sends its
// `SessionStart` with no `prompt_id`, and no `SessionEnd` before it. So the
// prompt id pairs the two halves exactly, and nothing else is guessed from
// timing alone: the window below only bounds how long a half waits.
//
// WHAT IS BELIEVED. `POST /api/event` takes no credential (request-gates.mjs,
// OPEN_MUTATIONS), so a pair of events proves nothing by itself. The pane is
// retagged only when Claude Code's own record of the process in it —
// `<config dir>/sessions/<pane pid>.json`, which it rewrites when the process
// changes session (seen on the same day: the pane's process's record named the
// resumed id while the pane still said the old one) — names the new id. A
// forged pair can at most make the deck write down what the pane's own process
// already says. The record can trail the hook by a moment, so it is asked a
// few times before the deck gives up. The pane's pid is the agent's own: the
// engine starts the agent as the pane's process (measured: pane_pid 32139 and
// the record 32139.json). A recycled pid is not checked for: a stale record
// left by an earlier process with the same pid would also have to name the
// very id being resumed.
//
// ONE SESSION, TWO LIVE PANES. After a rebind — or a resume the deck could not
// see — a conversation can be held by two live deck panes. `twins` lists the
// sessions that are, for the card's warning; `closeOlder` closes every pane of
// one such session but the newest, and only when a person asked: the card
// asks before it calls, and nothing here calls it on its own.
//
// ON THE PRODUCT'S PATH, SO NOT THROUGH terminal-sessions.mjs. The JS terminal
// backend is the engine's test oracle and the deck may not import it
// (terminal-js-offpath.test.ts). The few tmux calls here are spelled out
// instead: three client commands on the deck's server, none of which can
// start one. Windows has no deck tmux; everything here is a no-op there.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeConfigDir } from "./claude-dir.mjs";
import { deckDataDir } from "./deck-home.mjs";
import { pathLookup } from "./exec-spec.mjs";
import { run as runCommand } from "./exec.mjs";
import { managedTmuxPath } from "./tmux-download.mjs";

/** How long the first half of a /resume waits for the second. Measured gaps
 *  were 46–239 ms; this is generous, and only bounds memory. */
export const REBIND_WINDOW_MS = 10_000;
/** How long Claude Code's record of the pane's process is waited for to
 *  name the resumed id, and how often it is read meanwhile. */
export const RECORD_WAIT_MS = 3_000;
export const RECORD_POLL_MS = 150;
/** Halves held at most: a /resume is a human's keystroke, not traffic. */
const MAX_PENDING = 64;

/** The deck's own tmux server and the names it gives its own sessions —
 *  terminal-sessions.mjs's DECK_SOCKET and DECK_NAME, which this may not
 *  import. Only a launch or resume pane holds a conversation of its own; an
 *  `att` wrapper holds somebody else's background session. */
export const DECK_SOCKET_NAME = "ccdeck";
const OWN_PANE = /^ccdeck-(?:claude|codex)-[0-9a-f]{8}$/;
const OWN_KINDS = new Set(["launch", "resume"]);
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The tmux user option a deck pane's session id lives in. */
export const SESSION_OPTION = "@ccdeck-session";

const PANE_FORMAT = [
  "#{session_name}", "#{pane_pid}", "#{pane_dead}", "#{session_created}",
  "#{@ccdeck-agent}", "#{@ccdeck-kind}", `#{${SESSION_OPTION}}`,
].join("\t");

export const isSessionId = (id) => typeof id === "string" && SESSION_ID.test(id);
const lower = (s) => String(s ?? "").toLowerCase();

/**
 * Pairs the two halves of an in-process /resume. `note(payload, at)` answers
 * `{ from, to, cwd }` on the half that completes a pair, else null. Pure but
 * for its own memory; either half may arrive first.
 */
export function createResumePairer({ windowMs = REBIND_WINDOW_MS } = {}) {
  const ends = new Map();   // prompt_id → { sessionId, at }
  const starts = new Map(); // prompt_id → { sessionId, at, cwd }
  const sweep = (at) => {
    for (const m of [ends, starts]) {
      for (const [k, v] of m) if (at - v.at > windowMs || v.at - at > windowMs) m.delete(k);
      while (m.size > MAX_PENDING) m.delete(m.keys().next().value);
    }
  };
  return {
    note(p, at) {
      if (!p || typeof p !== "object") return null;
      const name = p.hook_event_name;
      const promptId = typeof p.prompt_id === "string" ? p.prompt_id : "";
      const sessionId = lower(p.session_id);
      if (!promptId || !isSessionId(sessionId)) return null;
      const isEnd = name === "SessionEnd" && p.reason === "resume";
      const isStart = name === "SessionStart" && p.source === "resume";
      if (!isEnd && !isStart) return null;
      sweep(at);
      if (isEnd) {
        const s = starts.get(promptId);
        if (s && s.sessionId !== sessionId) { starts.delete(promptId); return { from: sessionId, to: s.sessionId, cwd: s.cwd }; }
        ends.set(promptId, { sessionId, at });
        return null;
      }
      const e = ends.get(promptId);
      const cwd = typeof p.cwd === "string" ? p.cwd : "";
      if (e && e.sessionId !== sessionId) { ends.delete(promptId); return { from: e.sessionId, to: sessionId, cwd }; }
      starts.set(promptId, { sessionId, at, cwd });
      return null;
    },
  };
}

/** `list-panes -a -F PANE_FORMAT` as the deck's own live-or-dead conversation
 *  panes, first pane of each session only. Pure. */
export function parseOwnPanes(stdout) {
  const out = [];
  const seen = new Set();
  for (const line of String(stdout ?? "").split("\n")) {
    const f = line.split("\t");
    if (f.length < 7) continue;
    const [name, pid, dead, created, agent, kind, label] = f;
    if (!OWN_PANE.test(name) || seen.has(name) || !OWN_KINDS.has(kind)) continue;
    seen.add(name);
    out.push({
      name, agent, kind, label: lower(label),
      pid: Number(pid) || 0, dead: dead === "1", created: (Number(created) || 0) * 1000,
    });
  }
  return out;
}

/** The session Claude Code's record says process `pid` holds, or "" when
 *  there is no record (or it is not that process's). */
export function recordedSession(pid, { claudeDir, readFile }) {
  if (!Number.isInteger(pid) || pid <= 1) return "";
  let raw;
  try { raw = JSON.parse(String(readFile(join(claudeDir, "sessions", `${pid}.json`)))); } catch { return ""; }
  if (!raw || typeof raw !== "object" || raw.pid !== pid) return "";
  return isSessionId(raw.sessionId) ? lower(raw.sessionId) : "";
}

/** Which conversation each live Claude pane holds: its process's record where
 *  there is one, its label otherwise. Codex keeps no record, so its label. */
export function heldBy(pane, io) {
  if (pane.agent === "claude") return recordedSession(pane.pid, io) || pane.label;
  return pane.label;
}

/** Sessions held by more than one live deck pane: `[{ sessionId, panes }]`,
 *  each `panes` newest first. Pure over `held`. */
export function twinGroups(panes, held) {
  const by = new Map();
  for (const p of panes) {
    if (p.dead) continue;
    const sid = held(p);
    if (!isSessionId(sid)) continue;
    if (!by.has(sid)) by.set(sid, []);
    by.get(sid).push(p);
  }
  const out = [];
  for (const [sessionId, list] of by) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.created - a.created || b.name.localeCompare(a.name));
    out.push({ sessionId, panes: list });
  }
  return out;
}

// ---------------------------------------------------------------------------
// tmux, spelled out (see the header for why not through tmux.mjs).

/** tmux.mjs's override, read under the same name and by the same spelling. */
const TMUX_ENV = "CCDECK_TMUX";
const KNOWN_PLACES = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"];
const NO_SERVER = /no server running|error connecting to|failed to connect to server|No such file or directory/i;

/** The tmux binaries worth asking, in tmux.mjs's order: CCDECK_TMUX alone
 *  when set, else PATH, the usual places, then ccdeck's own build. */
export function tmuxCandidates({ env = process.env, platform = process.platform, exists, managed } = {}) {
  const pathEnv = env.PATH ?? env.Path ?? "";
  const look = (bin) => {
    if (!bin) return null;
    if (!bin.includes("/")) return pathLookup(bin, platform, { pathEnv, ...(exists ? { exists } : {}) });
    try { return (exists ?? (() => true))(bin) ? bin : null; } catch { return null; }
  };
  const forced = env[TMUX_ENV]?.trim();
  if (forced) { const at = look(forced); return at ? [at] : []; }
  const out = [];
  for (const bin of ["tmux", ...KNOWN_PLACES, managed ?? managedTmuxPath(deckDataDir(platform, env))]) {
    const at = look(bin);
    if (at && !out.includes(at)) out.push(at);
  }
  return out;
}

/** A client environment: the deck's, minus what would make tmux think it is
 *  nested in some other server. TMUX_TMPDIR stays: it is where the socket is. */
function clientEnv(env) {
  const out = { ...env };
  delete out.TMUX;
  delete out.TMUX_PANE;
  return out;
}

/** The real tmux calls, on the deck's server: `run(args)` answers
 *  `{ ok, stdout, stderr, noServer }`. The first binary that answers — or
 *  says there is no server — is kept; one that cannot talk to this server
 *  (a protocol mismatch) is passed over. */
export function deckTmux({ env = process.env, platform = process.platform, exec = runCommand, socket = DECK_SOCKET_NAME } = {}) {
  let chosen = null;
  const call = async (bin, args) => {
    const r = await exec(bin, ["-u", "-L", socket, ...args], { timeout: 3_000, env: clientEnv(env) });
    const stderr = String(r?.stderr ?? "");
    return { ok: r?.ok === true, stdout: String(r?.stdout ?? ""), stderr, noServer: !r?.ok && NO_SERVER.test(stderr) };
  };
  return {
    async run(args) {
      if (chosen) return call(chosen, args);
      let last = { ok: false, stdout: "", stderr: "tmux is not installed", noServer: true };
      for (const bin of tmuxCandidates({ env, platform })) {
        const r = await call(bin, args);
        if (r.ok || r.noServer) { chosen = bin; return r; }
        last = r;
      }
      return last;
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * The deck's half: `observe` is fed every live hook event (event-pipeline's
 * pushEvent), `twins` and `closeOlder` answer the routes. Every effect is a
 * dependency, so the suite runs it on a recorded sequence with no tmux.
 *
 *   enabled()      the Command Panel's switch: no panel, no deck panes to follow
 *   tmux.run(args) a tmux client on the deck's server (deckTmux)
 *   claudeDir, readFile   where Claude Code's session records are
 *   sleep(ms), log(line)
 */
export function createResumeRebind({
  enabled = () => true,
  platform = process.platform,
  tmux = null,
  claudeDir = null,
  readFile = (p) => readFileSync(p, "utf8"),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref?.()),
  log = () => {},
  recordWaitMs = RECORD_WAIT_MS,
  recordPollMs = RECORD_POLL_MS,
} = {}) {
  const pairer = createResumePairer();
  let client = tmux;
  const io = () => ({ claudeDir: claudeDir ?? claudeConfigDir(), readFile });
  const t = () => (client ??= deckTmux({ platform }));
  const off = () => platform === "win32" || !enabled();

  async function panes() {
    const r = await t().run(["list-panes", "-a", "-F", PANE_FORMAT]);
    if (r.ok) return parseOwnPanes(r.stdout);
    if (r.noServer) return [];
    throw new Error(r.stderr.trim() || "tmux did not answer");
  }

  /** Retag the live Claude pane that held `from` and now, by its own
   *  process's record, holds `to`. Answers the names retagged. */
  async function rebind({ from, to }) {
    const list = (await panes()).filter((p) => !p.dead && p.agent === "claude" && p.label === from);
    if (list.length === 0) return [];
    const done = [];
    const waiting = new Set(list);
    for (let waited = 0; ; waited += recordPollMs) {
      for (const p of [...waiting]) {
        if (recordedSession(p.pid, io()) !== to) continue;
        waiting.delete(p);
        const r = await t().run(["set-option", "-t", `=${p.name}:`, SESSION_OPTION, to]);
        if (r.ok) { done.push(p.name); log(`followed /resume in ${p.name}: ${from.slice(0, 8)} → ${to.slice(0, 8)}`); }
      }
      if (waiting.size === 0 || waited >= recordWaitMs) break;
      await sleep(recordPollMs);
    }
    return done;
  }

  return {
    /** Feed one live hook event. Answers the rebind's promise when this event
     *  completed a /resume pair (for the suite), else null. Never rejects. */
    observe(payload, at = Date.now()) {
      if (off()) return null;
      const pair = pairer.note(payload, at);
      if (!pair) return null;
      return rebind(pair).catch((err) => { log(`could not follow /resume: ${err?.message ?? err}`); return []; });
    },

    /** `[{ sessionId, count, newestAt, olderAt }]`: sessions two or more live
     *  deck panes hold. No pane names: the page never names one. */
    async twins() {
      if (off()) return [];
      const list = await panes();
      return twinGroups(list, (p) => heldBy(p, io())).map((g) => ({
        sessionId: g.sessionId,
        count: g.panes.length,
        newestAt: g.panes[0].created,
        olderAt: g.panes[g.panes.length - 1].created,
      }));
    },

    /** Close every live deck pane holding `sessionId` but the newest. Only on
     *  a person's request (the route), and only when there are two or more
     *  now: the page's view may be old. `{ ok, closed }` or `{ ok: false, code }`. */
    async closeOlder(sessionId) {
      const sid = lower(sessionId);
      if (!isSessionId(sid)) return { ok: false, code: "bad-request" };
      if (off()) return { ok: false, code: "off" };
      const group = twinGroups(await panes(), (p) => heldBy(p, io())).find((g) => g.sessionId === sid);
      if (!group) return { ok: false, code: "no-twins" };
      let closed = 0;
      for (const p of group.panes.slice(1)) {
        if (!OWN_PANE.test(p.name)) continue;
        const r = await t().run(["kill-session", "-t", `=${p.name}`]);
        if (r.ok) { closed++; log(`closed ${p.name}, an older terminal of ${sid.slice(0, 8)}, as asked`); }
      }
      return { ok: true, closed };
    },
  };
}
