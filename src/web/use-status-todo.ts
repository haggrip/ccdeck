// The live Todo list's line to the deck: read once when the pane mounts, then
// kept current by the `event: status-todo` frames the deck sends down its own
// event stream (use-event-stream.ts relays them as a window event), so the
// list changes in the open page without a reload or a poll.
import { useCallback, useEffect, useRef, useState } from "react";
import { STATUS_TODO_EVENT, type TodoView } from "./status-todo";

export const STATUS_TODO_ROUTE = "/api/status-todo";

export interface StatusTodoHandle {
  view: TodoView | null;
  /** The user's own words, for the list's keeper. */
  say: (text: string) => void;
  act: (action: "close" | "reopen" | "snooze" | "unsnooze", id: string, until?: number) => void;
}

type Fetch = typeof fetch;

export function useStatusTodo(fetchFn: Fetch = (...a) => fetch(...a)): StatusTodoHandle {
  const [view, setView] = useState<TodoView | null>(null);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;
  const alive = useRef(true);
  const take = useCallback((v: unknown) => {
    const next = v as TodoView | null;
    if (alive.current && next?.ok && Array.isArray(next.open)) setView(next);
  }, []);
  const call = useCallback((path: string, body?: unknown) => {
    fetchRef.current(path, body === undefined ? undefined : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(r => r.json()).then(take, () => {});
  }, [take]);

  useEffect(() => {
    alive.current = true;
    call(STATUS_TODO_ROUTE);
    const onFrame = (e: Event) => {
      try { take(JSON.parse(String((e as CustomEvent).detail))); } catch { /* a frame we cannot read */ }
    };
    window.addEventListener(STATUS_TODO_EVENT, onFrame);
    return () => { alive.current = false; window.removeEventListener(STATUS_TODO_EVENT, onFrame); };
  }, [call, take]);

  return {
    view,
    say: useCallback(text => { if (text.trim()) call(`${STATUS_TODO_ROUTE}/say`, { text }); }, [call]),
    act: useCallback((action, id, until) => call(`${STATUS_TODO_ROUTE}/item`, { action, id, ...(until ? { until } : {}) }), [call]),
  };
}
