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
