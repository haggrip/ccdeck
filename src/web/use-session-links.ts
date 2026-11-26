// Each session's PRs and tickets, and the session each open Todo item is
// about (session-links.ts), read when Mission mounts and again every POLL_MS
// while it stays. A deck that cannot answer leaves the rows without chips and
// the items as they were.
import { useEffect, useState } from "react";
import { NO_LINKS, SESSION_LINKS_ROUTE, linksFrom, type SessionLinksView } from "./session-links";

export const POLL_MS = 20_000;

export function useSessionLinks(fetchFn: typeof fetch = (...a) => fetch(...a)): SessionLinksView {
  const [view, setView] = useState<SessionLinksView>(NO_LINKS);
  useEffect(() => {
    let alive = true;
    const read = () => {
      fetchFn(SESSION_LINKS_ROUTE).then(r => r.json()).then((v: unknown) => {
        if (alive && (v as { ok?: boolean } | null)?.ok) setView(linksFrom(v));
      }, () => {});
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per mount
  }, []);
  return view;
}
