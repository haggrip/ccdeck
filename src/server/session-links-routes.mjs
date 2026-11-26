// GET /api/session-links: the PRs and tickets each session works on
// (session-links.mjs), with each PR's state as the brief's gh reads last saw
// it, and the session each open Todo item is about, for its "Open in Claude
// Desktop".
//
//   { ok: true,
//     sessions: { <session id>: { prs: [{ url, repo, number, how, state?, checks?, review? }],
//                                 keys: [{ key, how, url? }] } },
//     items: { <Todo item id>: <session id> } }
//
// WHAT IT READS. The ring's sessions (session-summary.mjs), less the ones
// archived in the Claude desktop app; each one's transcript through the scan
// the deck already keeps (transcript-scan.mjs), so a session the enrichment
// has read costs a `stat`; whether its folder is a linked worktree (one
// `stat` of `.git` per folder, cached); the stored brief and the Todo list.
// Nothing here runs gh, a model or anything that writes.
//
// THE TODO LIST LOOKS FURTHER. A session the desktop app runs that the deck
// has not heard from since it started (the ring holds what came after) can
// still be the one working on an item's ticket. So the items are also matched
// against the app's other sessions whose transcript moved in the last
// DESKTOP_MAX_AGE_MS, the newest MAX_DESKTOP_SESSIONS of them, found by one
// listing of each project folder (cached for INDEX_TTL_MS). They add to
// `items` only: their chips are on no row of the page.
//
// A guarded read (request-gates.mjs): the PRs and tickets a person works on
// are the brief's class of secret.
import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { send } from "./http-io.mjs";
import { eventsSince } from "./event-ring.mjs";
import { summarizeSessions } from "./session-summary.mjs";
import { scanTranscript } from "./transcript-scan.mjs";
import { claudeTranscriptRoots, isClaudeTranscriptPath } from "./transcript-gate.mjs";
import { archivedDesktopSessions, desktopSessionsState, withoutArchived } from "./desktop-sessions.mjs";
import { statusTodo } from "./status-todo-routes.mjs";
import { statusBrief } from "./status-brief-routes.mjs";
import { matchItems, prFacts, sessionLinks, ticketBases } from "./session-links.mjs";

export const SESSION_LINKS_ROUTE = "/api/session-links";
/** The most sessions read per answer, most recently heard first. */
export const MAX_SESSIONS = 60;
/** One answer serves every page asking inside this. */
export const ANSWER_TTL_MS = 5_000;
const WORKTREE_TTL_MS = 5 * 60_000;
const MAX_WORKTREE_CACHE = 256;
/** How far up from a session's folder its checkout's `.git` is looked for. */
const MAX_UP = 8;
/** The desktop app's sessions outside the ring that the Todo list is matched
 *  against: how recent their transcript, and how many. */
export const DESKTOP_MAX_AGE_MS = 3 * 24 * 3600_000;
export const MAX_DESKTOP_SESSIONS = 24;
export const INDEX_TTL_MS = 60_000;
const MAX_INDEX = 5_000;
const CLI_ID = /^[A-Za-z0-9-]{8,64}$/;

let index = null; // { at, roots, paths: Map<id, path> }
/**
 * The transcripts of the given Claude Code session ids, modified inside
 * `maxAgeMs`, newest first, at most `max`: [{ id, path, at }]. One listing
 * of each project folder, cached for INDEX_TTL_MS.
 */
export async function recentTranscripts(ids, { roots = claudeTranscriptRoots(), now = Date.now(), maxAgeMs = DESKTOP_MAX_AGE_MS, max = MAX_DESKTOP_SESSIONS, fs = { readdir, stat } } = {}) {
  const want = [...ids].filter(id => typeof id === "string" && CLI_ID.test(id));
  if (!want.length) return [];
  const where = roots.join("\0");
  if (!index || index.roots !== where || now - index.at >= INDEX_TTL_MS || now < index.at) {
    const paths = new Map();
    for (const root of roots) {
      const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const files = await fs.readdir(join(root, d.name)).catch(() => []);
        for (const f of files) {
          if (paths.size >= MAX_INDEX) break;
          const id = f.endsWith(".jsonl") ? f.slice(0, -6) : null;
          if (id && CLI_ID.test(id) && !paths.has(id)) paths.set(id, join(root, d.name, f));
        }
      }
    }
    index = { at: now, roots: where, paths };
  }
  const out = [];
  for (const id of want) {
    const path = index.paths.get(id);
    if (!path) continue;
    const st = await fs.stat(path).catch(() => null);
    if (st && now - st.mtimeMs <= maxAgeMs) out.push({ id, path, at: st.mtimeMs });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, max);
}

/** Each session's newest transcript path, off the ring. */
export function transcriptPaths(envelopes) {
  const out = new Map();
  for (const env of Array.isArray(envelopes) ? envelopes : []) {
    const p = env?.payload;
    if (typeof p?.session_id === "string" && typeof p.transcript_path === "string" && p.transcript_path) out.set(p.session_id, p.transcript_path);
  }
  return out;
}

