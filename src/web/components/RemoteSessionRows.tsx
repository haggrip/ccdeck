// The sessions paired decks share with this one, as rows at the foot of the
// Sessions list, one group per machine under the name the Local network panel
// gives it — READ-ONLY. Nothing here is a control: no row opens a terminal,
// sends, stops or selects anything, because the session is on another machine
// and this deck has no line to it. Each row says what that machine shared and
// nothing more (src/server/lan-sessions.mjs): a name, a project folder, a
// state and its age. Items of the list's own <ul>, so they scroll with it.
import { useT } from "../i18n";
import { ageShort } from "../elapsed-short";
import { orderRemote, type RemoteMachine, type RemoteSession } from "../remote-sessions";

const STATE_KEYS: Record<RemoteSession["state"], string> = {
  waiting: "lan.remote.state.waiting",
  working: "lan.remote.state.working",
  idle: "lan.remote.state.idle",
  ended: "lan.remote.state.ended",
  failed: "lan.remote.state.failed",
};
const WAIT_KEYS: Record<NonNullable<RemoteSession["waiting"]>, string> = {
  permission: "lan.remote.wait.permission",
  asked: "lan.remote.wait.asked",
  idle: "lan.remote.wait.idle",
};

export default function RemoteSessionRows({ machines, now }: { machines: readonly RemoteMachine[]; now: number }) {
  const t = useT();
  const out = [];
  for (const m of machines) {
    const rows = orderRemote(m.sessions);
    const live = rows.filter(s => s.state !== "ended");
    const ended = rows.length - live.length;
    if (rows.length === 0) continue;
    out.push(
      <li key={`remote-head-${m.fp}`} className="sl-group-head spaced sl-remote-head" data-remote-fp={m.fp}
        title={t("lan.remote.headTitle", { name: m.name })}>
        <span className="sl-remote-name">
          <span className="sl-group-label">{m.name}</span>
          <span className="sl-remote-tag">{t("lan.remote.tag")}</span>
        </span>
        <span className="sl-group-count">{live.length}</span>
      </li>,
    );
    for (const s of live) {
      const title = s.name || s.project || t("lan.remote.untitled");
      const state = s.state === "waiting" && s.waiting ? t(WAIT_KEYS[s.waiting]) : t(STATE_KEYS[s.state]);
      const age = s.since ? ageShort(s.since, now, t("lan.seen.now")) : null;
      const line = [s.name && s.project ? s.project : null, state].filter(Boolean).join(" · ");
      out.push(
        <li key={`remote-${m.fp}-${s.id}`} className="sl-remote-row" data-remote-state={s.state}
          title={t("lan.remote.rowAria", { title, state, machine: m.name })}>
          <span className="sl-remote-top">
            <span className="sl-label">{title}</span>
            {age && <span className={`sl-time ${s.state === "waiting" ? "warn" : "quiet"}`}>{age}</span>}
          </span>
          <span className="sl-line2">{line}</span>
        </li>,
      );
    }
    if (ended > 0) {
      out.push(<li key={`remote-ended-${m.fp}`} className="sl-remote-ended">{t("lan.remote.ended", { count: ended })}</li>);
    }
  }
  return <>{out}</>;
}
