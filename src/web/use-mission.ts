// Mission: the deck's main page is the live Todo list and the brief
// (components/StatusPane.tsx, variant "mission"), with the Board and Workspace
// one press away. Sessions are driven in the Claude desktop app; the deck is
// mission control, and its sessions are context like Slack, GitHub and Jira.
//
// ON BY DEFAULT, and remembered per browser as Board | Workspace is
// (use-view.ts): one string in localStorage under agent-dag.mission, "0" for
// off. Board and Workspace keep their own memory under agent-dag.view, so
// leaving Mission lands on the view that was last chosen there. Never on a
// phone, whose deck is the Board alone.
import { useCallback, useState } from "react";
import { readStored, writeStored } from "./storage";

export const MISSION_KEY = "agent-dag.mission";

/** Anything but "0" reads as Mission: a browser that never chose lands on it. */
export function readMission(read: (key: string) => string | null = readStored): boolean {
  return read(MISSION_KEY) !== "0";
}

export function writeMission(on: boolean, write: (key: string, value: string) => void = writeStored): void {
  write(MISSION_KEY, on ? "1" : "0");
}

export function useMission(): { on: boolean; set(on: boolean): void } {
  const [on, setOn] = useState<boolean>(() => readMission());
  const set = useCallback((next: boolean) => {
    setOn(next);
    writeMission(next);
  }, []);
  return { on, set };
}
