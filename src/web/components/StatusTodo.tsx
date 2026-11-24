// The Status pane's live Todo list (src/server/status-todo.mjs): what waits on
// you and what you have to do, kept by the deck, the brief, your own words and
// the sessions that post to it, and closed on its own when the deck can see it
// is done. Every item opens where it came from: its session's card, its PR,
// thread or ticket, or at least names its project.
//
// It is inside the pane, so it goes wherever the pane goes, pinned or not.
// Nothing here sends anything anywhere: the box hands your words to the list's
// keeper, and the buttons close, dismiss, reopen and snooze items on this deck
// alone.
import { useState, type FormEvent } from "react";
import type { TFunction } from "../i18n";
import { KitIcon, KitStateGlyph } from "./kit-icons";
import { ExternalLinkGlyph } from "./action-glyphs";
import { isOverdue, isSnoozed, openerOf, splitOpen, tomorrowMorning, whenShort, type TodoItem } from "../status-todo";
import type { StatusTodoHandle } from "../use-status-todo";
import type { DesktopLinks } from "../desktop-links";
import { KIND_MSGS } from "./status-kinds";

const SOURCE_NAMES: Record<string, string> = { pr: "GitHub", slack: "Slack", ticket: "Jira" };
const ORIGIN_MSGS = {
  deck: "brief.todo.from.deck", brief: "brief.todo.from.brief", hagai: "brief.todo.from.hagai", session: "brief.todo.from.session",
} as const;

function sourceName(item: TodoItem, t: TFunction, desktop?: boolean): string {
  const k = item.link?.kind;
  if (desktop) return t("brief.source.desktop");
  if (k === "session") return t("brief.source.session");
  if (k === "project") return item.link?.project ?? t("brief.source.project");
  if (k === "url") { try { return new URL(item.link!.url!).hostname; } catch { return ""; } }
  if (k === "ticket" && item.link?.url && /linear\.app/.test(item.link.url)) return "Linear";
  return k ? SOURCE_NAMES[k] ?? "" : "";
}

function Row({ item, now, sessions, desktop, onOpenSession, act, dismiss, t }: {
  item: TodoItem; now: number; sessions: ReadonlySet<string>; desktop?: DesktopLinks;
  onOpenSession: (id: string) => void; act: StatusTodoHandle["act"]; dismiss: StatusTodoHandle["dismiss"]; t: TFunction;
}) {
  const open = openerOf(item, sessions, desktop);
  const snoozed = isSnoozed(item, now);
  const overdue = isOverdue(item, now);
  const label = (
    <>
      <span className="stp-title">{item.title}</span>
      {item.detail && <span className="stp-detail">{item.detail}</span>}
    </>
  );
  // Where it leads, its project beside a session, and where it came from: each
  // a part of its own, a dot between them and none before the first.
  const parts = [sourceName(item, t, !!open.desktop) || null, (open.desktop || open.session) && item.link?.project ? item.link.project : null, t(ORIGIN_MSGS[item.origin])]
    .filter((p): p is string => !!p);
  const meta = (
    <span className="stp-src">
      {parts.map((p, i) => <span key={i} className="stp-sep">{p}{i === 0 && (open.desktop || open.href) ? <ExternalLinkGlyph /> : null}</span>)}
    </span>
  );
  return (
    <li className="stp-item stp-todo-item" data-kind={item.kind} data-snoozed={snoozed ? "" : undefined} data-overdue={overdue ? "" : undefined}>
      <span className="stp-kind">{t(KIND_MSGS[item.kind])}</span>
      {open.desktop ? (
        // The OS hands claude:// to the desktop app; no new tab is opened.
        <a className="stp-link" href={open.desktop} title={t("brief.open.desktop")}>{label}{meta}</a>
      ) : open.session ? (
        <button type="button" className="stp-link" onClick={() => onOpenSession(open.session!)} title={t("brief.open.session")}>{label}{meta}</button>
      ) : open.href ? (
        <a className="stp-link" href={open.href} target="_blank" rel="noreferrer noopener" title={t("brief.open.link", { source: sourceName(item, t) })}>{label}{meta}</a>
      ) : (
        <span className="stp-link">{label}{meta}</span>
      )}
      <span className="stp-todo-side">
        {item.due && !snoozed && (
          <span className="stp-due" data-overdue={overdue ? "" : undefined}>
            {t(overdue ? "brief.todo.overdue" : "brief.todo.due", { time: whenShort(item.due, now) })}
          </span>
        )}
        {snoozed && <span className="stp-due">{t("brief.todo.snoozed", { time: whenShort(item.snoozedUntil!, now) })}</span>}
        <span className="stp-person-acts">
          {open.desktop && open.session && (
            <button type="button" className="glyph-btn stp-todo-card" onClick={() => onOpenSession(open.session!)}
              aria-label={t("brief.open.session")} title={t("brief.open.session")}><KitIcon name="board" /></button>
          )}
          {snoozed ? (
            <button type="button" className="glyph-btn stp-todo-wake" onClick={() => act("unsnooze", item.id)}
              aria-label={t("brief.todo.unsnooze", { title: item.title })} title={t("brief.todo.unsnooze", { title: item.title })}><KitIcon name="play" /></button>
          ) : (
            <button type="button" className="glyph-btn stp-todo-snooze" onClick={() => act("snooze", item.id, tomorrowMorning(now))}
              aria-label={t("brief.todo.snooze", { title: item.title })} title={t("brief.todo.snooze", { title: item.title })}><KitIcon name="time" /></button>
          )}
          <button type="button" className="glyph-btn stp-todo-done" onClick={() => act("close", item.id)}
            aria-label={t("brief.todo.close", { title: item.title })} title={t("brief.todo.close", { title: item.title })}><KitStateGlyph name="done" /></button>
          {dismiss && (
            <button type="button" className="glyph-btn stp-dismiss" onClick={() => dismiss({ id: item.id })}
              aria-label={t("brief.dismiss", { title: item.title })} title={t("brief.dismiss", { title: item.title })}><KitIcon name="close" /></button>
          )}
        </span>
      </span>
    </li>
  );
}

