// Whether the Status pane is open and whether it is pinned, each kept in the
// browser across a reload, as the right column's other panels keep theirs
// (use-right-panels.ts).
//
// PINNED IS WHAT MAKES IT STAY. An unpinned pane is like Usage and This
// machine: with the Inspector open beside it, it folds to its one header row,
// and a press opens it in place. A pinned one keeps its whole height above the
// Inspector, so the summary and what waits on you are read without a press.
// Both flags read and write through storage.ts, which survives a browser that
// blocks site data.
import { useCallback, useEffect, useState } from "react";
import { readStored, writeStored } from "./storage";

export const STATUS_PANE_OPEN_KEY = "agent-dag.statusPaneOpen";
export const STATUS_PANE_PINNED_KEY = "agent-dag.statusPanePinned";

export function useStatusPane() {
  const [open, setOpen] = useState<boolean>(() => readStored(STATUS_PANE_OPEN_KEY) === "1");
  const [pinned, setPinned] = useState<boolean>(() => readStored(STATUS_PANE_PINNED_KEY) === "1");
  useEffect(() => { writeStored(STATUS_PANE_OPEN_KEY, open ? "1" : "0"); }, [open]);
  useEffect(() => { writeStored(STATUS_PANE_PINNED_KEY, pinned ? "1" : "0"); }, [pinned]);
  const toggle = useCallback(() => setOpen(o => !o), []);
  const togglePin = useCallback(() => setPinned(p => !p), []);
  return { open, setOpen, toggle, pinned, togglePin };
}
