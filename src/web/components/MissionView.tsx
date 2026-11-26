// Mission: the deck's main page (use-mission.ts). A context-aware task manager
// for the person at the keyboard: what needs them now, what is next, and the
// live context those come from (sessions, GitHub, Slack, Jira), each one press
// from where it is acted on.
//
// THE PAGE, TOP TO BOTTOM. A header that counts what matters in colour (waiting
// on you, failed, working, unread, to do); the brief, as a briefing; the box
// that takes your own words; Now (someone waits on you) and Next (things to
// do), each task a card whose colour says what kind of ask it is; and beside
// them the live context: the sessions running right now, what moved on GitHub
// since the brief, who to talk to and the people worth watching.
//
// SESSIONS ARE CONTEXT. A session's task or row goes to its card on the Board,
// and "Open in Claude Desktop" brings it up in the desktop app, where it is
// driven (desktop-links.ts). The deck opens the app's link itself: a browser
// does not reliably hand a claude:// link to the OS.
//
// Data and writes are the Status pane's own (use-status-brief.ts,
// use-status-todo.ts); nothing here posts or sends anywhere but the deck.
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useT, type TFunction } from "../i18n";
import { KitIcon, KitStateGlyph } from "./kit-icons";
import { ExternalLinkGlyph, RefreshGlyph } from "./action-glyphs";
import { KIND_MSGS } from "./status-kinds";
import { Dismissed, People, Settings, Since, UndoLine, metaLine } from "./StatusPane";
import { selfPressAccepted, selfPressProps } from "../panel-press";
import { liveItems, localBrief, peopleShown, safeHref, type BriefItem } from "../status-brief";
import { isOverdue, isSnoozed, openerOf, splitOpen, tomorrowMorning, whenShort, type TodoItem, type TodoKind } from "../status-todo";
import { inDesktop, type DesktopLinks } from "../desktop-links";
import { useStatusBrief, type StatusBriefHandle } from "../use-status-brief";
import { useStatusTodo, type StatusTodoHandle } from "../use-status-todo";
import { NO_LINKS, prStateWords, prTone, type SessionLinks, type SessionLinksView } from "../session-links";
import { useSessionLinks } from "../use-session-links";
import { rank, type Row } from "./SessionList";

export const MISSION_ID = "mission";

/** What colour a task is: the kind of ask it is, not where it came from. */
export type Tone = "ask" | "err" | "review" | "talk" | "do" | "note";
const TONES: Record<TodoKind, Tone> = {
  answer: "ask", decide: "ask", approve: "ask",
  failed: "err", fix: "err",
  review: "review", merge: "review",
  reply: "talk",
  todo: "do", "follow-up": "do",
  note: "note",
};
export const toneOf = (k: TodoKind): Tone => TONES[k] ?? "do";

/** Where a task leads, as a short brand name and a key for its colour. */
export function sourceOf(item: TodoItem, desktop: boolean): { key: string; name: string } | null {
  const l = item.link;
  if (desktop) return { key: "claude", name: "Claude Desktop" };
  if (!l) return null;
  if (l.kind === "pr") return { key: "github", name: "GitHub" };
  if (l.kind === "slack") return { key: "slack", name: "Slack" };
  if (l.kind === "ticket") return l.url && /linear\.app/.test(l.url) ? { key: "linear", name: "Linear" } : { key: "jira", name: "Jira" };
  if (l.kind === "session") return { key: "session", name: "Session" };
  if (l.kind === "url") { try { return { key: "web", name: new URL(l.url!).hostname }; } catch { return null; } }
  return null;
}

const ORIGIN_MSGS = {
  deck: "brief.todo.from.deck", brief: "brief.todo.from.brief", hagai: "brief.todo.from.hagai", session: "brief.todo.from.session",
} as const;

