// The Status pane: one place that says what is going on across the sessions,
// what waits on you, what to do next, who to talk to and the people worth
// keeping an eye on.
//
// IN THE BOARD'S RIGHT COLUMN, ON TOP. It is the same kind of thing as Usage
// and This machine: a region you open, read beside the canvas and leave open.
// It stands above them in the column (panel-place.css, status-pane.css), and
// like them it folds to its header row while the Inspector is open, unless it
// is pinned (use-status-pane.ts): pinned, it keeps its height.
//
// TWO HALVES. What the deck knows itself is drawn live from the board's rows
// (status-brief.ts localBrief): who is stuck on a question, which turn failed,
// which finished turn is unread. Each opens its card. The rest is the brief the
// user's own Claude Code wrote the last time it was asked (status-brief.mjs),
// with its time: GitHub, Slack, Jira and Linear, read and never written. Each
// item opens its PR, message or ticket in the browser. Nothing here posts,
// sends or changes anything anywhere: the only writes are the pane's own
// settings, the people pinned or hidden, and what you dismissed, in the deck's
// own files.
//
// DISMISSED STAYS DISMISSED. Any brief item, and any item on the list, has an
// × with a short Undo. The deck remembers it by its page (status-todo.mjs
// dismissKeyOf), drops it from later briefs, tells the brief to leave it out,
// and brings it back only when its source shows new activity. "N dismissed"
// under Talk to brings one back by hand.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useT, type TFunction } from "../i18n";
import { KitIcon } from "./kit-icons";
import { ExternalLinkGlyph, RefreshGlyph } from "./action-glyphs";
import SheetHandle from "./SheetHandle";
import { KIND_MSGS } from "./status-kinds";
import SelectShell from "./SelectShell";
import { selfPressAccepted, selfPressProps } from "../panel-press";
import PanelFoldHead from "./PanelFoldHead";
import { agoWords } from "../shell-ago";
import {
  BRIEF_EVERY, BRIEF_MODELS, channelNames, liveItems, localBrief, peopleShown, safeHref,
  type BriefActivity, type BriefItem, type BriefModel, type BriefPerson, type BriefSettings, type BriefView, type LocalBrief,
} from "../status-brief";
import { useStatusBrief, type StatusBriefHandle } from "../use-status-brief";
import { useStatusTodo, type StatusTodoHandle } from "../use-status-todo";
import type { Dismissal } from "../status-todo";
import StatusTodo from "./StatusTodo";
import type { Row } from "./SessionList";
import BriefPoints from "./BriefPoints";

export const STATUS_PANE_ID = "status-pane";

/** Product names, never translated (i18n/en.ts). */
const SOURCE_NAMES = { github: "GitHub", slack: "Slack", jira: "Jira", linear: "Linear" } as const;
const MODEL_NAMES: Record<BriefModel, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };

/** The words on an item's kind chip (status-kinds.ts). */
export { KIND_MSGS };

