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
}

export interface RemoteMachine {
  fp: string;
  /** The name the Local network panel gives that deck. */
  name: string;
  via: "lan" | "tailscale";
  /** When that deck last answered. */
  at: number;
  sessions: RemoteSession[];
}

const STATES: readonly RemoteState[] = ["waiting", "working", "idle", "ended", "failed"];
const KINDS: readonly RemoteWaitKind[] = ["permission", "asked", "idle"];
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function readSession(v: unknown): RemoteSession | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 128);
  if (!id) return null;
  const state = STATES.includes(o.state as RemoteState) ? (o.state as RemoteState) : "idle";
  return {
    id,
    name: str(o.name, 120),
    project: str(o.project, 80),
    provider: str(o.provider, 16) ?? "claude",
    state,
    since: num(o.since),
    lastEventAt: num(o.lastEventAt),
    waiting: KINDS.includes(o.waiting as RemoteWaitKind) ? (o.waiting as RemoteWaitKind) : null,
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
