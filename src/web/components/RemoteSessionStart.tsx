// Starting a new Claude Code session on a paired deck that takes commands from
// this one (src/server/lan-control.mjs `start`): a folder on that machine, and
// that deck's own Command Panel launches Claude Code there, in its own tmux,
// as its New session would. The new session then shows in the machine's group
// like any other once it reports, with the command strip under it.
//
// The folder is that machine's: an absolute path, or `~/…` for its home. The
// other deck checks it, and says why when it refuses; that answer is shown.
// The last folder used is remembered per machine, in this browser only.
import { useRef, useState } from "react";
import { selfPressAccepted, selfPressProps } from "../panel-press";
import { useT } from "../i18n";
import { readStored, writeStored } from "../storage";
import { sendControl } from "./RemoteSessionControl";

/** Where the last folder used on each machine is kept, per browser. */
export const LAST_FOLDER_KEY = "agent-dag.remoteStartFolder";

function folders(): Record<string, unknown> {
  try {
    const all = JSON.parse(readStored(LAST_FOLDER_KEY) ?? "{}") as unknown;
    return all && typeof all === "object" && !Array.isArray(all) ? all as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function lastFolder(fp: string): string {
  const v = folders()[fp];
  return typeof v === "string" ? v : "";
}

function keepFolder(fp: string, cwd: string) {
  writeStored(LAST_FOLDER_KEY, JSON.stringify({ ...folders(), [fp]: cwd }));
}

/** A launch key the panel's launcher accepts, so a retry starts no second agent. */
export function startKey(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `lan-${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`;
}

export default function RemoteSessionStart({ fp, machine, send = sendControl }: {
  fp: string; machine: string; send?: typeof sendControl;
}) {
  const t = useT();
  const [cwd, setCwd] = useState(() => lastFolder(fp));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [said, setSaid] = useState<{ ok: boolean; line: string } | null>(null);

  const go = async () => {
    const folder = cwd.trim();
    if (!folder || !selfPressAccepted(busyRef.current)) return;
    busyRef.current = true;
    setBusy(true);
    const r = await send(fp, "", "start", { cwd: folder, key: startKey() });
    busyRef.current = false;
    setBusy(false);
    if (r.ok) keepFolder(fp, folder);
    setSaid(r.ok ? { ok: true, line: t("lan.control.started") } : { ok: false, line: t("lan.control.refused", { why: r.why ?? "" }) });
  };

  return (
    <li className="sl-remote-control sl-remote-start" data-remote-start={fp}>
      <form className="rsc-row" onSubmit={e => { e.preventDefault(); void go(); }}>
        <input className="rsc-input" value={cwd} onChange={e => setCwd(e.target.value)} maxLength={1024} {...selfPressProps(busy)}
          placeholder={t("lan.control.folderPlaceholder")} aria-label={t("lan.control.folderAria", { machine })} spellCheck={false} />
        <button type="submit" className="btn rsc-btn" {...selfPressProps(busy, !cwd.trim())}>{t("lan.control.start")}</button>
      </form>
      {said && <span className={`rsc-said${said.ok ? "" : " bad"}`} role="status">{said.line}</span>}
    </li>
  );
}
