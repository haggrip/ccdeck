// Area "connectors" — zh-TW. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "連接器",
  "connectors.section.note": "你的 claude.ai 連接器，透過你自己的 Claude Code 讀取。僅限唯讀工具。",
  "connectors.group.list": "你的 Claude Code 能連到的連接器",
  "connectors.group.listNote": "開啟 deck 可用來讀取的唯讀工具。所有工具預設關閉，能寫入的工具從不提供。",
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
  "connectors.noReadOnly": "已連線，但沒有可提供的唯讀工具：{names}",
  "connectors.summary": "已開啟的唯讀工具：{on} / {total}",
  "connectors.writeTools": "能寫入的工具（從不提供）：{count}",
  "connectors.showTools": "顯示工具",
  "connectors.hideTools": "隱藏工具",
  "connectors.toolAria": "允許 deck 使用 {tool} 讀取（{connector}）",
  "connectors.group.runs": "最近執行",
  "connectors.group.runsNote": "每次執行都會使用你的 Claude 方案。提問與回答的內容都不會保留。",
  "connectors.runs.total": "合計：{cost}",
  "connectors.runs.none": "還沒有執行。",
  "connectors.runs.tools": "工具呼叫：{count}",
  "connectors.runs.ok": "已回答",
  "connectors.runs.failed": "失敗：{code}",
};

export default catalog;
