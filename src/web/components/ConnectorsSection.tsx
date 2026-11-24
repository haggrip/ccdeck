// Settings › Connectors: Claude Code's own tools and the person's connectors as
// their Claude Code reaches them (claude-agent.mjs, through GET
// /api/connectors), with a switch for every tool, and the ledger of what the
// deck's runs cost and which tools they called.
//
// EVERY TOOL IS ON UNTIL IT IS SWITCHED OFF (the owner's call, 2026-11-23): the
// shell, file edits and the connector tools that send, create or delete
// included. The group's note says what that means — a run can use any tool
// that is on, and text it reads from Slack or Jira can carry instructions — and
// a tool that can change things says so on its row.
//
// A CONNECTOR IS A GROUP, folded until opened: Linear alone has seventy-eight
// tools. The caption says how many are on, so a folded connector still answers
// "what can the deck use".
//
// THE LEDGER is the deck's last runs as the server keeps them: when, which
// feature asked, the model, the cost, the tools called and the outcome. Never
// what was asked or answered, which the server does not keep either.
import { useEffect, useRef, useState } from "react";
import { SettingRow, SettingsGroup, SettingsInfo } from "./SettingsParts";
import { useT } from "../i18n";
import { selfPressAccepted, selfPressProps } from "../panel-press";

interface Tool { name: string; title: string; readOnly: boolean }
interface Connector { server: string; label: string; source: string; status: string; tools: Tool[] }
interface Run { at: number; ok: boolean; code: string; tag: string; model: string; costUsd: number; durationMs: number; toolCalls: number; tools?: string[]; refused?: string[] }
interface ConnectorsState {
  ok: boolean; vetoed: boolean; listedAt: number; code: string; error: string;
  connectors: Connector[]; enabled: string[]; off: string[]; runs: Run[];
}

/** A cost the way the ledger prints it: cents for anything under a cent. */
export function money(usd: number): string {
  const v = Number.isFinite(usd) ? usd : 0;
  return v > 0 && v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

/** The connectors worth a group — connected, with tools — and the names of
 *  the ones Claude Code knows of but cannot use right now. */
export function splitConnectors(list: readonly Connector[]): { reachable: Connector[]; offline: string[] } {
  const reachable = list.filter(c => c.status === "connected" && c.tools.length > 0);
  const offline = list.filter(c => c.status !== "connected").map(c => c.label);
  return { reachable, offline };
}

/** `off` with `tool` switched the other way. */
export function flipped(off: readonly string[], tool: string): string[] {
  return off.includes(tool) ? off.filter(t => t !== tool) : [...off, tool];
}

export default function ConnectorsSection() {
  const t = useT();
  const [state, setState] = useState<ConnectorsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [open, setOpen] = useState<readonly string[]>([]);
  const live = useRef(true);
  const saving = useRef(false);
  const loadingRef = useRef(false);

  const load = (refresh = false) => {
    loadingRef.current = true;
    setLoading(true);
    fetch(`/api/connectors${refresh ? "?refresh=1" : ""}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: ConnectorsState) => { if (!live.current) return; if (!d?.ok) throw new Error(); setState(d); setFailed(false); })
      .catch(() => { if (live.current) setFailed(true); })
      .finally(() => { loadingRef.current = false; if (live.current) setLoading(false); });
  };
  useEffect(() => { live.current = true; load(); return () => { live.current = false; }; }, []);

  const off = state?.off ?? [];
  const toggle = async (tool: string) => {
    if (!state || saving.current) return;
    saving.current = true;
    const next = flipped(off, tool);
    setState({ ...state, off: next });
    try {
      const r = await fetch("/api/connectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ off: next }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) throw new Error();
      if (live.current) { setState(d); setSaveFailed(false); }
    } catch {
      if (live.current) { setState(state); setSaveFailed(true); }
    } finally { saving.current = false; }
  };
  const flipOpen = (server: string) => setOpen(prev => flipped(prev, server));

  const { reachable, offline } = splitConnectors(state?.connectors ?? []);
  const status = (() => {
    if (state?.vetoed) return t("connectors.vetoed");
    if (failed) return t("connectors.readFail");
    if (!state) return loading ? t("connectors.loading") : "";
    if (state.code === "claude_missing") return t("connectors.error.missing");
    if (state.code === "not_signed_in") return t("connectors.error.signedOut");
    if (state.code) return t("connectors.error.other", { error: state.error || state.code });
    if (loading) return t("connectors.loading");
    if (!reachable.some(c => c.source !== "builtin")) return t("connectors.empty");
    return "";
  })();
  const runs = state?.runs ?? [];
  const total = runs.reduce((sum, r) => sum + (Number.isFinite(r.costUsd) ? r.costUsd : 0), 0);

  return <>
    <SettingsGroup id="connectors-list-title" title={t("connectors.group.list")} note={t("connectors.group.listNote")} list={false}
      settingId="connectors-list"
      aside={!state?.vetoed && <button type="button" className="btn" {...selfPressProps(loading)} onClick={() => { if (!selfPressAccepted(loadingRef.current)) return; load(true); }}>{t("connectors.refresh")}</button>}>
      {status && <SettingsInfo>{status}</SettingsInfo>}
      {saveFailed && <p role="alert">{t("connectors.saveFail")}</p>}
      {offline.length > 0 && !state?.vetoed && <p className="settings-caption-note">{t("connectors.notConnected", { names: offline.join(", ") })}</p>}
    </SettingsGroup>
    {!state?.vetoed && reachable.map(c => {
      const writing = c.tools.filter(tool => !tool.readOnly).length;
      const on = c.tools.filter(tool => !off.includes(tool.name)).length;
      const shown = open.includes(c.server);
      return (
        <SettingsGroup key={c.server} id={`connectors-${c.server}-title`} title={c.label} list={shown}
          note={`${t("connectors.summary", { on, total: c.tools.length })} · ${t("connectors.writeTools", { count: writing })}`}
          aside={<button type="button" className="btn" aria-expanded={shown} onClick={() => flipOpen(c.server)}>
            {shown ? t("connectors.hideTools") : t("connectors.showTools")}
          </button>}>
          {shown
            ? c.tools.map(tool => (
                <SettingRow key={tool.name} as="div" name={tool.title} note={tool.readOnly ? undefined : t("connectors.tool.writes")} control={
                  <button type="button" className="switch" role="switch" aria-checked={!off.includes(tool.name)}
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
            note={[r.model, t("connectors.runs.tools", { count: r.toolCalls }), r.ok ? t("connectors.runs.ok") : t("connectors.runs.failed", { code: r.code }), ...(r.tools?.length ? [r.tools.join(", ")] : []), ...(r.refused?.length ? [t("connectors.runs.refused", { tools: r.refused.join(", ") })] : [])].join(" · ")}
            control={<span>{money(r.costUsd)}</span>} />
        ))}
    </SettingsGroup>
  </>;
}
