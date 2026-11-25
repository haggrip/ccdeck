// A session's link into the Claude desktop app, when the app runs it
// (src/server/desktop-sessions.mjs): the app's own claude://code/continue link,
// which brings that session up in the app, where the person drives it.
//
// Pure, so a bare-node suite can call it. The id is held to the app's own
// shape before it goes into a link, whatever the deck sent.

export const DESKTOP_SESSIONS_ROUTE = "/api/desktop-sessions";

/** { Claude Code session id: the desktop app's local_ id }. */
export type DesktopLinks = Readonly<Record<string, string>>;

const LOCAL_ID = /^local_[A-Za-z0-9-]{1,64}$/;

/** The link that opens a session in the desktop app, or null when the app
 *  does not run it. */
export function desktopHref(sessionId: string | undefined | null, links: DesktopLinks | null | undefined): string | null {
  if (!sessionId || !links || !Object.hasOwn(links, sessionId)) return null;
  const local = links[sessionId];
  return typeof local === "string" && LOCAL_ID.test(local) ? `claude://code/continue?session=${local}` : null;
}

export const DESKTOP_OPEN_ROUTE = "/api/desktop-sessions/open";

/** Asks the deck to bring a session up in the Claude desktop app. The deck
 *  looks the session up and opens the app's link itself (a browser does not
 *  reliably hand a claude:// link to the OS), so the page sends only the id. */
export function openInDesktop(sessionId: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<boolean> {
  return fetchFn(DESKTOP_OPEN_ROUTE, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }),
  }).then(r => r.ok, () => false);
}

/** Asks the deck to bring a Remote Control session (its claude.ai id,
 *  session_…) up in the Claude desktop app. */
export function openRemoteInDesktop(remoteId: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<boolean> {
  return fetchFn(DESKTOP_OPEN_ROUTE, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remote: remoteId }),
  }).then(r => r.ok, () => false);
}

/** Whether the desktop app runs this session. */
export function inDesktop(sessionId: string | undefined | null, links: DesktopLinks | null | undefined): boolean {
  return desktopHref(sessionId, links) != null;
}