function List({ id, title, items, ...rest }: {
  id: string; title: string; items: TodoItem[]; now: number; sessions: ReadonlySet<string>; desktop?: DesktopLinks;
  onOpenSession: (id: string) => void; act: StatusTodoHandle["act"]; dismiss: StatusTodoHandle["dismiss"]; t: TFunction;
}) {
  return (
    <section className="stp-section" aria-labelledby={id}>
      <h3 className="stp-h" id={id}>{title}{items.length > 0 && <span className="stp-n">{items.length}</span>}</h3>
      {items.length
        ? <ul className="stp-list">{items.map(i => <Row key={i.id} item={i} {...rest} />)}</ul>
        : <p className="stp-empty">{rest.t("brief.section.empty")}</p>}
    </section>
  );
}

export default function StatusTodo({ todo, now, sessions, desktop, onOpenSession, t }: {
  todo: StatusTodoHandle; now: number; sessions: ReadonlySet<string>;
  /** Which sessions the Claude desktop app runs: those open there. */
  desktop?: DesktopLinks;
  onOpenSession: (id: string) => void; t: TFunction;
}) {
  const [draft, setDraft] = useState("");
  const view = todo.view;
  const { waiting, todo: rest } = splitOpen(view?.open ?? []);
  const closed = view?.closed ?? [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const words = draft.trim();
    if (!words) return;
    todo.say(words);
    setDraft("");
  };
  const reading = view?.keeperReading === true;
  const failed = view?.keeper.error && view.keeper.error.code !== "agent-off" ? view.keeper.error : null;
  return (
    <div className="stp-todo">
      <form className="stp-say" onSubmit={submit}>
        <input type="text" className="ui-input stp-say-input" value={draft} onChange={e => setDraft(e.target.value)} maxLength={500}
          placeholder={t("brief.todo.placeholder")} aria-label={t("brief.todo.placeholder")} />
        <button type="submit" className="glyph-btn stp-say-send" aria-label={t("brief.todo.say")} title={t("brief.todo.say")}
          disabled={!draft.trim()}><KitIcon name="plus" /></button>
      </form>
      {reading && <p className="stp-state" aria-live="polite">{t("brief.todo.reading")}</p>}
      {failed && <p className="stp-flag">{t("brief.todo.keeperFailed", { message: failed.message || failed.code })}</p>}
      <List id="stp-waiting" title={t("brief.section.waiting")} items={waiting} now={now} sessions={sessions} desktop={desktop} onOpenSession={onOpenSession} act={todo.act} dismiss={todo.dismiss} t={t} />
      <List id="stp-todo" title={t("brief.section.todo")} items={rest} now={now} sessions={sessions} desktop={desktop} onOpenSession={onOpenSession} act={todo.act} dismiss={todo.dismiss} t={t} />
      {closed.length > 0 && (
        <details className="stp-closed">
          <summary className="stp-h">{t("brief.todo.recent")}<span className="stp-n">{closed.length}</span></summary>
          <ul className="stp-list">
            {closed.map(i => (
              <li key={i.id} className="stp-item stp-todo-item" data-closed="">
                <span className="stp-kind">{t(KIND_MSGS[i.kind])}</span>
                <span className="stp-link">
                  <span className="stp-title">{i.title}</span>
                  <span className="stp-detail">{i.closedReason}</span>
                </span>
                <button type="button" className="stp-chip stp-todo-reopen" onClick={() => todo.act("reopen", i.id)}>{t("brief.todo.reopen")}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