/** The Claude mark, small: what the desktop button carries. */
function ClaudeGlyph() {
  return (
    <svg className="glyph mi-claude-glyph" width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path fill="currentColor" d="M7 1.2l1.1 3.5 3.5-1.6-2.2 3.1 3.4 1.1-3.6.6 1.6 3.3-3.1-2.1L7 12.8 6.3 9.1l-3.1 2.1 1.6-3.3-3.6-.6 3.4-1.1-2.2-3.1 3.5 1.6z" />
    </svg>
  );
}

export function DesktopButton({ label, onPress, compact = false }: { label: string; onPress: () => void; compact?: boolean }) {
  return (
    <button type="button" className="mi-desktop" data-compact={compact || undefined} onClick={onPress} title={label} aria-label={label}>
      <ClaudeGlyph />{!compact && <span>{label}</span>}
    </button>
  );
}

function Task({ item, now, sessions, desktop, linked, onOpenSession, onOpenDesktop, act, dismiss, t }: {
  item: TodoItem; now: number; sessions: ReadonlySet<string>; desktop: DesktopLinks;
  /** The session its PR or ticket is worked on in (session-links.ts). */
  linked?: string;
  onOpenSession: (id: string) => void; onOpenDesktop: (id: string) => void;
  act: StatusTodoHandle["act"]; dismiss: StatusTodoHandle["dismiss"]; t: TFunction;
}) {
  const open = openerOf(item, sessions, desktop, linked);
  const snoozed = isSnoozed(item, now);
  const overdue = isOverdue(item, now);
  const src = sourceOf(item, !!open.desktop && !open.href);
  const title = <span className="mi-task-title-text">{item.title}</span>;
  // The title goes where the task is acted on: its session's card, its page,
  // else the desktop app for a session the board no longer has.
  const head = open.session ? (
    <button type="button" className="mi-task-title" onClick={() => open.desktop ? onOpenDesktop(open.desktop) : onOpenSession(open.session!)}
      title={t(open.desktop ? "brief.open.desktop" : "brief.open.session")}>{title}</button>
  ) : open.href ? (
    <a className="mi-task-title" href={open.href} target="_blank" rel="noreferrer noopener" title={t("brief.open.link", { source: src?.name ?? "" })}>{title}<ExternalLinkGlyph /></a>
  ) : open.desktop ? (
    <button type="button" className="mi-task-title" onClick={() => onOpenDesktop(open.desktop!)} title={t("brief.open.desktop")}>{title}</button>
  ) : <span className="mi-task-title">{title}</span>;
  return (
    <li className="mi-task" data-tone={toneOf(item.kind)} data-snoozed={snoozed ? "" : undefined} data-overdue={overdue ? "" : undefined}>
      <div className="mi-task-body">
        <div className="mi-task-top">
          <span className="mi-kind">{t(KIND_MSGS[item.kind])}</span>
          {head}
        </div>
        {item.detail && <p className="mi-task-detail">{item.detail}</p>}
        <div className="mi-task-meta">
          {src && <span className="mi-src" data-src={src.key}>{src.name}</span>}
          {item.link?.project && <span className="mi-proj">{item.link.project}</span>}
          <span className="mi-origin">{t(ORIGIN_MSGS[item.origin])}</span>
          {item.due && !snoozed && (
            <span className="mi-due" data-overdue={overdue ? "" : undefined}>
              {t(overdue ? "brief.todo.overdue" : "brief.todo.due", { time: whenShort(item.due, now) })}
            </span>
          )}
          {snoozed && <span className="mi-due">{t("brief.todo.snoozed", { time: whenShort(item.snoozedUntil!, now) })}</span>}
        </div>
      </div>
      <div className="mi-task-acts">
        {open.desktop && <DesktopButton label={t("brief.open.desktop")} onPress={() => onOpenDesktop(open.desktop!)} />}
        <span className="mi-glyphs">
          {snoozed ? (
            <button type="button" className="glyph-btn" onClick={() => act("unsnooze", item.id)}
              aria-label={t("brief.todo.unsnooze", { title: item.title })} title={t("brief.todo.unsnooze", { title: item.title })}><KitIcon name="play" /></button>
          ) : (
            <button type="button" className="glyph-btn" onClick={() => act("snooze", item.id, tomorrowMorning(now))}
              aria-label={t("brief.todo.snooze", { title: item.title })} title={t("brief.todo.snooze", { title: item.title })}><KitIcon name="time" /></button>
          )}
          <button type="button" className="glyph-btn mi-done" onClick={() => act("close", item.id)}
            aria-label={t("brief.todo.close", { title: item.title })} title={t("brief.todo.close", { title: item.title })}><KitStateGlyph name="done" /></button>
          {dismiss && (
            <button type="button" className="glyph-btn" onClick={() => dismiss({ id: item.id })}
              aria-label={t("brief.dismiss", { title: item.title })} title={t("brief.dismiss", { title: item.title })}><KitIcon name="close" /></button>
          )}
        </span>
      </div>
    </li>
  );
}

