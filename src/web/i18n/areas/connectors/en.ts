// Area "connectors" — English. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "Connectors",
  "connectors.section.note": "Claude Code tools and your claude.ai connectors, used through your own Claude Code.",
  "connectors.group.list": "Tools your Claude Code can use",
  "connectors.group.listNote": "Every tool is on unless you switch it off. A run can use any tool that is on, the shell and tools that send or delete included, and text it reads from Slack, Jira or GitHub can carry instructions.",
  "connectors.refresh": "Refresh",
  "connectors.loading": "Asking Claude Code which connectors it reaches…",
  "connectors.vetoed": "AGENTS_DECK_NO_AGENT=1 keeps this off on this machine.",
  "connectors.readFail": "The deck could not read its connectors list. Try Refresh.",
  "connectors.error.missing": "Claude Code is not installed here, or the deck cannot find it.",
  "connectors.error.signedOut": "Claude Code is not signed in. Run claude, sign in, then press Refresh.",
  "connectors.error.other": "Claude Code could not list its connectors: {error}",
  "connectors.empty": "Claude Code reaches no connector yet. Add one on claude.ai, then press Refresh.",
  "connectors.saveFail": "That change was not saved. Try again.",
  "connectors.notConnected": "Known to Claude Code but not connected: {names}",
  "connectors.summary": "Tools on: {on} of {total}",
  "connectors.writeTools": "can change things: {count}",
  "connectors.showTools": "Show tools",
  "connectors.hideTools": "Hide tools",
  "connectors.toolAria": "Let the deck use {tool} ({connector})",
  "connectors.group.runs": "Recent runs",
  "connectors.group.runsNote": "Each run uses your Claude plan. Nothing of what was asked or answered is kept.",
  "connectors.runs.total": "Total: {cost}",
  "connectors.runs.none": "No runs yet.",
  "connectors.runs.tools": "tool calls: {count}",
  "connectors.runs.ok": "answered",
  "connectors.runs.failed": "failed: {code}",
  "connectors.tool.writes": "Can change things",
};

export default catalog;
