// Area "connectors" — ja. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "コネクタ",
  "connectors.section.note": "claude.ai のコネクタを、ご自身の Claude Code を通して読み取ります。読み取り専用のツールのみです。",
  "connectors.group.list": "Claude Code が届くコネクタ",
  "connectors.group.listNote": "deck が読み取りに使ってよい読み取り専用ツールをオンにします。どのツールも最初はオフで、書き込みができるツールは表示されません。",
  "connectors.refresh": "更新",
  "connectors.loading": "Claude Code に届くコネクタを問い合わせています…",
  "connectors.vetoed": "AGENTS_DECK_NO_AGENT=1 により、このマシンではオフのままです。",
  "connectors.readFail": "deck はコネクタの一覧を読み取れませんでした。更新を試してください。",
  "connectors.error.missing": "Claude Code がこのマシンにインストールされていないか、deck が見つけられません。",
  "connectors.error.signedOut": "Claude Code にサインインしていません。claude を実行してサインインし、更新を押してください。",
  "connectors.error.other": "Claude Code はコネクタを一覧できませんでした: {error}",
  "connectors.empty": "Claude Code が届くコネクタはまだありません。claude.ai で追加してから更新を押してください。",
  "connectors.saveFail": "変更は保存されませんでした。もう一度お試しください。",
  "connectors.notConnected": "Claude Code は認識していますが未接続: {names}",
  "connectors.noReadOnly": "接続済みですが、読み取り専用ツールがありません: {names}",
  "connectors.summary": "オンの読み取り専用ツール: {on} / {total}",
  "connectors.writeTools": "書き込みができるツール（表示されません）: {count}",
  "connectors.showTools": "ツールを表示",
  "connectors.hideTools": "ツールを隠す",
  "connectors.toolAria": "deck に {tool} で読み取りを許可（{connector}）",
  "connectors.group.runs": "最近の実行",
  "connectors.group.runsNote": "実行のたびに Claude のプランを使います。質問や回答の内容は保存されません。",
  "connectors.runs.total": "合計: {cost}",
  "connectors.runs.none": "まだ実行はありません。",
  "connectors.runs.tools": "ツール呼び出し: {count}",
  "connectors.runs.ok": "回答済み",
  "connectors.runs.failed": "失敗: {code}",
};

export default catalog;
