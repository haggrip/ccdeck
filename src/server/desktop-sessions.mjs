// Which of this computer's Claude Code sessions the Claude desktop app runs,
// so a Todo item can open its session there rather than on the deck's board,
// and which ones the person archived there, so the Sessions list and Mission
// let them go.
//
// WHERE IT LOOKS. The desktop app keeps one JSON file per Claude Code session
// it runs, under <its data folder>/claude-code-sessions/<account>/<org>/
// local_<id>.json. Each names the app's own id (`sessionId`, `local_…`) and the
// Claude Code conversation it drives (`cliSessionId`, the id the deck's hook
// reports, and `lastAssistantCliSessionId` after a resume), and whether it is
// archived (`isArchived`). The deck reads those four fields and nothing else
// of the file: no title, prompt or folder leaves this module.
//
// ARCHIVED. A conversation counts as archived when every app session that
// names it is archived: one resumed in a live app session is not. And an
// archived conversation that is working or waiting right now still shows
// (shownDespiteArchive): archiving puts away what is done, never what needs
// the person.
//
// THE LINK. The desktop app's own menus open a session with
// claude://code/continue?session=local_<id> (its spotlight and dock entries),
// and it refuses any other id shape, so the deck holds ids to that shape too.
// A Remote Control session opens with claude://code/session_<id>.
//
// HOW OFTEN. One listing per LIST_TTL_MS at most, and a file is parsed again
// only when its mtime changes, so a page that asks every few seconds costs a
// readdir.
//
// OFF SWITCH. AGENTS_DECK_NO_DESKTOP_LINKS=1, and the deck never reads the
// desktop app's folder.
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { run as execRun } from "./exec.mjs";

export const DESKTOP_LINKS_VETO_ENV = "AGENTS_DECK_NO_DESKTOP_LINKS";
export const LIST_TTL_MS = 15_000;
export const MAX_FILES = 2_000;
/** The desktop app's own rule for a local session id (claudeURLHandler). */
export const LOCAL_ID = /^local_[A-Za-z0-9-]{1,64}$/;
/** A Claude Code conversation id, as the hook reports it. */
const CLI_ID = /^[A-Za-z0-9-]{8,64}$/;

export function desktopLinksVetoed(env = process.env) {
  return env?.[DESKTOP_LINKS_VETO_ENV] === "1";
}

/** The desktop app's data folder on this platform. */
export function desktopSessionsRoot(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === "darwin") return join(home, "Library", "Application Support", "Claude", "claude-code-sessions");
  if (platform === "win32") return env.APPDATA ? join(env.APPDATA, "Claude", "claude-code-sessions") : null;
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "Claude", "claude-code-sessions");
}

/** The three fields the deck uses from one session file, or null. */
export function linkOf(json) {
  let o;
  try { o = JSON.parse(json); } catch { return null; }
  if (!o || typeof o !== "object" || typeof o.sessionId !== "string" || !LOCAL_ID.test(o.sessionId)) return null;
  const cli = [o.cliSessionId, o.lastAssistantCliSessionId].filter(v => typeof v === "string" && CLI_ID.test(v));
  if (!cli.length) return null;
  return { local: o.sessionId, cli: [...new Set(cli)], archived: o.isArchived === true };
}

async function listFiles(root) {
  const out = [];
  const walk = async (dir, depth) => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.isDirectory() && depth < 2) await walk(join(dir, e.name), depth + 1);
      else if (e.isFile() && depth === 2 && /^local_[A-Za-z0-9-]+\.json$/.test(e.name)) out.push(join(dir, e.name));
    }
  };
  await walk(root, 0);
  return out;
}

const NOTHING = Object.freeze({ links: Object.freeze({}), archived: Object.freeze([]) });

/**
 * A reader with its own cache. `read()` gives `links`, { cliSessionId:
 * local_id } for every session the desktop app knows that is not archived,
 * and `archived`, the Claude Code ids that only archived app sessions name
 * (sorted). A conversation that two app sessions name (a resume) links to the
 * one touched last. `links()` is `read()`'s links alone.
 */
