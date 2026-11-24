// The card's warning when one conversation runs in two or more of the deck's
// terminals at once — after a /resume inside a terminal picked a conversation
// another terminal still had open — and its one action, behind a question:
// close the older terminals, keep the newest. Nothing is closed without the
// person's yes in the dialog (use-twin-terminals.ts, resume-rebind.mjs).
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CONFIRM_LAYER } from "../modal-dismiss";
import { useT } from "../i18n";
import type { AgentNodeData } from "../types";
import { closeOlderTerminals, useTwinTerminals } from "../use-twin-terminals";
import { Dialog, DialogClose } from "./Dialog";
import { useModalDismiss, useScrimDismiss } from "./use-modal-dismiss";

type Bearing = Pick<AgentNodeData, "kind" | "sessionId">;

/** The row, on a root card whose session two or more deck terminals hold. */
export function TwinTerminalsRow({ data }: { data: Bearing }) {
  const t = useT();
  const s = useTwinTerminals();
  const [asking, setAsking] = useState(false);
  const sid = data.sessionId.toLowerCase();
  const count = s.counts.get(sid) ?? 0;
  if (data.kind !== "root" || count < 2) return null;
  const closing = s.closing.has(sid);
  const failed = s.failed.has(sid);
  return (
    <div className="twin-row" role="status" title={failed ? t("board.twins.failed") : t("board.twins.tip", { count })}>
      <span className="twin-said">{failed ? t("board.twins.failed") : t("board.twins.badge", { count })}</span>
      <button
        type="button"
        className="twin-close"
        aria-busy={closing || undefined}
        onClick={e => { e.stopPropagation(); if (!closing) setAsking(true); }}
      >{closing ? t("board.twins.closing") : t("board.twins.close")}</button>
      {asking && (
        <TwinCloseConfirm
          onCancel={() => setAsking(false)}
          onConfirm={() => { setAsking(false); void closeOlderTerminals(sid); }}
        />
      )}
    </div>
  );
}

function TwinCloseConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const t = useT();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useModalDismiss(onCancel, { focusRef: cancelRef, layer: CONFIRM_LAYER });
  const scrimPress = useScrimDismiss(onCancel);
  // On the page, not in the card: a card is drawn under the canvas's
  // transform, and a fixed scrim inside it would be placed and scaled with the
  // card. Presses inside are the dialog's own, not the node's.
  return createPortal(
    <div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      <Dialog scrim={scrimPress} dialogRef={dialogRef} className="clear-confirm" labelledBy="twin-confirm-title">
        <header className="modal-head">
          <div className="modal-title">
            <span id="twin-confirm-title" className="modal-tool-name">{t("board.twins.title")}</span>
          </div>
          <div className="modal-actions">
            <DialogClose onClick={onCancel} label={t("board.twins.cancel")} />
          </div>
        </header>
        <section className="modal-body cc-body">
          <p className="cc-final">{t("board.twins.body")}</p>
        </section>
        <footer className="modal-foot">
          <button type="button" ref={cancelRef} className="btn" onClick={onCancel}>{t("board.twins.cancel")}</button>
          <button type="button" className="btn danger" onClick={onConfirm}>{t("board.twins.confirm")}</button>
        </footer>
      </Dialog>
    </div>,
    document.body,
  );
}
