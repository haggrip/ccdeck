// Board | Workspace: the topbar's switch between the deck's two views of the
// same sessions (V4 Workspace, "Top bar"). A capsule of two buttons on the
// Inspector's tabs pill (detail-panel.css): a --bg-soft track, the chosen view
// a --panel chip on it, 24px tall, a 14px glyph and a 12px label each.
//
// FIRST-LOAD, NO STAGE CODE (see use-view.ts). It is drawn only where
// Workspace is on offer, so with the Command Panel off, or on a phone, the bar
// is the bar it was. Two buttons with aria-pressed rather than a tablist: it
// changes what fills the page, not what a panel under it shows, and Tab walks
// both buttons as it does the Inspector's tabs' siblings.
//
// HOW IT WAS PRESSED decides its motion (workspace.css): a click crossfades the
// middle of the deck; Enter or Space on the focused button, like the chord,
// switches at once. A click's `detail` is its count, 0 for a key.
import type { MouseEvent } from "react";
import type { View } from "../use-view";
import { useT } from "../i18n";
import { KitIcon } from "./kit-icons";
import { StatusGlyph } from "./StatusPane";

// Keys, read with `t` where they are drawn.
export const VIEW_SWITCH_LABEL_MSG = "board.view.group";
export const MISSION_LABEL_MSG = "board.view.mission";
export const BOARD_LABEL_MSG = "board.view.board";
export const WORKSPACE_LABEL_MSG = "board.view.workspace";

/** The Board. */
const BoardGlyph = () => <KitIcon name="board" className="glyph" />;

/** The Workspace: the list, the pane and the Inspector side by side. */
const WorkspaceGlyph = () => <KitIcon name="workspace" className="glyph" />;

/** Mission, the Todo list and the brief (use-mission.ts): the Status door's
 *  own glyph, a short list with ticks. */
const MissionGlyph = StatusGlyph;

/** What the switch shows: one of the two views of the sessions, or Mission. */
export type SwitchView = View | "mission";

export interface ViewSwitchProps {
  view: SwitchView;
  /** Workspace is on offer (use-view.ts workspaceOffered); else the switch is
   *  Mission | Board. */
  workspace?: boolean;
  /** `pointer` for a click, `key` for Enter or Space on the button. */
  onChange(view: SwitchView, how: "pointer" | "key"): void;
}

export default function ViewSwitch({ view, workspace = true, onChange }: ViewSwitchProps) {
  const t = useT();
  const press = (next: SwitchView) => (e: MouseEvent) => {
    if (next !== view) onChange(next, e.detail === 0 ? "key" : "pointer");
  };
  return (
    <div className="view-switch" role="group" aria-label={t(VIEW_SWITCH_LABEL_MSG)}>
      <button type="button" className="view-opt" aria-pressed={view === "mission"} onClick={press("mission")}>
        <MissionGlyph />{t(MISSION_LABEL_MSG)}
      </button>
      <button type="button" className="view-opt" aria-pressed={view === "board"} onClick={press("board")}>
        <BoardGlyph />{t(BOARD_LABEL_MSG)}
      </button>
      {workspace && (
        <button type="button" className="view-opt" aria-pressed={view === "workspace"} onClick={press("workspace")}>
          <WorkspaceGlyph />{t(WORKSPACE_LABEL_MSG)}
        </button>
      )}
    </div>
  );
}