const worktrees = new Map(); // cwd -> { at, value }
/** Whether a folder is inside a linked git worktree: the nearest `.git` above
 *  it is a file (`gitdir: …`), where a main checkout's is a folder. */
export async function inLinkedWorktree(cwd, { now = Date.now(), statFn = stat } = {}) {
  if (typeof cwd !== "string" || !cwd) return false;
  const had = worktrees.get(cwd);
  if (had && now - had.at < WORKTREE_TTL_MS) return had.value;
  let value = false;
  let dir = cwd;
  for (let i = 0; i < MAX_UP; i++) {
    const st = await statFn(join(dir, ".git")).catch(() => null);
    if (st) { value = st.isFile(); break; }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  worktrees.delete(cwd);
  worktrees.set(cwd, { at: now, value });
  if (worktrees.size > MAX_WORKTREE_CACHE) worktrees.delete(worktrees.keys().next().value);
  return value;
}

/** A transcript's scan state, through the deck's own scan, or null. */
async function scanOf(path) {
  if (!isClaudeTranscriptPath(path)) return null;
  return scanTranscript(path).catch(() => null);
}

const ticketUrls = (todo, brief) => [
  ...[...(todo?.open ?? []), ...(todo?.closed ?? [])].map(i => i?.link?.url),
  ...[...(brief?.waiting ?? []), ...(brief?.todo ?? [])].map(i => i?.url),
].filter(u => typeof u === "string");

/**
 * The answer, from its inputs: `envelopes` the ring's, `archived` the ids the
 * desktop app archived, `desktop` its { Claude Code id: local id } links,
 * `brief` the stored brief, `todo` the Todo list's view, `scan(path)` a
 * transcript's scan state, `worktree(cwd)` inLinkedWorktree.
 */
export async function computeSessionLinks({ envelopes = [], archived = new Set(), desktop = {}, brief = null, todo = null, scan = scanOf, worktree = inLinkedWorktree, recent = recentTranscripts, now = Date.now() } = {}) {
  const rows = withoutArchived(summarizeSessions(envelopes, { now }), archived)
    .filter(r => r.provider === "claude")
    .sort((a, b) => b.lastEventAt - a.lastEventAt)
    .slice(0, MAX_SESSIONS);
  const paths = transcriptPaths(envelopes);
  const read = [];
  for (const r of rows) {
    const path = paths.get(r.id);
    const state = path ? await scan(path) : null;
    read.push({ r, state, worktree: state?.gitBranch ? await worktree(r.cwd) : false });
  }
  // The desktop app's other recent sessions, for the Todo list only.
  const inRing = new Set(rows.map(r => r.id));
  const others = (todo?.open ?? []).length ? await recent(Object.keys(desktop ?? {}).filter(id => !inRing.has(id) && !archived.has(id)), { now }) : [];
  for (const o of others) {
    const state = await scan(o.path);
    read.push({ r: { id: o.id, name: null, lastEventAt: o.at }, state, worktree: state?.gitBranch ? await worktree(state.links?.cwd) : false, other: true });
  }
  const facts = prFacts(brief);
  const bases = ticketBases({ urls: ticketUrls(todo, brief), states: read.map(x => x.state?.links).filter(Boolean) });
  const sessions = {};
  const ranked = {};
  for (const { r, state, worktree: wt, other } of read) {
    const names = [...new Set([r.name, state?.customTitle, state?.agentName].filter(n => typeof n === "string" && n))];
    const l = sessionLinks({ links: state?.links ?? null, branch: state?.gitBranch ?? null, worktree: wt, names, facts, bases });
    if (!l.prs.length && !l.keys.length) continue;
    if (!other) sessions[r.id] = l;
    ranked[r.id] = { ...l, lastEventAt: r.lastEventAt };
  }
  const items = matchItems(todo?.open ?? [], ranked, { opens: id => Object.hasOwn(desktop ?? {}, id) });
  return { ok: true, sessions, items };
}

let cached = null;
let cachedAt = 0;
let pending = null;

/** The deck's answer, at most one computed per ANSWER_TTL_MS. */
export async function sessionLinksNow() {
  if (cached && Date.now() - cachedAt < ANSWER_TTL_MS) return cached;
  pending ??= (async () => {
    const [archived, desktop, briefView, todo] = await Promise.all([
      archivedDesktopSessions(),
      desktopSessionsState().then(s => s.links, () => ({})),
      statusBrief().view().catch(() => null),
      statusTodo().view().catch(() => null),
    ]);
    return computeSessionLinks({ envelopes: eventsSince(0), archived, desktop, brief: briefView?.brief ?? null, todo });
  })().then(v => { cached = v; cachedAt = Date.now(); return v; }).finally(() => { pending = null; });
  return pending;
}

export async function handleSessionLinks(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method not allowed" });
  return send(res, 200, await sessionLinksNow());
}
