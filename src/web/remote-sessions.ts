// The sessions paired decks share with this one, read-only — what
// GET /api/lan/remote-sessions answers and what an `event: lan-sessions` frame
// carries (src/server/lan-sessions.mjs builds both). Pure, so a bare-node suite
// can call all of it.
//
// Read again here rather than trusted: whatever the server holds came from
// another machine, and a row this page draws keeps to the whitelist that
// machine was meant to keep to.

export const REMOTE_SESSIONS_EVENT = "ccdeck:lan-sessions";
export const REMOTE_SESSIONS_ROUTE = "/api/lan/remote-sessions";

export type RemoteState = "waiting" | "working" | "idle" | "ended" | "failed";
export type RemoteWaitKind = "permission" | "asked" | "idle";

export interface RemoteSession {
  id: string;
  name: string | null;
  project: string | null;
  provider: string;
  state: RemoteState;
  since: number | null;
  lastEventAt: number | null;
  waiting: RemoteWaitKind | null;
  /** What the session says, when that deck shares it (lan.shareSessionContext
   *  there, src/server/lan-session-context.mjs): its newest prompt, the
   *  question standing and since when, and the end of its last turn. Absent
   *  from a deck that does not. */
  prompt?: string | null;
  question?: string | null;
  askedAt?: number | null;
  wrap?: RemoteWrap | null;
}

/** The end of a session's last turn, as src/server/session-wrap.mjs keeps it:
 *  the desktop app's `wrap_up` call, or the turn's last words with no ask. */
export interface RemoteWrap {
  id: string | null;
  at: number;
  recap: string | null;
  ask: { question: string | null; choices: string[]; blocked: boolean } | null;
}

export interface RemoteMachine {
  fp: string;
  /** The name the Local network panel gives that deck. */
  name: string;
  via: "lan" | "tailscale";
  /** When that deck last answered. */
  at: number;
  sessions: RemoteSession[];
  /** Whether that deck takes commands for its sessions from this one
   *  (src/server/lan-control.mjs). It still checks every one itself. */
  control: boolean;
}

const STATES: readonly RemoteState[] = ["waiting", "working", "idle", "ended", "failed"];
const KINDS: readonly RemoteWaitKind[] = ["permission", "asked", "idle"];
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function readWrap(v: unknown): RemoteWrap | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const at = num(o.at);
  if (at == null) return null;
  const recap = str(o.recap, 600);
  const a = o.ask && typeof o.ask === "object" ? (o.ask as Record<string, unknown>) : null;
  const question = a ? str(a.question, 300) : null;
  const blocked = a?.blocked === true;
  if (!recap && !question && !blocked) return null;
  const choices = a && Array.isArray(a.choices)
    ? a.choices.map(c => str(c, 60)).filter((c): c is string => c !== null).slice(0, 4)
    : [];
  return { id: str(o.id, 128), at, recap, ask: question || blocked ? { question, choices, blocked } : null };
}

function readSession(v: unknown): RemoteSession | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 128);
  if (!id) return null;
  const state = STATES.includes(o.state as RemoteState) ? (o.state as RemoteState) : "idle";
  const question = str(o.question, 200);
  return {
    id,
    name: str(o.name, 120),
    project: str(o.project, 80),
    provider: str(o.provider, 16) ?? "claude",
    state,
    since: num(o.since),
    lastEventAt: num(o.lastEventAt),
    waiting: KINDS.includes(o.waiting as RemoteWaitKind) ? (o.waiting as RemoteWaitKind) : null,
    prompt: str(o.prompt, 240),
    question,
    askedAt: question ? num(o.askedAt) : null,
    wrap: readWrap(o.wrap),
  };
}

/** The machines in an answer or a frame, or null for one that is not either. */
export function readRemoteMachines(v: unknown): RemoteMachine[] | null {
  const o = v as { ok?: unknown; machines?: unknown } | null;
  if (!o || !Array.isArray(o.machines)) return null;
  const out: RemoteMachine[] = [];
  for (const m of o.machines.slice(0, 32)) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const fp = str(r.fp, 128);
    if (!fp) continue;
    const sessions = (Array.isArray(r.sessions) ? r.sessions.slice(0, 200) : [])
      .map(readSession).filter((s): s is RemoteSession => s !== null);
    out.push({
      fp,
      name: str(r.name, 80) ?? fp.slice(0, 12),
      via: r.via === "tailscale" ? "tailscale" : "lan",
      at: num(r.at) ?? 0,
      sessions,
      control: r.control === true,
    });
  }
  return out;
}

