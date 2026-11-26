// The sessions paired decks share with this one (lan-sessions.mjs), as the
// brief and the Todo list read this deck's own: summarizeSessions-shaped rows,
// so the digest, the Todo keeper's waits and failures, and Mission take them
// down the same paths as a local session.
//
// WHY. The owner's ThinkPad runs its Claude Code sessions under Remote Control,
// driven from the Mac, with a deck of its own paired to the Mac's over
// Tailscale. Its sessions reached the Mac's Sessions list (#12) and nothing
// else: the brief and Waiting on you read only this deck's ring, so a ThinkPad
// session waiting on him was nowhere on the page he reads (2026-11-25).
//
// THE ID. `peer:<that deck's fingerprint>:<its session id>`: never one of this
// deck's ids, and in the alphabet the brief and the Todo list take a session id
// in (`[\w.:-]`, 120 at most). A row whose id would not fit is left out, since
// nothing could link to it.
//
// WHAT A ROW HOLDS. What the far deck shared and nothing more: the first tier
// always (name, folder name, state, kind of wait), and the second when that
// deck shares it (lan.shareSessionContext there): the newest prompt, the
// question standing and since when, and the end of the last turn as
// session-wrap.mjs's `{ id, at, recap, ask }`. `machine` names the deck, and
// `remoteId` is the Remote Control session it is, read off its folder's name
// (`bridge-cse_<id>`, the worktree Remote Control spawns it in), for the link
// that opens it in the Claude desktop app.
//
// A QUESTION THAT STANDS IS A WAIT. A row the far deck says is working or idle
// while it has a question standing (an AskUserQuestion with no result yet: no
// Notification said it waits) waits on the person here, as `asked`.
//
// Pure, but for pairedSessionRows, which reads the running engine.

export const PEER_PREFIX = "peer:";
const SESSION_ID = /^[\w.:-]{1,120}$/;
const REMOTE_FOLDER = /^bridge-cse_([A-Za-z0-9]{10,64})$/;

/** This deck's id for a paired deck's session, or null when it would not fit. */
export function peerSessionId(fp, id) {
  if (typeof fp !== "string" || typeof id !== "string" || !fp || !id) return null;
  const sid = `${PEER_PREFIX}${fp}:${id}`;
  return SESSION_ID.test(sid) ? sid : null;
}

/** Whether an id is a paired deck's session. */
export const isPeerSessionId = id => typeof id === "string" && id.startsWith(PEER_PREFIX);

/** The Remote Control session a folder name says a session is
 *  (`session_<id>`, as the desktop app opens it), or null. */
export function remoteIdOfProject(project) {
  const m = typeof project === "string" ? REMOTE_FOLDER.exec(project) : null;
  return m ? `session_${m[1]}` : null;
}

const time = v => (Number.isFinite(v) && v > 0 ? v : null);

/** One shared row as a summarizeSessions row, or null. */
function rowOf(machine, s) {
  const id = peerSessionId(machine.fp, s?.id);
  if (!id) return null;
  let state = ["waiting", "working", "idle", "ended", "failed"].includes(s.state) ? s.state : "idle";
  const question = typeof s.question === "string" && s.question ? s.question : null;
  const askedAt = time(s.askedAt);
  let since = time(s.since);
  let waiting = null;
  if (s.waiting && state !== "ended") {
    waiting = { kind: s.waiting, message: question, since: askedAt ?? since, tool: null };
  } else if (question && askedAt && state !== "ended") {
    state = "waiting";
    since = askedAt;
    waiting = { kind: "asked", message: question, since: askedAt, tool: null };
  }
  return {
    id,
    provider: s.provider ?? "claude",
    name: s.name ?? null,
    project: s.project ?? null,
    cwd: null,
    state,
    since,
    lastEventAt: time(s.lastEventAt),
    waiting,
    wrap: s.wrap ?? null,
    prompt: typeof s.prompt === "string" && s.prompt ? s.prompt : null,
    machine: machine.name || machine.fp,
    remoteId: remoteIdOfProject(s.project),
  };
}

/** Every paired deck's shared sessions (lan-engine's remoteSessions()) as rows. */
export function pairedRows(machines) {
  const out = [];
  for (const m of Array.isArray(machines) ? machines : []) {
    if (!m || typeof m.fp !== "string") continue;
    for (const s of Array.isArray(m.sessions) ? m.sessions : []) {
      const r = rowOf(m, s);
      if (r) out.push(r);
    }
  }
  return out;
}

const RANK = { waiting: 0, working: 1, idle: 2, failed: 2, ended: 3 };

/** This deck's rows and the paired decks', in summarizeSessions' own order: the
 *  waiting first, longest-blocked first, then running, then the rest by when
 *  they were last heard. So a cut (the digest's thirty) drops the quiet ones
 *  wherever they run. */
export function withPairedRows(local, paired) {
  const all = [...(Array.isArray(local) ? local : []), ...(Array.isArray(paired) ? paired : [])];
  if (!Array.isArray(paired) || paired.length === 0) return all;
  return all.sort((a, b) => (RANK[a.state] ?? 2) - (RANK[b.state] ?? 2)
    || (a.state === "waiting" ? (a.since ?? 0) - (b.since ?? 0) : (b.lastEventAt ?? 0) - (a.lastEventAt ?? 0)));
}

/** What the Todo keeper compares to tell that a paired deck's sessions moved:
 *  the fields its items are made and closed by. */
export function pairedSignature(rows) {
  return JSON.stringify((Array.isArray(rows) ? rows : []).map(r => [
    r.id, r.state, r.since, r.waiting?.kind ?? null, r.waiting?.since ?? null, r.wrap?.id ?? null, r.wrap?.at ?? null,
  ]));
}

/** The paired decks' rows, read off the running engine; none while LAN is off,
 *  and none if the engine cannot be read. */
export async function pairedSessionRows() {
  try {
    const { remoteSessionsView } = await import("./lan-deck.mjs");
    return pairedRows(remoteSessionsView()?.machines);
  } catch {
    return [];
  }
}
