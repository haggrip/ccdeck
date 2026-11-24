// Area "connectors" — ja. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "コネクタ",
  "connectors.section.note": "claude.ai のコネクタと Claude Code 自身のツールを、ご自身の Claude Code を通して使います。",
  "connectors.group.list": "Claude Code が使えるツール",
  "connectors.group.listNote": "オフにしない限り、すべてのツールがオンです。実行ではオンのツールをどれでも使えます。シェルや送信・削除を行うツールも含まれ、Slack・Jira・GitHub から読んだテキストに指示が含まれていることがあります。",
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
  "connectors.summary": "オンのツール: {on} / {total}",
  "connectors.writeTools": "変更できるツール: {count}",
  "connectors.showTools": "ツールを表示",
  "connectors.hideTools": "ツールを隠す",
  "connectors.toolAria": "deck に {tool} の使用を許可（{connector}）",
  "connectors.group.runs": "最近の実行",
  "connectors.group.runsNote": "実行のたびに Claude のプランを使います。質問や回答の内容は保存されません。",
  "connectors.runs.total": "合計: {cost}",
  "connectors.runs.none": "まだ実行はありません。",
  "connectors.runs.tools": "ツール呼び出し: {count}",
  "connectors.runs.ok": "回答済み",
  "connectors.runs.failed": "失敗: {code}",
  "connectors.runs.refused": "拒否（未許可）: {tools}",
  "connectors.tool.writes": "変更できます",
};

export default catalog;
