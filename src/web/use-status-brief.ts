// The Status pane's line to the deck: the cached brief, read once when the
// pane mounts, followed while a run is out, and asked for again on a modest
// interval while the pane is open and the tab is visible.
//
// THE INTERVAL ONLY ASKS. Every AUTO_TICK_MS the page reads whether a run is
// due (the deck's `nextAutoAt`, set by the pane's own "every" setting and its
// backoff after failures) and, if so, posts `{ auto: true }`; the deck refuses
// a run that is not due, so two tabs, or a tab and a reload, never double it.
// A hidden tab asks nothing. Mounted only while the pane is open, so a closed
// pane runs nothing at all.
import { useCallback, useEffect, useRef, useState } from "react";
import { autoDue, type BriefPerson, type BriefSettings, type BriefView } from "./status-brief";

export const STATUS_BRIEF_ROUTE = "/api/status-brief";
/** How often an open pane looks at whether a run is due. */
export const AUTO_TICK_MS = 60_000;
/** How often it reads back while a run is out. */
export const RUNNING_POLL_MS = 3_000;

type Fetch = typeof fetch;

async function call(fetchFn: Fetch, path: string, body?: unknown): Promise<BriefView | null> {
  const res = await fetchFn(path, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.ok ? (data as BriefView) : null;
}

export interface StatusBriefHandle {
  view: BriefView | null;
  /** The deck did not answer the last read. */
  unreachable: boolean;
  refresh: () => void;
  setSettings: (patch: Partial<Omit<BriefSettings, "sources">> & { sources?: Partial<BriefSettings["sources"]> }) => void;
  person: (action: "pin" | "hide" | "clear", person: BriefPerson) => void;
}

export function useStatusBrief(fetchFn: Fetch = (...a) => fetch(...a)): StatusBriefHandle {
  const [view, setView] = useState<BriefView | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const viewRef = useRef<BriefView | null>(null);
  const alive = useRef(true);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  const take = useCallback((next: BriefView | null) => {
    if (!alive.current) return;
    setUnreachable(next == null);
    if (next) { viewRef.current = next; setView(next); }
  }, []);
  const send = useCallback((path: string, body?: unknown) => {
    call(fetchRef.current, path, body).then(take, () => take(null));
  }, [take]);

  // The first read, the interval and the return from a hidden tab.
  useEffect(() => {
    alive.current = true;
    const read = () => { if (document.visibilityState !== "hidden") send(STATUS_BRIEF_ROUTE); };
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      const v = viewRef.current;
      if (v && autoDue(v, Date.now())) send(`${STATUS_BRIEF_ROUTE}/refresh`, { auto: true });
      else read();
    };
    // The first read, then the first chance at an automatic run.
    call(fetchRef.current, STATUS_BRIEF_ROUTE).then(v => {
      take(v);
      if (v && autoDue(v, Date.now()) && document.visibilityState !== "hidden") send(`${STATUS_BRIEF_ROUTE}/refresh`, { auto: true });
    }, () => take(null));
    const timer = window.setInterval(tick, AUTO_TICK_MS);
    const onVis = () => { if (document.visibilityState !== "hidden") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [send, take]);

  // Followed while a run is out: the new brief lands without a press.
  const running = view?.running === true;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => send(STATUS_BRIEF_ROUTE), RUNNING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, send]);

  return {
    view,
    unreachable,
    refresh: useCallback(() => send(`${STATUS_BRIEF_ROUTE}/refresh`, {}), [send]),
    setSettings: useCallback(patch => send(`${STATUS_BRIEF_ROUTE}/settings`, patch), [send]),
    person: useCallback((action, person) => send(`${STATUS_BRIEF_ROUTE}/people`, { action, person, key: person.key }), [send]),
  };
}
