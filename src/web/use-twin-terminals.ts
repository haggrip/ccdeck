// Which conversations two or more of the deck's terminals hold at once
// (GET /api/terminal/twins, src/server/resume-rebind.mjs), for the card's
// warning, and the one thing a person can do about it: close the older ones.
//
// One poll for the whole board, running while any card is drawn: the first
// card to subscribe starts it and the last to leave stops it. A deck with the
// Command Panel off answers 404, and that is an empty list, not an error.
// Nothing here closes anything on its own: closeOlderTerminals is called from
// the card's confirm dialog only.
import { useSyncExternalStore } from "react";

export const TWINS_POLL_MS = 15_000;

export interface TwinsSnapshot {
  /** Session id → how many live deck terminals hold it (two or more). */
  counts: ReadonlyMap<string, number>;
  /** Sessions whose close is in flight. */
  closing: ReadonlySet<string>;
  /** Sessions whose last close was refused or failed. */
  failed: ReadonlySet<string>;
}

let snap: TwinsSnapshot = { counts: new Map(), closing: new Set(), failed: new Set() };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function publish(next: Partial<TwinsSnapshot>): void {
  snap = { ...snap, ...next };
  for (const l of listeners) l();
}

/** The route's answer, every field checked: it is drawn. */
export function twinsFrom(raw: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!raw || typeof raw !== "object" || (raw as { ok?: unknown }).ok !== true) return out;
  const list = (raw as { twins?: unknown }).twins;
  if (!Array.isArray(list)) return out;
  for (const t of list) {
    if (!t || typeof t !== "object") continue;
    const { sessionId, count } = t as { sessionId?: unknown; count?: unknown };
    if (typeof sessionId === "string" && typeof count === "number" && count >= 2) out.set(sessionId.toLowerCase(), count);
  }
  return out;
}

/** Ask the deck again. Keeps the last answer when this one fails. */
export async function refreshTwins(): Promise<void> {
  try {
    const res = await fetch("/api/terminal/twins", { signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) { publish({ counts: new Map() }); return; }
    if (!res.ok) return;
    publish({ counts: twinsFrom(await res.json()) });
  } catch { /* the next poll asks again */ }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  if (listeners.size === 1 && timer === null && typeof window !== "undefined") {
    void refreshTwins();
    timer = setInterval(() => { if (document.visibilityState !== "hidden") void refreshTwins(); }, TWINS_POLL_MS);
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer !== null) { clearInterval(timer); timer = null; }
  };
};
const read = () => snap;

export function useTwinTerminals(): TwinsSnapshot {
  return useSyncExternalStore(subscribe, read, read);
}

/** For the suite: put the store into a given state. */
export function resetTwins(next: Partial<TwinsSnapshot> = {}): void {
  snap = { counts: new Map(), closing: new Set(), failed: new Set(), ...next };
  for (const l of listeners) l();
}

/** Close every terminal holding `sessionId` but the newest, as the person
 *  just confirmed. True when the deck closed at least one. */
export async function closeOlderTerminals(sessionId: string): Promise<boolean> {
  const sid = sessionId.toLowerCase();
  if (snap.closing.has(sid)) return false;
  const failed = new Set(snap.failed);
  failed.delete(sid);
  publish({ closing: new Set([...snap.closing, sid]), failed });
  let ok = false;
  try {
    const res = await fetch("/api/terminal/twins/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid }),
    });
    const body = await res.json().catch(() => null) as { ok?: unknown; closed?: unknown; code?: unknown } | null;
    // `no-twins`: there is one terminal by now, which is what was wanted.
    ok = body?.ok === true || body?.code === "no-twins";
  } catch { ok = false; }
  const closing = new Set(snap.closing);
  closing.delete(sid);
  const after = new Set(snap.failed);
  if (!ok) after.add(sid);
  publish({ closing, failed: after });
  await refreshTwins();
  return ok;
}