function Group({ id, tone, title, items, empty, children }: { id: string; tone: "now" | "next"; title: string; items: TodoItem[]; empty: string; children: ReactNode }) {
  return (
    <section className="mi-group" data-group={tone} aria-labelledby={id}>
      <h3 className="mi-h" id={id}>{title}<span className="mi-n">{items.length}</span></h3>
      {items.length ? <ul className="mi-tasks">{children}</ul> : <p className="mi-empty">{empty}</p>}
    </section>
  );
}

/** A session's live state, in the order the page lists them. Working is the
 *  Sessions list's Working group (rank 2), as the header counts it: a session
 *  never given a prompt is Ready there, not at work, and is not listed. */
type LiveState = "waiting" | "failed" | "working" | "unread";
export function liveState(r: Row): LiveState | null {
  if (r.waiting && r.waiting.kind !== "idle") return "waiting";
  // Stopped on a question (the desktop app's end-of-turn call): it waits on the
  // person as surely as a permission prompt does.
  if (r.wrap?.ask?.blocked && rank(r) !== 2) return "waiting";
  if (r.state === "err" && r.unseen) return "failed";
  if (rank(r) === 2) return "working";
  if (r.unseen && r.turnEndedAt != null) return "unread";
  return null;
}
const LIVE_ORDER: LiveState[] = ["waiting", "failed", "working", "unread"];
const LIVE_MSGS = {
  waiting: "brief.mission.live.waiting", failed: "brief.mission.live.failed", working: "brief.mission.live.working", unread: "brief.mission.live.unread",
} as const;

/** A session's PRs and tickets, each a chip that opens its page, on a line of
 *  its own under the session's row (session-links.ts). A PR's colour is its
 *  state as the brief's gh reads last saw it, and its title says it. */
export function SessionChips({ links, t }: { links: SessionLinks | undefined; t: TFunction }) {
  if (!links || (!links.prs.length && !links.keys.length)) return null;
  return (
    <ul className="mi-live-links" role="list" aria-label={t("brief.mission.links")}>
      {links.prs.map(pr => {
        const name = pr.repo && pr.number != null ? `${pr.repo}#${pr.number}` : pr.url;
        const title = [name, ...prStateWords(pr).map(k => t(k))].join(" · ");
        return (
          <li key={pr.url}>
            <a className="mi-chip" data-kind="pr" data-tone={prTone(pr) ?? undefined} href={pr.url} target="_blank" rel="noreferrer noopener" title={title} aria-label={title}>
              {pr.number != null ? `#${pr.number}` : name}
            </a>
          </li>
        );
      })}
      {links.keys.map(k => (
        <li key={k.key}>
          {k.url
            ? <a className="mi-chip" data-kind="ticket" href={k.url} target="_blank" rel="noreferrer noopener" title={k.key}>{k.key}</a>
            : <span className="mi-chip" data-kind="ticket">{k.key}</span>}
        </li>
      ))}
    </ul>
  );
}

