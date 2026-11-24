// Area "connectors" — zh-TW. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "連接器",
  "connectors.section.note": "你的 claude.ai 連接器和 Claude Code 內建的工具，透過你的 Claude Code 使用。",
  "connectors.group.list": "你的 Claude Code 可以使用的工具",
  "connectors.group.listNote": "除非你關閉，每個工具都處於開啟狀態。一次執行可以使用任何已開啟的工具，包括 shell 以及會傳送或刪除內容的工具；它從 Slack、Jira 或 GitHub 讀到的文字可能夾帶指令。",
  "connectors.refresh": "重新整理",
  "connectors.loading": "正在詢問 Claude Code 能連到哪些連接器…",
  "connectors.vetoed": "AGENTS_DECK_NO_AGENT=1 讓此功能在這台電腦上保持關閉。",
  "connectors.readFail": "deck 無法讀取連接器清單。請嘗試重新整理。",
  "connectors.error.missing": "這台電腦沒有安裝 Claude Code，或 deck 找不到它。",
  "connectors.error.signedOut": "Claude Code 尚未登入。執行 claude 並登入，然後按重新整理。",
  "connectors.error.other": "Claude Code 無法列出其連接器：{error}",
  "connectors.empty": "Claude Code 還沒有可連到的連接器。在 claude.ai 新增一個，然後按重新整理。",
  "connectors.saveFail": "這項變更未儲存。請再試一次。",
  "connectors.notConnected": "Claude Code 已知但未連線：{names}",
  "connectors.summary": "已開啟的工具：{on} / {total}",
  "connectors.writeTools": "可修改內容的工具：{count}",
  "connectors.showTools": "顯示工具",
  "connectors.hideTools": "隱藏工具",
  "connectors.toolAria": "允許 deck 使用 {tool}（{connector}）",
  "connectors.group.runs": "最近執行",
  "connectors.group.runsNote": "每次執行都會使用你的 Claude 方案。提問與回答的內容都不會保留。",
  "connectors.runs.total": "合計：{cost}",
  "connectors.runs.none": "還沒有執行。",
  "connectors.runs.tools": "工具呼叫：{count}",
  "connectors.runs.ok": "已回答",
  "connectors.runs.failed": "失敗：{code}",
  "connectors.tool.writes": "可修改內容",
};

export default catalog;
