// Which sessions the Claude desktop app runs (desktop-links.ts), and which the
// person archived there, read when the caller mounts and again every POLL_MS
// while it stays: a session started or archived in the app since shows within
// that time. A deck that cannot answer leaves every session on its card and in
// the lists, as before.
import { useEffect, useState } from "react";
import { DESKTOP_SESSIONS_ROUTE, type DesktopLinks } from "./desktop-links";

export const POLL_MS = 20_000;

export interface DesktopSessions {
  links: DesktopLinks;
  /** Claude Code session ids the desktop app has archived. */
  archived: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

/** The ids out of the route's answer: strings only, and the same set (by
 *  identity) when nothing changed, so what keys off it does not rebuild. */
export function archivedFrom(raw: unknown, had: ReadonlySet<string>): ReadonlySet<string> {
  const ids = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  if (ids.length === had.size && ids.every(id => had.has(id))) return had;
  return ids.length ? new Set(ids) : NONE;
}

export function useDesktopSessions(fetchFn: typeof fetch = (...a) => fetch(...a)): DesktopSessions {
  const [state, setState] = useState<DesktopSessions>({ links: {}, archived: NONE });
  useEffect(() => {
    let alive = true;
    const read = () => {
      fetchFn(DESKTOP_SESSIONS_ROUTE).then(r => r.json()).then((v: { ok?: boolean; links?: unknown; archived?: unknown }) => {
        if (!alive || !v?.ok || !v.links || typeof v.links !== "object") return;
        setState(was => ({ links: v.links as DesktopLinks, archived: archivedFrom(v.archived, was.archived) }));
      }, () => {});
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per mount
  }, []);
  return state;
}