function Live({ rows, desktop, links, onOpenSession, onOpenDesktop, t }: {
  rows: readonly Row[]; desktop: DesktopLinks; links: SessionLinksView; onOpenSession: (id: string) => void; onOpenDesktop: (id: string) => void; t: TFunction;
}) {
  const live = rows.map(r => ({ r, s: liveState(r) })).filter((x): x is { r: Row; s: LiveState } => x.s != null)
    .sort((a, b) => LIVE_ORDER.indexOf(a.s) - LIVE_ORDER.indexOf(b.s) || b.r.lastActivity - a.r.lastActivity);
  return (
    <section className="mi-card mi-live" aria-labelledby="mi-live">
      <h3 className="mi-h" id="mi-live"><span className="mi-pulse" aria-hidden />{t("brief.mission.live")}<span className="mi-n">{live.length}</span></h3>
      {live.length ? (
        <ul className="mi-live-list">
          {live.map(({ r, s }) => {
            // A session the desktop app runs opens there; any other, its card.
            const app = inDesktop(r.sessionId, desktop);
            return (
            <li key={r.sessionId} className="mi-live-row" data-live={s}>
              <button type="button" className="mi-live-main" onClick={() => (app ? onOpenDesktop : onOpenSession)(r.sessionId)}
                title={t(app ? "brief.open.desktop" : "brief.open.session")}>
                <span className="mi-dot" aria-hidden />
                <span className="mi-live-name">{r.label}</span>
                <span className="mi-live-state">{t(LIVE_MSGS[s])}</span>
                {r.waiting?.message && s === "waiting" && <span className="mi-live-detail">{r.waiting.message}</span>}
                {/* Where the session says it stands, and what it asked: its own
                    end-of-turn words, until a prompt answers them. */}
                {r.wrap?.ask?.question && !(r.waiting?.message && s === "waiting") && (
                  <span className="mi-live-detail mi-live-ask" title={r.wrap.ask.question}>{r.wrap.ask.question}</span>
                )}
                {r.wrap?.recap && <span className="mi-live-detail mi-live-recap" title={r.wrap.recap}>{r.wrap.recap}</span>}
              </button>
              {app && <DesktopButton label={t("brief.open.desktop")} onPress={() => onOpenDesktop(r.sessionId)} />}
              <SessionChips links={links.sessions[r.sessionId]} t={t} />
            </li>
            );
          })}
        </ul>
      ) : <p className="mi-empty">{t("brief.mission.live.empty")}</p>}
    </section>
  );
}