export function createDesktopSessions({ root = desktopSessionsRoot(), env = process.env, now = () => Date.now(), fs = { readFile, stat } } = {}) {
  const files = new Map(); // path -> { mtimeMs, link }
  let cached = null;
  let at = 0;
  let pending = null;

  async function scan() {
    if (!root || desktopLinksVetoed(env)) return NOTHING;
    const paths = await listFiles(root);
    const seen = new Set(paths);
    for (const p of files.keys()) if (!seen.has(p)) files.delete(p);
    const best = new Map(); // cli -> { local, mtimeMs }
    const shelved = new Set(); // cli named by an archived app session
    for (const p of paths) {
      let st;
      try { st = await fs.stat(p); } catch { continue; }
      let entry = files.get(p);
      if (!entry || entry.mtimeMs !== st.mtimeMs) {
        let text;
        try { text = await fs.readFile(p, "utf8"); } catch { continue; }
        entry = { mtimeMs: st.mtimeMs, link: linkOf(text) };
        files.set(p, entry);
      }
      const l = entry.link;
      if (!l) continue;
      if (l.archived) { for (const cli of l.cli) shelved.add(cli); continue; }
      for (const cli of l.cli) {
        const had = best.get(cli);
        if (!had || had.mtimeMs < entry.mtimeMs) best.set(cli, { local: l.local, mtimeMs: entry.mtimeMs });
      }
    }
    return {
      links: Object.fromEntries([...best].map(([cli, v]) => [cli, v.local])),
      archived: [...shelved].filter(cli => !best.has(cli)).sort(),
    };
  }

  async function read() {
    if (cached && now() - at < LIST_TTL_MS) return cached;
    if (!pending) {
      pending = scan().then(v => { cached = v; at = now(); return v; }, () => cached ?? NOTHING).finally(() => { pending = null; });
    }
    return pending;
  }

  return {
    read,
    async links() { return (await read()).links; },
  };
}

let shared = null;
/** The deck's one reader, for its route. */
export async function desktopSessionsState(env = process.env) {
  if (desktopLinksVetoed(env)) return { off: true, links: {}, archived: [] };
  shared ??= createDesktopSessions({ env });
  const { links, archived } = await shared.read();
  return { off: false, links, archived };
}

/** The Claude Code ids the desktop app has archived, as a set; empty under
 *  the off switch or when the app's folder cannot be read. */
export async function archivedDesktopSessions(env = process.env) {
  try { return new Set((await desktopSessionsState(env)).archived); } catch { return new Set(); }
}

/** Whether an archived session still shows: it is working or waiting now.
 *  `state` is session-summary.mjs's ("working", "waiting", "idle", "ended"). */
export function shownDespiteArchive(state) {
  return state === "working" || state === "waiting";
}

/** session-summary.mjs rows without the ones the desktop app archived. */
export function withoutArchived(rows, archived) {
  if (!archived?.size || !Array.isArray(rows)) return rows;
  return rows.filter(r => !archived.has(r.id) || shownDespiteArchive(r.state));
}

/** The desktop app's link for a local id, or null for any other shape. */
export function desktopUrl(localId) {
  return typeof localId === "string" && LOCAL_ID.test(localId) ? `claude://code/continue?session=${localId}` : null;
}

/** The OS's own opener, with the link as its one argument (no shell). */
export function openerFor(platform = process.platform) {
  if (platform === "darwin") return ["open", []];
  if (platform === "win32") return ["explorer.exe", []];
  return ["xdg-open", []];
}

/**
 * Opens a session in the Claude desktop app, by the Claude Code session id the
 * page names. The page never hands the deck a link: the deck looks the id up in
 * the app's own files and builds the link itself, so the only thing a press
 * can open is a session the app already runs.
 */
export async function openInDesktop(sessionId, { env = process.env, platform = process.platform, run, links } = {}) {
  if (desktopLinksVetoed(env)) return { ok: false, error: "off" };
  if (typeof sessionId !== "string" || !CLI_ID.test(sessionId)) return { ok: false, error: "bad-session" };
  const map = links ?? (await desktopSessionsState(env)).links;
  const url = Object.hasOwn(map, sessionId) ? desktopUrl(map[sessionId]) : null;
  if (!url) return { ok: false, error: "not-in-app" };
  const [cmd, pre] = openerFor(platform);
  const exec = run ?? execRun;
  const r = await exec(cmd, [...pre, url], { timeout: 10_000 });
  // explorer.exe exits 1 even when it opened the link.
  return r.ok || platform === "win32" ? { ok: true } : { ok: false, error: "open-failed" };
}

/** A Remote Control session's id, as its claude.ai link names it. */
export const REMOTE_ID = /^session_[A-Za-z0-9]{1,128}$/;

/** The desktop app's link for a Remote Control session, or null. */
export function remoteDesktopUrl(remoteId) {
  return typeof remoteId === "string" && REMOTE_ID.test(remoteId) ? `claude://code/${remoteId}` : null;
}

/**
 * Opens a Remote Control session in the Claude desktop app, which shows it as
 * claude.ai does. The id is held to the one shape the app takes for it, so the
 * link the deck builds can name nothing else.
 */
export async function openRemoteInDesktop(remoteId, { env = process.env, platform = process.platform, run } = {}) {
  if (desktopLinksVetoed(env)) return { ok: false, error: "off" };
  const url = remoteDesktopUrl(remoteId);
  if (!url) return { ok: false, error: "bad-session" };
  const [cmd, pre] = openerFor(platform);
  const r = await (run ?? execRun)(cmd, [...pre, url], { timeout: 10_000 });
  return r.ok || platform === "win32" ? { ok: true } : { ok: false, error: "open-failed" };
}
