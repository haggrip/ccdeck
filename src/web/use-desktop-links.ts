// Which sessions the Claude desktop app runs (desktop-links.ts), read when the
// caller mounts and again every POLL_MS while it stays: a session started in
// the app since is linked within that time. A deck that cannot answer leaves
// every session on its card, as before.
import { useEffect, useState } from "react";
import { DESKTOP_SESSIONS_ROUTE, type DesktopLinks } from "./desktop-links";

export const POLL_MS = 20_000;

export function useDesktopLinks(fetchFn: typeof fetch = (...a) => fetch(...a)): DesktopLinks {
  const [links, setLinks] = useState<DesktopLinks>({});
  useEffect(() => {
    let alive = true;
    const read = () => {
      fetchFn(DESKTOP_SESSIONS_ROUTE).then(r => r.json()).then((v: { ok?: boolean; links?: unknown }) => {
        if (alive && v?.ok && v.links && typeof v.links === "object") setLinks(v.links as DesktopLinks);
      }, () => {});
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per mount
  }, []);
  return links;
}
