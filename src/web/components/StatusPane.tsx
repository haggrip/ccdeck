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
// with its time: GitHub, Slack and Jira through read-only connector tools. Each
// item opens its PR, message or ticket in the browser. Nothing here posts,
// sends or changes anything anywhere: the only writes are the pane's own
// settings and the people pinned or hidden, in the deck's own file.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useT, type TFunction } from "../i18n";
import { KitIcon } from "./kit-icons";
import { ExternalLinkGlyph, RefreshGlyph } from "./action-glyphs";
import SheetHandle from "./SheetHandle";
import SelectShell from "./SelectShell";
import { selfPressAccepted, selfPressProps } from "../panel-press";
import PanelFoldHead from "./PanelFoldHead";
import { agoWords } from "../shell-ago";
import {
  BRIEF_EVERY, BRIEF_MODELS, liveItems, localBrief, peopleShown, safeHref,
  type BriefItem, type BriefModel, type BriefPerson, type BriefSettings, type BriefView, type LocalBrief,
} from "../status-brief";
import { useStatusBrief, type StatusBriefHandle } from "../use-status-brief";
import type { Row } from "./SessionList";

export const STATUS_PANE_ID = "status-pane";

/** Product names, never translated (i18n/en.ts). */
const SOURCE_NAMES = { github: "GitHub", slack: "Slack", jira: "Jira" } as const;
const MODEL_NAMES: Record<BriefModel, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };

/** The words on an item's kind chip. */
export const KIND_MSGS: Record<BriefItem["kind"], string> = {
  approve: "brief.kind.approve", merge: "brief.kind.merge", review: "brief.kind.review", reply: "brief.kind.reply",
  decide: "brief.kind.decide", todo: "brief.kind.todo", fix: "brief.kind.fix", "follow-up": "brief.kind.followUp",
  feedback: "brief.kind.feedback", talk: "brief.kind.talk", answer: "brief.kind.answer", failed: "brief.kind.failed",
  read: "brief.kind.read",
};

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

/** What the brief's line under the summary says: when, which model, and the
 *  sources it read. */
function metaLine(view: BriefView, now: number, t: TFunction): string | null {
  const b = view.brief;
  if (!b) return null;
  const read = (Object.keys(SOURCE_NAMES) as (keyof typeof SOURCE_NAMES)[]).filter(s => b.reach?.[s] === "on").map(s => SOURCE_NAMES[s]);
  return t("brief.meta", {
    ago: agoWords(Math.max(0, now - b.at)),
    model: b.model ? MODEL_NAMES[b.model] : "Claude",
    sources: read.length ? read.join(", ") : t("brief.meta.sessionsOnly"),
  });
}

function ItemRow({ item, onOpenSession, t }: { item: BriefItem; onOpenSession: (id: string) => void; t: TFunction }) {
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
    </li>
  );
}

function Section({ title, id, items, empty, onOpenSession, t }: {
  title: string; id: string; items: BriefItem[]; empty: string; onOpenSession: (id: string) => void; t: TFunction;
}) {
  return (
    <section className="stp-section" aria-labelledby={id}>
      <h3 className="stp-h" id={id}>{title}{items.length > 0 && <span className="stp-n">{items.length}</span>}</h3>
      {items.length ? (
        <ul className="stp-list">{items.map((it, i) => <ItemRow key={`${it.kind}:${it.sessionId ?? it.url ?? ""}:${i}`} item={it} onOpenSession={onOpenSession} t={t} />)}</ul>
      ) : <p className="stp-empty">{empty}</p>}
    </section>
  );
}

function People({ people, onPerson, t }: {
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

function Settings({ view, handle, t }: { view: BriefView; handle: StatusBriefHandle; t: TFunction }) {
  const s: BriefSettings = view.settings;
  const reach = view.brief?.reach;
  return (
    <div className="stp-settings" id="stp-settings">
      <label className="stp-field">
        <span>{t("brief.settings.model")}</span>
        <SelectShell><select className="sm-select" value={s.model} onChange={e => handle.setSettings({ model: e.target.value as BriefModel })}>
          {BRIEF_MODELS.map(m => <option key={m} value={m}>{MODEL_NAMES[m]}</option>)}
        </select></SelectShell>
      </label>
      <label className="stp-field">
        <span>{t("brief.settings.every")}</span>
        <SelectShell><select className="sm-select" value={s.everyMinutes} onChange={e => handle.setSettings({ everyMinutes: Number(e.target.value) as BriefSettings["everyMinutes"] })}>
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
          </label>
        ))}
      </fieldset>
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
export default function StatusPane(props: Omit<StatusPaneProps, "brief">) {
  const brief = useStatusBrief();
  return <StatusPaneView {...props} brief={brief} />;
}

export interface StatusPaneProps {
  rows: readonly Row[];
  now: number;
  brief: StatusBriefHandle;
  pinned: boolean;
  onTogglePin: () => void;
  /** The Inspector is open beside it, in the Board's right column. */
  besideInspector: boolean;
  onOpenSession: (sessionId: string) => void;
  onClose: () => void;
}

export function StatusPaneView({ rows, now, brief, pinned, onTogglePin, besideInspector, onOpenSession, onClose }: StatusPaneProps) {
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
  const liveIds = new Set([...local.waiting, ...local.todo].map(i => i.sessionId));
  const fromBrief = (items: BriefItem[] | undefined) => liveItems(items ?? [], sessions).filter(i => !(i.source === "session" && liveIds.has(i.sessionId)));
  const waiting = [...local.waiting, ...fromBrief(b?.waiting)];
  const todo = [...local.todo, ...fromBrief(b?.todo)];
  const talkTo = fromBrief(b?.talkTo);
  const people = view ? peopleShown(b?.people ?? [], view.people) : [];

  let state: ReactNode = null;
  if (!view) state = brief.unreachable ? <p className="stp-flag">{t("brief.unreachable")}</p> : null;
  else if (view.running) state = <p className="stp-state" aria-live="polite">{t("brief.refreshing")}</p>;
  else if (view.agent === "off") state = <p className="stp-state">{t("brief.agentOff")}</p>;
  else if (!b) state = <p className="stp-state">{t("brief.none")}</p>;
  const failed = view?.error && (!b || view.error.at >= b.at) ? view.error : null;

  return (
    <aside className="status-pane" id={STATUS_PANE_ID} aria-labelledby="stp-title"
      data-pinned={pinned ? "" : undefined} data-fold={folded ? "inspector" : undefined}>
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
            {b?.summary && <p className="stp-summary-text">{b.summary}</p>}
            {view && b && <p className="stp-meta">{metaLine(view, now, t)}</p>}
            {state}
            {failed && <p className="stp-flag">{t("brief.failed", { message: failed.message || failed.code })}</p>}
          </section>
          <Section title={t("brief.section.waiting")} id="stp-waiting" items={waiting} empty={t("brief.section.empty")} onOpenSession={onOpenSession} t={t} />
          <Section title={t("brief.section.todo")} id="stp-todo" items={todo} empty={t("brief.section.empty")} onOpenSession={onOpenSession} t={t} />
          <Section title={t("brief.section.talk")} id="stp-talk" items={talkTo} empty={t("brief.section.empty")} onOpenSession={onOpenSession} t={t} />
          <People people={people} onPerson={brief.person} t={t} />
        </div>
      )}
    </aside>
  );
}
