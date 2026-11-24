// Acting on a paired deck's session from this deck (src/server/lan-control.mjs):
// what the row of a machine that takes commands offers under the session.
//
// What it offers follows the session's state as that deck shared it: Allow and
// Deny while a permission prompt waits, the option numbers while a question is
// asked, a prompt otherwise; Interrupt and Stop whenever it is live. Allow and
// Stop ask to be pressed again before anything is sent (the owner's rule for
// the two commands that cannot be taken back). The other deck checks every
// command again, and says why when it refuses one; that answer is shown here.
import { useRef, useState } from "react";
import { selfPressAccepted, selfPressProps } from "../panel-press";
import { useT } from "../i18n";
import type { RemoteSession } from "../remote-sessions";

export type ControlAction = "prompt" | "allow" | "deny" | "answer" | "interrupt" | "stop";
export const CONTROL_ROUTE = "/api/lan/control";
/** The options a question's dialog numbers, as buttons. */
export const ANSWER_CHOICES = [1, 2, 3, 4] as const;
/** The commands that are sent only on a second press. */
export const CONFIRMED: readonly ControlAction[] = ["allow", "stop"];

export async function sendControl(fp: string, sid: string, action: ControlAction, extra: { text?: string; choice?: number } = {}, send: typeof fetch = fetch): Promise<{ ok: boolean; why?: string }> {
  try {
    const res = await send(CONTROL_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fp, sid, action, ...extra }),
    });
    const body = await res.json().catch(() => null) as { ok?: unknown; why?: unknown } | null;
    return body?.ok === true ? { ok: true } : { ok: false, why: typeof body?.why === "string" ? body.why : "refused" };
  } catch {
    return { ok: false, why: "unreachable" };
  }
}

export default function RemoteSessionControl({ fp, session, send = sendControl }: {
  fp: string; session: RemoteSession; send?: typeof sendControl;
}) {
  const t = useT();
  const [text, setText] = useState("");
  // The press rule (#518, #620): a command in flight marks the controls busy
  // and is refused again in the handler, off a ref; it never disables them.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [armed, setArmed] = useState<ControlAction | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; line: string } | null>(null);
  if (session.state === "ended") return null;

  const go = async (action: ControlAction, extra: { text?: string; choice?: number } = {}) => {
    if (!selfPressAccepted(busyRef.current)) return;
    if (CONFIRMED.includes(action) && armed !== action) { setArmed(action); return; }
    setArmed(null);
    busyRef.current = true;
    setBusy(true);
    const r = await send(fp, session.id, action, extra);
    busyRef.current = false;
    setBusy(false);
    setSaid(r.ok ? { ok: true, line: t("lan.control.done") } : { ok: false, line: t("lan.control.refused", { why: r.why ?? "" }) });
    if (r.ok && action === "prompt") setText("");
  };

  const waitsPermission = session.state === "waiting" && session.waiting === "permission";
  const asks = session.state === "waiting" && session.waiting === "asked";
  return (
    <li className="sl-remote-control" data-remote-control={session.id}>
      {waitsPermission && (
        <span className="rsc-row">
          <button type="button" className="btn rsc-btn" {...selfPressProps(busy)} data-armed={armed === "allow" || undefined}
            onClick={() => void go("allow")}>{armed === "allow" ? t("lan.control.confirmAllow") : t("lan.control.allow")}</button>
          <button type="button" className="btn rsc-btn" {...selfPressProps(busy)} onClick={() => void go("deny")}>{t("lan.control.deny")}</button>
        </span>
      )}
      {asks && (
        <span className="rsc-row" role="group" aria-label={t("lan.control.answerGroup")}>
          {ANSWER_CHOICES.map(n => (
            <button key={n} type="button" className="btn rsc-btn" {...selfPressProps(busy)} onClick={() => void go("answer", { choice: n })}
              aria-label={t("lan.control.answer", { n })}>{n}</button>
          ))}
        </span>
      )}
      {!waitsPermission && !asks && (
        <form className="rsc-row" onSubmit={e => { e.preventDefault(); if (text.trim()) void go("prompt", { text }); }}>
          <input className="rsc-input" value={text} onChange={e => setText(e.target.value)} maxLength={8000} {...selfPressProps(busy)}
            placeholder={t("lan.control.placeholder")} aria-label={t("lan.control.promptAria", { title: session.name || session.project || session.id })} />
          <button type="submit" className="btn rsc-btn" {...selfPressProps(busy, !text.trim())}>{t("lan.control.send")}</button>
        </form>
      )}
      <span className="rsc-row">
        {session.state === "working" && (
          <button type="button" className="btn rsc-btn" {...selfPressProps(busy)} onClick={() => void go("interrupt")}>{t("lan.control.interrupt")}</button>
        )}
        <button type="button" className="btn rsc-btn rsc-stop" {...selfPressProps(busy)} data-armed={armed === "stop" || undefined}
          onClick={() => void go("stop")}>{armed === "stop" ? t("lan.control.confirmStop") : t("lan.control.stop")}</button>
        {armed && <button type="button" className="btn rsc-btn" onClick={() => setArmed(null)}>{t("lan.control.cancel")}</button>}
      </span>
      {said && <span className={`rsc-said${said.ok ? "" : " bad"}`} role="status">{said.line}</span>}
    </li>
  );
}