const RANK: Record<RemoteState, number> = { waiting: 0, working: 1, idle: 2, failed: 3, ended: 4 };

/** A machine's rows in the order the rail reads: waiting first, longest
 *  blocked first, then working, idle, failed and ended, latest heard first. */
export function orderRemote(sessions: readonly RemoteSession[]): RemoteSession[] {
  return [...sessions].sort((a, b) => RANK[a.state] - RANK[b.state]
    || (a.state === "waiting" ? (a.since ?? 0) - (b.since ?? 0) : (b.lastEventAt ?? 0) - (a.lastEventAt ?? 0)));
}

/** How many remote sessions are waiting on a person right now — a permission
 *  prompt or a question, as the topbar's own count reads a local one. */
export function remoteWaitingCount(machines: readonly RemoteMachine[]): number {
  let n = 0;
  for (const m of machines) for (const s of m.sessions) if (s.state === "waiting" && s.waiting !== "idle") n++;
  return n;
}

// ── on Mission ──────────────────────────────────────────────────────────────
// A paired deck's session on Mission (components/MissionView.tsx): in Live
// while it waits, works or failed, and as the session a Todo item or a brief
// item names. Its id is the one the deck's brief and Todo list know it by,
// src/server/paired-sessions.mjs's `peer:<fp>:<id>`.

const PEER_ID = /^[\w.:-]{1,120}$/;
const REMOTE_FOLDER = /^bridge-cse_([A-Za-z0-9]{10,64})$/;

/** The deck's id for a paired deck's session, or null when it would not fit
 *  (src/server/paired-sessions.mjs peerSessionId). */
export function peerSessionId(fp: string, id: string): string | null {
  const sid = `peer:${fp}:${id}`;
  return fp && id && PEER_ID.test(sid) ? sid : null;
}

/** The Remote Control session a folder name says a session is (`session_<id>`,
 *  as the Claude desktop app opens it), or null. */
export function remoteIdOfProject(project: string | null | undefined): string | null {
  const m = typeof project === "string" ? REMOTE_FOLDER.exec(project) : null;
  return m ? `session_${m[1]}` : null;
}

export type RemoteLiveState = "waiting" | "working" | "failed";

export interface RemoteLive {
  sessionId: string;
  label: string;
  machine: string;
  live: RemoteLiveState;
  /** The question it waits on, when that deck shares what its sessions say. */
  detail: string | null;
  /** Its Remote Control session, for the desktop app, or null. */
  remoteId: string | null;
  lastActivity: number;
}

/** Whether a session waits on a person: a permission prompt or a question, or
 *  a question standing with no wait said (src/server/paired-sessions.mjs). */
function waitsOnSomebody(s: RemoteSession): boolean {
  if (s.state === "ended") return false;
  if (s.waiting && s.waiting !== "idle") return true;
  return !s.waiting && !!s.question && s.askedAt != null;
}

/** Every paired deck's sessions that Mission's Live lists. */
export function missionRemote(machines: readonly RemoteMachine[]): RemoteLive[] {
  const out: RemoteLive[] = [];
  for (const m of machines) {
    for (const s of m.sessions) {
      const sessionId = peerSessionId(m.fp, s.id);
      if (!sessionId) continue;
      const live: RemoteLiveState | null = waitsOnSomebody(s) ? "waiting"
        : s.state === "working" ? "working"
        : s.state === "failed" ? "failed"
        : null;
      if (!live) continue;
      out.push({
        sessionId,
        label: s.name ?? s.project ?? s.id.slice(0, 8),
        machine: m.name,
        live,
        detail: live === "waiting" ? s.question ?? null : null,
        remoteId: remoteIdOfProject(s.project),
        lastActivity: s.lastEventAt ?? s.since ?? m.at,
      });
    }
  }
  return out;
}

/** Each paired deck's session id → its Remote Control session, for the ones
 *  that are one: what opens a Todo item about it in the desktop app. */
export function remoteOpeners(machines: readonly RemoteMachine[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of machines) {
    for (const s of m.sessions) {
      const sessionId = peerSessionId(m.fp, s.id);
      const remoteId = remoteIdOfProject(s.project);
      if (sessionId && remoteId) out.set(sessionId, remoteId);
    }
  }
  return out;
}
