// Which of this computer's Claude Code sessions the Claude desktop app runs,
// so a Todo item can open its session there rather than on the deck's board.
//
// WHERE IT LOOKS. The desktop app keeps one JSON file per Claude Code session
// it runs, under <its data folder>/claude-code-sessions/<account>/<org>/
// local_<id>.json. Each names the app's own id (`sessionId`, `local_…`) and the
// Claude Code conversation it drives (`cliSessionId`, the id the deck's hook
// reports, and `lastAssistantCliSessionId` after a resume). The deck reads
// those three fields and nothing else of the file: no title, prompt or folder
// leaves this module.
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

/**
 * A reader with its own cache: `links()` gives { cliSessionId: local_id } for
 * every session the desktop app knows that is not archived. A conversation
 * that two app sessions name (a resume) goes to the one touched last.
 */
export function createDesktopSessions({ root = desktopSessionsRoot(), env = process.env, now = () => Date.now(), fs = { readFile, stat } } = {}) {
  const files = new Map(); // path -> { mtimeMs, link }
  let cached = null;
  let at = 0;
  let pending = null;

  async function scan() {
    if (!root || desktopLinksVetoed(env)) return {};
    const paths = await listFiles(root);
    const seen = new Set(paths);
    for (const p of files.keys()) if (!seen.has(p)) files.delete(p);
    const best = new Map(); // cli -> { local, mtimeMs }
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
      if (!l || l.archived) continue;
      for (const cli of l.cli) {
        const had = best.get(cli);
        if (!had || had.mtimeMs < entry.mtimeMs) best.set(cli, { local: l.local, mtimeMs: entry.mtimeMs });
      }
    }
    return Object.fromEntries([...best].map(([cli, v]) => [cli, v.local]));
  }

  return {
    async links() {
      if (cached && now() - at < LIST_TTL_MS) return cached;
      if (!pending) {
        pending = scan().then(v => { cached = v; at = now(); return v; }, () => cached ?? {}).finally(() => { pending = null; });
      }
      return pending;
    },
  };
}

let shared = null;
/** The deck's one reader, for its route. */
export async function desktopSessionsState(env = process.env) {
  if (desktopLinksVetoed(env)) return { off: true, links: {} };
  shared ??= createDesktopSessions({ env });
  return { off: false, links: await shared.links() };
}
