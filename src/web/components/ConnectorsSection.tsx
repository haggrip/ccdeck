// Settings › Connectors: the person's claude.ai connectors as their own Claude
// Code reaches them (claude-agent.mjs, through GET /api/connectors), with a
// switch for each read-only tool, and the ledger of what the deck's runs cost.
//
// ONLY READ-ONLY TOOLS GET A SWITCH. A tool its server does not mark read-only
// — one that sends, edits, deletes, or is not marked at all — is counted under
// its connector and never listed as something to turn on; the server refuses
// to enable one anyway (setEnabledTools). Every tool starts off.
//
// A CONNECTOR IS A GROUP, folded until opened: Linear alone has forty
// read-only tools, and the reader came for one or two. The caption says how
// many are on, so a folded connector still answers "what can the deck read".
//
// THE LEDGER is the deck's last runs as the server keeps them: when, which
// feature asked, the model, the cost, the tool calls and the outcome. Never
// what was asked or answered, which the server does not keep either.
import { useEffect, useRef, useState } from "react";
import { SettingRow, SettingsGroup, SettingsInfo } from "./SettingsParts";
import { useT } from "../i18n";

interface Tool { name: string; title: string; readOnly: boolean }
interface Connector { server: string; label: string; source: string; status: string; tools: Tool[] }
interface Run { at: number; ok: boolean; code: string; tag: string; model: string; costUsd: number; durationMs: number; toolCalls: number }
interface ConnectorsState {
  ok: boolean; vetoed: boolean; listedAt: number; code: string; error: string;
  connectors: Connector[]; enabled: string[]; runs: Run[];
}

/** A cost the way the ledger prints it: cents for anything under a cent. */
export function money(usd: number): string {
  const v = Number.isFinite(usd) ? usd : 0;
  return v > 0 && v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

/** The connectors worth a group — connected, with a read-only tool to turn
 *  on — and the names of the rest: connected with nothing read-only (a group
 *  of no switches would read "0 of 0"), and known but not connected. */
export function splitConnectors(list: readonly Connector[]): { reachable: Connector[]; writeOnly: string[]; offline: string[] } {
  const connected = list.filter(c => c.status === "connected" && c.tools.length > 0);
  const reachable = connected.filter(c => c.tools.some(tool => tool.readOnly));
  const writeOnly = connected.filter(c => !c.tools.some(tool => tool.readOnly)).map(c => c.label);
  const offline = list.filter(c => c.status !== "connected").map(c => c.label);
  return { reachable, writeOnly, offline };
}

export default function ConnectorsSection() {
  const t = useT();
  const [state, setState] = useState<ConnectorsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const live = useRef(true);
  const saving = useRef(false);

  const load = (refresh = false) => {
    setLoading(true);
    fetch(`/api/connectors${refresh ? "?refresh=1" : ""}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: ConnectorsState) => { if (!live.current) return; if (!d?.ok) throw new Error(); setState(d); setFailed(false); })
      .catch(() => { if (live.current) setFailed(true); })
      .finally(() => { if (live.current) setLoading(false); });
  };
  useEffect(() => { live.current = true; load(); return () => { live.current = false; }; }, []);

  const enabled = new Set(state?.enabled ?? []);
  const toggle = async (tool: string) => {
    if (!state || saving.current) return;
    saving.current = true;
    const next = new Set(enabled);
    if (next.has(tool)) next.delete(tool); else next.add(tool);
    setState({ ...state, enabled: [...next] });
    try {
      const r = await fetch("/api/connectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tools: [...next] }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) throw new Error();
      if (live.current) { setState(d); setSaveFailed(false); }
    } catch {
      if (live.current) { setState(state); setSaveFailed(true); }
    } finally { saving.current = false; }
  };
  const flipOpen = (server: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(server)) next.delete(server); else next.add(server);
    return next;
  });

  const { reachable, writeOnly, offline } = splitConnectors(state?.connectors ?? []);
  const status = (() => {
    if (state?.vetoed) return t("connectors.vetoed");
    if (failed) return t("connectors.readFail");
    if (!state) return loading ? t("connectors.loading") : "";
    if (state.code === "claude_missing") return t("connectors.error.missing");
    if (state.code === "not_signed_in") return t("connectors.error.signedOut");
    if (state.code) return t("connectors.error.other", { error: state.error || state.code });
    if (loading) return t("connectors.loading");
    if (!reachable.length) return t("connectors.empty");
    return "";
  })();
  const runs = state?.runs ?? [];
  const total = runs.reduce((sum, r) => sum + (Number.isFinite(r.costUsd) ? r.costUsd : 0), 0);

  return <>
    <SettingsGroup id="connectors-list-title" title={t("connectors.group.list")} note={t("connectors.group.listNote")} list={false}
      settingId="connectors-list"
      aside={!state?.vetoed && <button type="button" className="btn" disabled={loading} onClick={() => load(true)}>{t("connectors.refresh")}</button>}>
      {status && <SettingsInfo>{status}</SettingsInfo>}
      {saveFailed && <p role="alert">{t("connectors.saveFail")}</p>}
      {writeOnly.length > 0 && !state?.vetoed && <p className="settings-caption-note">{t("connectors.noReadOnly", { names: writeOnly.join(", ") })}</p>}
      {offline.length > 0 && !state?.vetoed && <p className="settings-caption-note">{t("connectors.notConnected", { names: offline.join(", ") })}</p>}
    </SettingsGroup>
    {!state?.vetoed && reachable.map(c => {
      const readOnly = c.tools.filter(tool => tool.readOnly);
      const writing = c.tools.length - readOnly.length;
      const on = readOnly.filter(tool => enabled.has(tool.name)).length;
      const shown = open.has(c.server);
      const id = `connectors-${c.server}`;
      return (
        <SettingsGroup key={c.server} id={`${id}-title`} title={c.label} list={shown}
          note={`${t("connectors.summary", { on, total: readOnly.length })} · ${t("connectors.writeTools", { count: writing })}`}
          aside={<button type="button" className="btn" aria-expanded={shown} onClick={() => flipOpen(c.server)}>
            {shown ? t("connectors.hideTools") : t("connectors.showTools")}
          </button>}>
          {shown
            ? readOnly.map(tool => (
                <SettingRow key={tool.name} as="div" name={tool.title} control={
                  <button type="button" className="switch" role="switch" aria-checked={enabled.has(tool.name)}
                    aria-label={t("connectors.toolAria", { tool: tool.title, connector: c.label })} onClick={() => void toggle(tool.name)}>
                    <span className="switch-knob" />
                  </button>
                } />
              ))
            : null}
        </SettingsGroup>
      );
    })}
    <SettingsGroup id="connectors-runs-title" title={t("connectors.group.runs")} note={t("connectors.group.runsNote")} settingId="connectors-runs"
      aside={runs.length > 0 && <span className="settings-caption-note">{t("connectors.runs.total", { cost: money(total) })}</span>}>
      {runs.length === 0
        ? <SettingRow as="div" name={t("connectors.runs.none")} />
        : runs.map((r, i) => (
          <SettingRow key={`${r.at}-${i}`} as="div"
            name={`${new Date(r.at).toLocaleTimeString()}${r.tag ? ` · ${r.tag}` : ""}`}
            note={`${r.model} · ${t("connectors.runs.tools", { count: r.toolCalls })} · ${r.ok ? t("connectors.runs.ok") : t("connectors.runs.failed", { code: r.code })}`}
            control={<span>{money(r.costUsd)}</span>} />
        ))}
    </SettingsGroup>
  </>;
}
