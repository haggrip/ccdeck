// Area "connectors" — zh-CN. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "连接器",
  "connectors.section.note": "你的 claude.ai 连接器和 Claude Code 自带的工具，通过你的 Claude Code 使用。",
  "connectors.group.list": "你的 Claude Code 可以使用的工具",
  "connectors.group.listNote": "除非你关闭，每个工具都处于开启状态。一次运行可以使用任何已开启的工具，包括 shell 以及会发送或删除内容的工具；它从 Slack、Jira 或 GitHub 读到的文字可能夹带指令。",
  "connectors.refresh": "刷新",
  "connectors.loading": "正在询问 Claude Code 能连接哪些连接器…",
  "connectors.vetoed": "AGENTS_DECK_NO_AGENT=1 让此功能在这台电脑上保持关闭。",
  "connectors.readFail": "deck 无法读取连接器列表。请尝试刷新。",
  "connectors.error.missing": "这台电脑没有安装 Claude Code，或 deck 找不到它。",
  "connectors.error.signedOut": "Claude Code 尚未登录。运行 claude 并登录，然后点按刷新。",
  "connectors.error.other": "Claude Code 无法列出其连接器：{error}",
  "connectors.empty": "Claude Code 还没有可连接的连接器。在 claude.ai 添加一个，然后点按刷新。",
  "connectors.saveFail": "该更改未保存。请重试。",
  "connectors.notConnected": "Claude Code 已知但未连接：{names}",
  "connectors.summary": "已开启的工具：{on} / {total}",
  "connectors.writeTools": "可修改内容的工具：{count}",
  "connectors.showTools": "显示工具",
  "connectors.hideTools": "隐藏工具",
  "connectors.toolAria": "允许 deck 使用 {tool}（{connector}）",
  "connectors.group.runs": "最近运行",
  "connectors.group.runsNote": "每次运行都会使用你的 Claude 套餐。提问和回答的内容都不会保留。",
  "connectors.runs.total": "合计：{cost}",
  "connectors.runs.none": "还没有运行。",
  "connectors.runs.tools": "工具调用：{count}",
  "connectors.runs.ok": "已回答",
  "connectors.runs.failed": "失败：{code}",
  "connectors.tool.writes": "可修改内容",
};

export default catalog;
