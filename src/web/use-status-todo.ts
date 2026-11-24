// The live Todo list's line to the deck: read once when the pane mounts, then
// kept current by the `event: status-todo` frames the deck sends down its own
// event stream (use-event-stream.ts relays them as a window event), so the
// list changes in the open page without a reload or a poll.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BriefItem } from "./status-brief";
import { STATUS_TODO_EVENT, type TodoView } from "./status-todo";

export const STATUS_TODO_ROUTE = "/api/status-todo";

/** How long the Undo stays after a dismiss. */
export const UNDO_MS = 8_000;

export interface StatusTodoHandle {
  view: TodoView | null;
  /** Dismiss a list item (by id) or a brief item (by its own fields). */
  dismiss?: (target: { id: string } | { item: BriefItem }) => void;
  /** Bring a dismissed item back. */
  restore?: (key: string) => void;
  /** The last dismiss, while it can still be undone. */
  undo?: { key: string; title: string } | null;
  /** The user's own words, for the list's keeper. */
  say: (text: string) => void;
  act: (action: "close" | "reopen" | "snooze" | "unsnooze", id: string, until?: number) => void;
}

type Fetch = typeof fetch;

export function useStatusTodo(fetchFn: Fetch = (...a) => fetch(...a)): StatusTodoHandle {
  const [view, setView] = useState<TodoView | null>(null);
  const [undo, setUndo] = useState<{ key: string; title: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;
  const alive = useRef(true);
  const take = useCallback((v: unknown) => {
    const next = v as TodoView | null;
    if (alive.current && next?.ok && Array.isArray(next.open)) setView(next);
  }, []);
  const call = useCallback((path: string, body?: unknown, then?: (v: { undo?: { key: string; title: string } }) => void) => {
    fetchRef.current(path, body === undefined ? undefined : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(r => r.json()).then(v => { take(v); if (alive.current) then?.(v); }, () => {});
  }, [take]);
  const offerUndo = useCallback((v: { undo?: { key: string; title: string } }) => {
    if (!v?.undo?.key) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(v.undo);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  }, []);

  useEffect(() => {
    alive.current = true;
    call(STATUS_TODO_ROUTE);
    const onFrame = (e: Event) => {
      try { take(JSON.parse(String((e as CustomEvent).detail))); } catch { /* a frame we cannot read */ }
    };
    window.addEventListener(STATUS_TODO_EVENT, onFrame);
    return () => {
      alive.current = false;
      window.removeEventListener(STATUS_TODO_EVENT, onFrame);
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, [call, take]);

  return {
    view,
    say: useCallback(text => { if (text.trim()) call(`${STATUS_TODO_ROUTE}/say`, { text }); }, [call]),
    act: useCallback((action, id, until) => call(`${STATUS_TODO_ROUTE}/item`, { action, id, ...(until ? { until } : {}) }), [call]),
    dismiss: useCallback((target: { id: string } | { item: BriefItem }) => {
      if ("id" in target) call(`${STATUS_TODO_ROUTE}/item`, { action: "dismiss", id: target.id }, offerUndo);
      else {
        const { kind, title, person, source, url, sessionId } = target.item;
        call(`${STATUS_TODO_ROUTE}/dismiss`, { item: { kind, title, person, source, url, sessionId } }, offerUndo);
      }
    }, [call, offerUndo]),
    restore: useCallback((key: string) => {
      setUndo(u => (u?.key === key ? null : u));
      call(`${STATUS_TODO_ROUTE}/restore`, { key });
    }, [call]),
    undo,
  };
}