function TalkTo({ items, onOpenSession, onDismiss, t }: { items: BriefItem[]; onOpenSession: (id: string) => void; onDismiss?: (i: BriefItem) => void; t: TFunction }) {
  return (
    <section className="mi-card" aria-labelledby="mi-talk">
      <h3 className="mi-h" id="mi-talk">{t("brief.section.talk")}<span className="mi-n">{items.length}</span></h3>
      {items.length ? (
        <ul className="mi-plain">
          {items.map((it, i) => {
            const href = safeHref(it.url);
            const label = <>{it.person && <b>{it.person}</b>}{it.person ? " · " : ""}{it.title}</>;
            return (
              <li key={`${it.kind}:${it.url ?? it.sessionId ?? ""}:${i}`} className="mi-plain-row" data-src={it.source}>
                {href ? <a href={href} target="_blank" rel="noreferrer noopener">{label}</a>
                  : it.sessionId ? <button type="button" onClick={() => onOpenSession(it.sessionId!)}>{label}</button>
                  : <span>{label}</span>}
                {onDismiss && !it.local && (
                  <button type="button" className="glyph-btn" onClick={() => onDismiss(it)}
                    aria-label={t("brief.dismiss", { title: it.title })} title={t("brief.dismiss", { title: it.title })}><KitIcon name="close" /></button>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="mi-empty">{t("brief.section.empty")}</p>}
    </section>
  );
}

export interface MissionProps {
  rows: readonly Row[];
  now: number;
  desktop: DesktopLinks;
  /** Its card on the Board. */
  onOpenSession: (sessionId: string) => void;
  /** Brought up in the Claude desktop app. */
  onOpenDesktop: (sessionId: string) => void;
  /** Each session's PRs and tickets, and the session each item is about. */
  links?: SessionLinksView;
}

/** The page as App mounts it, with its own line to the deck. */
export default function MissionView(props: MissionProps) {
  const brief = useStatusBrief();
  const todo = useStatusTodo();
  const links = useSessionLinks();
  return <MissionPage {...props} brief={brief} todo={todo} links={links} />;
}

export function MissionPage({ rows, now, desktop, onOpenSession, onOpenDesktop, links = NO_LINKS, brief, todo }: MissionProps & { brief: StatusBriefHandle; todo: StatusTodoHandle }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const local = useMemo(() => localBrief(rows), [rows]);
  const sessions = useMemo(() => new Set(rows.map(r => r.sessionId)), [rows]);
  const view = brief.view;
  const b = view?.brief ?? null;
  const runningRef = useRef(false);
  runningRef.current = view?.running === true;
  const refresh = () => { if (!selfPressAccepted(runningRef.current)) return; brief.refresh(); };

  const { waiting, todo: next } = splitOpen(todo.view?.open ?? []);
  const closed = todo.view?.closed ?? [];
  const dismissed = todo.view?.dismissed ?? [];
  const gone = new Set(dismissed.map(d => d.key));
  const talkTo = liveItems(b?.talkTo ?? [], sessions).filter(it => !it.dkey || !gone.has(it.dkey));
  const people = view ? peopleShown(b?.people ?? [], view.people) : [];
  const restore = (key: string) => todo.restore?.(key);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const words = draft.trim();
    if (!words) return;
    todo.say(words);
    setDraft("");
  };

  let state: ReactNode = null;
  if (!view) state = brief.unreachable ? <p className="mi-flag">{t("brief.unreachable")}</p> : null;
  else if (view.running) state = <p className="mi-state" aria-live="polite">{t("brief.refreshing")}</p>;
  else if (view.agent === "off") state = <p className="mi-state">{t("brief.agentOff")}</p>;
  else if (!b) state = <p className="mi-state">{t("brief.none")}</p>;
  const failed = view?.error && (!b || view.error.at >= b.at) ? view.error : null;
  const keeperFailed = todo.view?.keeper.error && todo.view.keeper.error.code !== "agent-off" ? todo.view.keeper.error : null;

  const stats: { key: string; n: number; label: string }[] = [
    { key: "ask", n: waiting.length, label: t("brief.mission.stat.waiting") },
    { key: "err", n: local.counts.failed, label: t("brief.mission.stat.failed") },
    { key: "work", n: local.counts.working, label: t("brief.mission.stat.working") },
    { key: "ok", n: local.counts.fresh, label: t("brief.mission.stat.unread") },
    { key: "do", n: next.length, label: t("brief.mission.stat.todo") },
  ];
  const rest = { now, sessions, desktop, onOpenSession, onOpenDesktop, act: todo.act, dismiss: todo.dismiss, t };

  return (
    <section className="mission" id={MISSION_ID} aria-labelledby="mi-title">
      <div className="mi-wrap">
        <header className="mi-head">
          <div className="mi-title-row">
            <h2 className="mi-title" id="mi-title">{t("board.view.mission")}</h2>
            <span className="mi-date">{new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
            <span className="mi-tools">
              <button type="button" className="glyph-btn" onClick={refresh}
                {...selfPressProps(view?.running === true, !view || view.agent === "off")}
                aria-label={t("brief.refresh")} title={t("brief.refresh")}><RefreshGlyph /></button>
              <button type="button" className="glyph-btn" aria-expanded={settingsOpen} aria-controls={settingsOpen ? "stp-settings" : undefined}
                onClick={() => setSettingsOpen(o => !o)} aria-label={t("brief.settings")} title={t("brief.settings")}><KitIcon name="settings" /></button>
            </span>
          </div>
          <ul className="mi-stats">
            {stats.map(s => (
              <li key={s.key} className="mi-stat" data-stat={s.key} data-zero={s.n === 0 ? "" : undefined}>
                <span className="mi-stat-n">{s.n}</span>
                <span className="mi-stat-label">{s.label}</span>
              </li>
            ))}
          </ul>
        </header>
        {settingsOpen && view && <div className="mi-card mi-settings"><Settings view={view} handle={brief} t={t} /></div>}

        <div className="mi-grid">
          <div className="mi-main">
            <section className="mi-brief" aria-label={t("brief.section.summary")}>
              {b?.summary && <p className="mi-brief-text">{b.summary}</p>}
              {view && b && <p className="mi-meta">{metaLine(view, now, t)}</p>}
              {state}
              {failed && <p className="mi-flag">{t("brief.failed", { message: failed.message || failed.code })}</p>}
            </section>

            <form className="mi-add" onSubmit={submit}>
              <KitIcon name="plus" />
              <input type="text" className="mi-add-input" value={draft} onChange={e => setDraft(e.target.value)} maxLength={500}
                placeholder={t("brief.todo.placeholder")} aria-label={t("brief.todo.placeholder")} />
              <button type="submit" className="mi-add-send" disabled={!draft.trim()}>{t("brief.todo.say")}</button>
            </form>
            {todo.view?.keeperReading && <p className="mi-state" aria-live="polite">{t("brief.todo.reading")}</p>}
            {keeperFailed && <p className="mi-flag">{t("brief.todo.keeperFailed", { message: keeperFailed.message || keeperFailed.code })}</p>}

            <Group id="mi-now" tone="now" title={t("brief.section.waiting")} items={waiting} empty={t("brief.mission.clear")}>
              {waiting.map(i => <Task key={i.id} item={i} linked={links.items[i.id]} {...rest} />)}
            </Group>
            <Group id="mi-next" tone="next" title={t("brief.section.todo")} items={next} empty={t("brief.section.empty")}>
              {next.map(i => <Task key={i.id} item={i} linked={links.items[i.id]} {...rest} />)}
            </Group>
            {closed.length > 0 && (
              <details className="mi-closed">
                <summary className="mi-h">{t("brief.todo.recent")}<span className="mi-n">{closed.length}</span></summary>
                <ul className="mi-plain">
                  {closed.map(i => (
                    <li key={i.id} className="mi-plain-row" data-closed="">
                      <span><s>{i.title}</s>{i.closedReason ? <span className="mi-origin"> · {i.closedReason}</span> : null}</span>
                      <button type="button" className="stp-chip" onClick={() => todo.act("reopen", i.id)}>{t("brief.todo.reopen")}</button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <aside className="mi-side" aria-label={t("brief.mission.context")}>
            <Live rows={rows} desktop={desktop} links={links} onOpenSession={onOpenSession} onOpenDesktop={onOpenDesktop} t={t} />
            {b?.activity && b.reach?.github === "on" && <div className="mi-card"><Since activity={b.activity} t={t} /></div>}
            <TalkTo items={talkTo} onOpenSession={onOpenSession} onDismiss={todo.dismiss ? it => todo.dismiss!({ item: it }) : undefined} t={t} />
            <div className="mi-card"><People people={people} onPerson={brief.person} t={t} /></div>
            <Dismissed list={dismissed} onRestore={restore} t={t} />
          </aside>
        </div>
      </div>
      <UndoLine undo={todo.undo} onUndo={restore} t={t} />
    </section>
  );
}
