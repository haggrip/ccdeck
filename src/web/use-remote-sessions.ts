// The sessions paired decks share with this one: read when the list mounts,
// kept current by the `event: lan-sessions` frames the deck sends down its own
// event stream (use-event-stream.ts relays them as a window event), and read
// again every half minute, because a machine that stops answering leaves the
// deck's list without a frame saying so.
import { useCallback, useEffect, useRef, useState } from "react";
import { readRemoteMachines, REMOTE_SESSIONS_EVENT, REMOTE_SESSIONS_ROUTE, type RemoteMachine } from "./remote-sessions";

export const REMOTE_SESSIONS_POLL_MS = 30_000;

type Fetch = typeof fetch;

export function useRemoteSessions(fetchFn: Fetch = (...a) => fetch(...a)): RemoteMachine[] {
  const [machines, setMachines] = useState<RemoteMachine[]>([]);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;
  const alive = useRef(true);
  const take = useCallback((v: unknown) => {
    const next = readRemoteMachines(v);
    if (alive.current && next) setMachines(next);
  }, []);
  const read = useCallback(() => {
    fetchRef.current(REMOTE_SESSIONS_ROUTE).then(r => (r.ok ? r.json() : null)).then(take, () => {});
  }, [take]);

  useEffect(() => {
    alive.current = true;
    read();
    const timer = window.setInterval(read, REMOTE_SESSIONS_POLL_MS);
    const onFrame = (e: Event) => {
      try { take(JSON.parse(String((e as CustomEvent).detail))); } catch { /* a frame we cannot read */ }
    };
    window.addEventListener(REMOTE_SESSIONS_EVENT, onFrame);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      window.removeEventListener(REMOTE_SESSIONS_EVENT, onFrame);
    };
  }, [read, take]);

  return machines;
}