/** The one line a folded pane keeps: the live counts. */
export function countsLine(counts: LocalBrief["counts"], t: TFunction): string {
  if (counts.total === 0) return t("brief.count.none");
  const parts = [
    counts.needs ? t("brief.count.needs", { n: counts.needs }) : null,
    counts.failed ? t("brief.count.failed", { n: counts.failed }) : null,
    counts.fresh ? t("brief.count.fresh", { n: counts.fresh }) : null,
    counts.working ? t("brief.count.working", { n: counts.working }) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("brief.count.quiet");
}

/** The sources a brief read only in part, each as a line for under the
 *  summary: the model made fewer of its searches than it was asked to. */
export function readsLines(view: BriefView | null, t: TFunction): string[] {
  const reads = view?.brief?.reads;
  if (!reads) return [];
  return (Object.keys(SOURCE_NAMES) as (keyof typeof SOURCE_NAMES)[])
    .flatMap(s => {
      const r = s === "github" ? undefined : reads[s];
      return r ? [t("brief.reads.partial", { source: SOURCE_NAMES[s], done: r.done, asked: r.asked })] : [];
    });
}

/** What the brief's line under the summary says: when, which model, and the
 *  sources it read. */
export function metaLine(view: BriefView, now: number, t: TFunction): string | null {
  const b = view.brief;
  if (!b) return null;
  const read = (Object.keys(SOURCE_NAMES) as (keyof typeof SOURCE_NAMES)[]).filter(s => b.reach?.[s] === "on").map(s => SOURCE_NAMES[s]);
  return t("brief.meta", {
    ago: agoWords(Math.max(0, now - b.at)),
    model: b.model ? MODEL_NAMES[b.model] : "Claude",
    sources: read.length ? read.join(", ") : t("brief.meta.sessionsOnly"),
  });
}

function ItemRow({ item, onOpenSession, onDismiss, t }: { item: BriefItem; onOpenSession: (id: string) => void; onDismiss?: (item: BriefItem) => void; t: TFunction }) {
  const href = safeHref(item.url);
  const source = item.source === "session" ? t("brief.source.session") : SOURCE_NAMES[item.source];
  const label = (
    <>
      <span className="stp-title">{item.person ? <b>{item.person}</b> : null}{item.person ? " · " : null}{item.title}</span>
      {item.detail && <span className="stp-detail">{item.detail}</span>}
    </>
  );
  return (
    <li className="stp-item" data-kind={item.kind} data-local={item.local ? "" : undefined}>
      <span className="stp-kind">{t(KIND_MSGS[item.kind])}</span>
      {href ? (
        <a className="stp-link" href={href} target="_blank" rel="noreferrer noopener" title={t("brief.open.link", { source })}>
          {label}<span className="stp-src">{source}<ExternalLinkGlyph /></span>
        </a>
      ) : item.sessionId ? (
        <button type="button" className="stp-link" onClick={() => onOpenSession(item.sessionId!)} title={t("brief.open.session")}>
          {label}<span className="stp-src">{source}</span>
        </button>
      ) : null}
      {onDismiss && !item.local && (
        <button type="button" className="glyph-btn stp-dismiss" onClick={() => onDismiss(item)}
          aria-label={t("brief.dismiss", { title: item.title })} title={t("brief.dismiss", { title: item.title })}><KitIcon name="close" /></button>
      )}
    </li>
  );
}

function Section({ title, id, items, empty, onOpenSession, onDismiss, t }: {
  title: string; id: string; items: BriefItem[]; empty: string; onOpenSession: (id: string) => void; onDismiss?: (item: BriefItem) => void; t: TFunction;
}) {
  return (
    <section className="stp-section" aria-labelledby={id}>
      <h3 className="stp-h" id={id}>{title}{items.length > 0 && <span className="stp-n">{items.length}</span>}</h3>
      {items.length ? (
        <ul className="stp-list">{items.map((it, i) => <ItemRow key={`${it.kind}:${it.sessionId ?? it.url ?? ""}:${i}`} item={it} onOpenSession={onOpenSession} onDismiss={onDismiss} t={t} />)}</ul>
      ) : <p className="stp-empty">{empty}</p>}
    </section>
  );
}

/** Since the last brief: what moved on my PRs and the ones I review, newest
 *  first, each opening its PR. Read by the deck with gh; the excerpt is
 *  someone else's words, drawn as text. An entry already settled (merged, I
 *  approved it) is dimmed, says how in place of its kind, and is not counted. */
export function Since({ activity, t }: { activity: BriefActivity; t: TFunction }) {
  const items = activity.items;
  const open = items.filter(i => !i.settled).length;
  return (
    <section className="stp-section" aria-labelledby="stp-since">
      <h3 className="stp-h" id="stp-since">{t("brief.section.since")}{open > 0 && <span className="stp-n">{open}</span>}</h3>
      {items.length ? (
        <ul className="stp-list">
          {items.map(i => {
            const href = safeHref(i.url);
            const said = i.events.find(e => e.excerpt && e.kind !== "ci-failed");
            const label = (
              <>
                <span className="stp-title">{i.repo}{i.number != null ? `#${i.number}` : ""}{i.title ? ` · ${i.title}` : ""}</span>
                <span className="stp-detail">{i.events.map(e => e.what).join(" · ")}</span>
                {said && <q className="stp-detail">{said.excerpt}</q>}
              </>
            );
            return (
              <li key={i.url} className="stp-item" data-kind={i.mine ? "mine" : "theirs"} data-settled={i.settled}>
                <span className="stp-kind">{t(i.settled ? `brief.activity.settled.${i.settled}` : i.mine ? "brief.activity.mine" : "brief.activity.theirs")}</span>
                {href && (
                  <a className="stp-link" href={href} target="_blank" rel="noreferrer noopener" title={t("brief.open.link", { source: SOURCE_NAMES.github })}>
                    {label}<span className="stp-src">{SOURCE_NAMES.github}<ExternalLinkGlyph /></span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="stp-empty">{t("brief.activity.empty")}</p>}
      {activity.partial && <p className="stp-empty">{t("brief.activity.partial")}</p>}
    </section>
  );
}

export function People({ people, onPerson, t }: {
  people: (BriefPerson & { pinned: boolean })[];
  onPerson: (action: "pin" | "hide" | "clear", p: BriefPerson) => void;
  t: TFunction;
}) {
  return (
    <section className="stp-section" aria-labelledby="stp-people">
      <h3 className="stp-h" id="stp-people">{t("brief.section.people")}{people.length > 0 && <span className="stp-n">{people.length}</span>}</h3>
      {people.length ? (
        <ul className="stp-list stp-people">
          {people.map(p => {
            const href = safeHref(p.url);
            const name = <span className="stp-title"><b>{p.name}</b>{p.handle && p.handle !== p.name ? <span className="stp-handle"> @{p.handle}</span> : null}</span>;
            return (
              <li key={p.key} className="stp-person" data-pinned={p.pinned ? "" : undefined}>
                {href ? (
                  <a className="stp-link" href={href} target="_blank" rel="noreferrer noopener" title={t("brief.open.link", { source: p.source ? SOURCE_NAMES[p.source] : p.name })}>
                    {name}{p.why && <span className="stp-detail">{p.why}</span>}
                  </a>
                ) : <span className="stp-link">{name}{p.why && <span className="stp-detail">{p.why}</span>}</span>}
                <span className="stp-person-acts">
                  <button type="button" className="glyph-btn stp-pin-person" aria-pressed={p.pinned}
                    aria-label={t(p.pinned ? "brief.people.unpin" : "brief.people.pin", { name: p.name })}
                    title={t(p.pinned ? "brief.people.unpin" : "brief.people.pin", { name: p.name })}
                    onClick={() => onPerson(p.pinned ? "clear" : "pin", p)}><PinGlyph /></button>
                  {!p.pinned && (
                    <button type="button" className="glyph-btn stp-hide-person"
                      aria-label={t("brief.people.hide", { name: p.name })} title={t("brief.people.hide", { name: p.name })}
                      onClick={() => onPerson("hide", p)}><KitIcon name="minus" /></button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className="stp-empty">{t("brief.people.none")}</p>}
    </section>
  );
}

/** The last dismiss, for a few seconds: what went, and Undo. It sticks to the
 *  bottom of the pane, so it is in view wherever the dismissed row was, and
 *  focus moves to Undo, since the row whose × was pressed is gone. */
export function UndoLine({ undo, onUndo, t }: { undo: { key: string; title: string } | null | undefined; onUndo: (key: string) => void; t: TFunction }) {
  const ref = useRef<HTMLButtonElement>(null);
  const key = undo?.key ?? null;
  useEffect(() => { if (key) ref.current?.focus(); }, [key]);
  return (
    <p className="stp-undo" role="status" aria-live="polite">
      {undo && (
        <>
          <span className="stp-undo-text">{t("brief.dismissed.one", { title: undo.title })}</span>
          <button ref={ref} type="button" className="stp-chip stp-undo-btn" onClick={() => onUndo(undo.key)}>{t("brief.undo")}</button>
        </>
      )}
    </p>
  );
}

/** "N dismissed · show": what you dismissed, each with a way back. */
export function Dismissed({ list, onRestore, t }: { list: Dismissal[]; onRestore: (key: string) => void; t: TFunction }) {
  if (!list.length) return null;
  return (
    <details className="stp-closed stp-dismissed">
      <summary className="stp-h">{t("brief.dismissed.summary", { n: list.length })}</summary>
      <ul className="stp-list">
        {list.map(d => (
          <li key={d.key} className="stp-item stp-todo-item" data-closed="">
            <span className="stp-link"><span className="stp-title">{d.title}</span></span>
            <button type="button" className="stp-chip stp-restore" onClick={() => onRestore(d.key)}
              aria-label={t("brief.dismissed.restoreTitle", { title: d.title })}>{t("brief.dismissed.restore")}</button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A pin, on the 14 grid of the deck's other control glyphs. */
export function PinGlyph() {
  return (
    <svg className="glyph" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5.2 2h3.6M5.8 2v3.4L3.8 7.6h6.4L8.2 5.4V2M7 7.6V12" />
    </svg>
  );
}

/** The rail door's glyph: a short list with a tick, on the same grid. */
export function StatusGlyph() {
  return (
    <svg className="glyph" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 3.2l1 1 1.8-2M2 8.2l1 1 1.8-2M7 3.6h5M7 8.6h5M2.4 12h9.6" />
    </svg>
  );
}

/** The Slack channels the brief ignores: a chip each, pressed to stop
 *  ignoring it, and a box that takes "#channel" and Enter. */
function IgnoredChannels({ list, onChange, t }: { list: readonly string[]; onChange: (next: string[]) => void; t: TFunction }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const names = channelNames(draft).filter(n => !list.includes(n));
    setDraft("");
    if (names.length) onChange([...list, ...names]);
  };
  return (
    <div className="stp-ignore">
      <span className="stp-muted" id="stp-ignore-label">{t("brief.settings.slackIgnore")}</span>
      <div className="stp-hidden">
        {list.map(c => (
          <button key={c} type="button" className="stp-chip" onClick={() => onChange(list.filter(x => x !== c))}
            title={t("brief.settings.slackIgnore.remove", { channel: c })} aria-label={t("brief.settings.slackIgnore.remove", { channel: c })}>#{c} <KitIcon name="close" /></button>
        ))}
        <input type="text" className="stp-ignore-input" value={draft} maxLength={200} aria-labelledby="stp-ignore-label"
          placeholder={t("brief.settings.slackIgnore.placeholder")} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} onBlur={add} />
      </div>
    </div>
  );
}

export function Settings({ view, handle, t }: { view: BriefView; handle: StatusBriefHandle; t: TFunction }) {
  const s: BriefSettings = view.settings;
  const reach = view.brief?.reach;
  return (
    <div className="stp-settings" id="stp-settings">
      <label className="stp-field">
        <span id="stp-model-label">{t("brief.settings.model")}</span>
        <SelectShell><select className="sm-select" aria-labelledby="stp-model-label" value={s.model} onChange={e => handle.setSettings({ model: e.target.value as BriefModel })}>
          {BRIEF_MODELS.map(m => <option key={m} value={m}>{MODEL_NAMES[m]}</option>)}
        </select></SelectShell>
      </label>
      <label className="stp-field">
        <span id="stp-every-label">{t("brief.settings.every")}</span>
        <SelectShell><select className="sm-select" aria-labelledby="stp-every-label" value={s.everyMinutes} onChange={e => handle.setSettings({ everyMinutes: Number(e.target.value) as BriefSettings["everyMinutes"] })}>
          {BRIEF_EVERY.map(n => <option key={n} value={n}>{n ? t("brief.settings.everyMin", { n }) : t("brief.settings.everyOff")}</option>)}
        </select></SelectShell>
      </label>
      <fieldset className="stp-sources">
        <legend>{t("brief.settings.sources")}</legend>
        {(Object.keys(SOURCE_NAMES) as (keyof typeof SOURCE_NAMES)[]).map(src => (
          <label key={src} className="stp-check">
            <input type="checkbox" checked={s.sources[src]} onChange={e => handle.setSettings({ sources: { [src]: e.target.checked } })} />
            <span>{SOURCE_NAMES[src]}</span>
            {s.sources[src] && reach?.[src] === "none" && <span className="stp-muted">{t("brief.settings.noConnector")}</span>}
            {s.sources[src] && reach?.[src] === "disabled" && <span className="stp-muted">{t("brief.settings.toolsOff")}</span>}
            {src === "github" && s.sources.github && reach?.github === "on" && view.brief?.ghAccount && <span className="stp-muted">{t("brief.settings.ghAs", { login: view.brief.ghAccount })}</span>}
            {src === "github" && s.sources.github && reach?.github === "missing" && <span className="stp-muted">{t("brief.settings.ghMissing")}</span>}
            {src === "github" && s.sources.github && reach?.github === "logged-out" && <span className="stp-muted">{t("brief.settings.ghLoggedOut")}</span>}
            {src === "github" && s.sources.github && reach?.github === "error" && <span className="stp-muted">{t("brief.settings.ghError")}</span>}
          </label>
        ))}
      </fieldset>
      {s.sources.slack && <IgnoredChannels list={s.slackIgnore ?? []} onChange={slackIgnore => handle.setSettings({ slackIgnore })} t={t} />}
      {view.people.hidden.length > 0 && (
        <div className="stp-hidden">
          <span className="stp-muted">{t("brief.people.hiddenList")}</span>
          {view.people.hidden.map(k => (
            <button key={k} type="button" className="stp-chip" onClick={() => handle.person("clear", { key: k, name: k })}
              title={t("brief.people.unhide", { name: k })} aria-label={t("brief.people.unhide", { name: k })}>{k} <KitIcon name="plus" /></button>
          ))}
        </div>
      )}
      <p className="stp-muted stp-readonly">{t("brief.readOnly")}</p>
    </div>
  );
}

/** The pane as App mounts it: its line to the deck lives as long as it does,
 *  so a closed pane reads and runs nothing. */
export default function StatusPane(props: Omit<StatusPaneProps, "brief" | "todo">) {
  const brief = useStatusBrief();
  const todo = useStatusTodo();
  return <StatusPaneView {...props} brief={brief} todo={todo} />;
}

export interface StatusPaneProps {
  rows: readonly Row[];
  now: number;
  brief: StatusBriefHandle;
  /** The live Todo list's line to the deck (use-status-todo.ts). */
  todo: StatusTodoHandle;
  pinned: boolean;
  onTogglePin: () => void;
  /** The Inspector is open beside it, in the Board's right column. */
  besideInspector: boolean;
  /** Workspace's docked side column, in px, or 0: the pane floats beside it
   *  there rather than over it. */
  sideWidth?: number;
  onOpenSession: (sessionId: string) => void;
  onClose: () => void;
}

export function StatusPaneView({ rows, now, brief, todo, pinned, onTogglePin, besideInspector, sideWidth = 0, onOpenSession, onClose }: StatusPaneProps) {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const local = useMemo(() => localBrief(rows), [rows]);
  const sessions = useMemo(() => new Set(rows.map(r => r.sessionId)), [rows]);
  const view = brief.view;
  const b = view?.brief ?? null;
  const folded = besideInspector && !pinned && !unfolded;
  const counts = countsLine(local.counts, t);
  // A brief being written leaves the refresh enabled (#620: a press never
  // disables its own control); the handler refuses the second press instead,
  // off a ref, and the deck refuses it again (status-brief.mjs refresh).
  const runningRef = useRef(false);
  runningRef.current = view?.running === true;
  const refresh = () => { if (!selfPressAccepted(runningRef.current)) return; brief.refresh(); };

  // The brief's own items, after the deck's: a session the brief names that
  // the deck already lists live is said once, by the live row.
  // Waiting on you and To do are the live Todo list now (StatusTodo.tsx), which
  // the deck keeps from its sessions, the brief, your words and other sessions.
  // What you dismissed is left out here too, the moment you dismiss it.
  const dismissed = todo.view?.dismissed ?? [];
  const gone = new Set(dismissed.map(d => d.key));
  const talkTo = liveItems(b?.talkTo ?? [], sessions).filter(it => !it.dkey || !gone.has(it.dkey));
  const dismissItem = todo.dismiss ? (item: BriefItem) => todo.dismiss!({ item }) : undefined;
  const restore = (key: string) => todo.restore?.(key);
  const people = view ? peopleShown(b?.people ?? [], view.people) : [];

  let state: ReactNode = null;
  if (!view) state = brief.unreachable ? <p className="stp-flag">{t("brief.unreachable")}</p> : null;
  else if (view.running) state = <p className="stp-state" aria-live="polite">{t("brief.refreshing")}</p>;
  else if (view.agent === "off") state = <p className="stp-state">{t("brief.agentOff")}</p>;
  else if (!b) state = <p className="stp-state">{t("brief.none")}</p>;
  const failed = view?.error && (!b || view.error.at >= b.at) ? view.error : null;

  return (
    <aside className="status-pane" id={STATUS_PANE_ID} aria-labelledby="stp-title"
      data-pinned={pinned ? "" : undefined} data-fold={folded ? "inspector" : undefined}
      style={sideWidth > 0 ? { "--stp-side": `${sideWidth}px` } as CSSProperties : undefined}>
      <SheetHandle />
      <div className="stp-head">
        {besideInspector && !pinned ? (
          <PanelFoldHead title={t("brief.title")} titleId="stp-title" headingClass="stp-heading" summary={counts}
            open={unfolded} onToggle={() => setUnfolded(u => !u)} />
        ) : <h2 className="stp-heading" id="stp-title">{t("brief.title")}</h2>}
        {!folded && (
          <>
            <button type="button" className="glyph-btn stp-refresh" onClick={refresh}
              {...selfPressProps(view?.running === true, !view || view.agent === "off")}
              aria-label={t("brief.refresh")} title={t("brief.refresh")}><RefreshGlyph /></button>
            <button type="button" className="glyph-btn stp-settings-btn" aria-expanded={settingsOpen} aria-controls={settingsOpen ? "stp-settings" : undefined}
              onClick={() => setSettingsOpen(o => !o)} aria-label={t("brief.settings")} title={t("brief.settings")}><KitIcon name="settings" /></button>
          </>
        )}
        <button type="button" className="glyph-btn stp-pin" aria-pressed={pinned} onClick={onTogglePin}
          aria-label={t(pinned ? "brief.unpin" : "brief.pin")} title={t(pinned ? "brief.unpin" : "brief.pin")}><PinGlyph /></button>
        <button type="button" className="glyph-btn stp-close" onClick={onClose} aria-label={t("brief.close")} title={t("brief.close")}><KitIcon name="close" /></button>
      </div>
      {!folded && (
        <div className="stp-body">
          <p className="stp-counts">{counts}</p>
          {settingsOpen && view && <Settings view={view} handle={brief} t={t} />}
          <section className="stp-summary" aria-label={t("brief.section.summary")}>
            {b?.points?.length ? <BriefPoints points={b.points} className="stp-points" />
              : b?.summary && <p className="stp-summary-text">{b.summary}</p>}
            {view && b && <p className="stp-meta">{metaLine(view, now, t)}</p>}
            {readsLines(view, t).map(line => <p key={line} className="stp-flag">{line}</p>)}
            {state}
            {failed && <p className="stp-flag">{t("brief.failed", { message: failed.message || failed.code })}</p>}
          </section>
          {b?.activity && b.reach?.github === "on" && <Since activity={b.activity} t={t} />}
          <StatusTodo todo={todo} now={now} sessions={sessions} onOpenSession={onOpenSession} t={t} />
          <Section title={t("brief.section.talk")} id="stp-talk" items={talkTo} empty={t("brief.section.empty")} onOpenSession={onOpenSession} onDismiss={dismissItem} t={t} />
          <Dismissed list={dismissed} onRestore={restore} t={t} />
          <People people={people} onPerson={brief.person} t={t} />
          <UndoLine undo={todo.undo} onUndo={restore} t={t} />
        </div>
      )}
    </aside>
  );
}
