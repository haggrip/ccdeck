// The Remote Control group under the Sessions list: the person's Claude Remote
// Control sessions on the machines they named (src/server/remote-control-
// sessions.mjs). A press opens one in the Claude desktop app, which the deck
// asks the OS to do (desktop-links.ts); its claude.ai page is the fallback.
// Read-only here: the deck sends nothing to them.
//
// Draws nothing at all while the feature is off (a veto, or no machine named),
// so a deck that does not use it looks exactly as it did.
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { openRemoteInDesktop } from "../desktop-links";

export interface RemoteSession { id: string; title: string; status: string; startedAt: number | null; url: string }
export interface RemoteHost { host: string; ok: boolean; reason?: string; sessions: RemoteSession[] }
interface RemoteState { ok?: boolean; vetoed?: boolean; hosts?: RemoteHost[] }

/** How often the list asks again while it is on screen. The server lists at
 *  most once per 30 s whoever asks. */
export const REMOTE_POLL_MS = 30_000;

/** The rows to draw, machine by machine in the order named: every session, and
 *  a note for each machine that could not be read. Empty when there is nothing
 *  to show, and the group is then not drawn. */
export function remoteRows(state: RemoteState | null): { sessions: (RemoteSession & { host: string })[]; failed: RemoteHost[] } {
  const sessions: (RemoteSession & { host: string })[] = [];
  const failed: RemoteHost[] = [];
  if (!state?.ok || state.vetoed) return { sessions, failed };
  for (const h of state.hosts ?? []) {
    if (!h.ok) { failed.push(h); continue; }
    for (const s of h.sessions ?? []) {
      // Only links to claude.ai itself, whatever an answer says.
      if (!/^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+$/.test(s.url)) continue;
      sessions.push({ ...s, host: h.host });
    }
  }
  return { sessions, failed };
}

/** The session's claude.ai id (session_…), from its link. */
export function remoteIdOf(url: string): string | null {
  return /\/code\/(session_[A-Za-z0-9]+)$/.exec(url)?.[1] ?? null;
}

export default function RemoteControlList({ fetchState = defaultFetch, openDesktop = openRemoteInDesktop }: {
  fetchState?: () => Promise<RemoteState | null>; openDesktop?: (remoteId: string) => Promise<boolean>;
}) {
  const t = useT();
  const [state, setState] = useState<RemoteState | null>(null);
  useEffect(() => {
    let alive = true;
    const ask = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void fetchState().then(s => { if (alive) setState(s); });
    };
    ask();
    const timer = setInterval(ask, REMOTE_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [fetchState]);

  const { sessions, failed } = remoteRows(state);
  if (!sessions.length && !failed.length) return null;
  const statusWord = (s: string) => s === "busy" ? t("board.remote.busy") : s === "idle" ? t("board.remote.idle") : s;
  return (
    <ul className="sl-rows rc-rows">
      <li className="sl-group-head spaced">
        <span className="sl-group-label">{t("board.remote.title")}</span>
        <span className="sl-group-count">{sessions.length}</span>
      </li>
      {failed.map(h => (
        <li key={`failed-${h.host}`} className="rc-note">{t("board.remote.unreachable", { host: h.host })}</li>
      ))}
      {sessions.map(s => {
        const title = s.title || t("board.remote.untitled");
        return (
          <li key={`${s.host}-${s.id}`} className="sl-row-item">
            {/* A press opens it in the Claude desktop app, where sessions are
                driven; a modified press, or a deck that cannot open the app,
                keeps the claude.ai page. */}
            <a className="sl-row rc-row" href={s.url} target="_blank" rel="noopener noreferrer"
              title={t("board.remote.open", { title })}
              onClick={e => {
                const id = remoteIdOf(s.url);
                if (!id || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                void openDesktop(id).then(ok => { if (!ok) window.open(s.url, "_blank", "noopener,noreferrer"); });
              }}>
              <span className={`rc-dot ${s.status === "busy" ? "busy" : "idle"}`} aria-hidden />
              <span className="sl-text">
                <span className="sl-line1"><span className="sl-name"><span className="sl-label">{title}</span></span></span>
                <span className="sl-line2">{s.host} · {statusWord(s.status)}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

async function defaultFetch(): Promise<RemoteState | null> {
  try {
    const res = await fetch("/api/remote-control");
    return res.ok ? await res.json() as RemoteState : null;
  } catch {
    return null;
  }
}
