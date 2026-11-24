// Area "connectors" — ko. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "커넥터",
  "connectors.section.note": "claude.ai 커넥터와 Claude Code 자체 도구를 내 Claude Code를 통해 사용합니다.",
  "connectors.group.list": "내 Claude Code가 쓸 수 있는 도구",
  "connectors.group.listNote": "끄지 않는 한 모든 도구가 켜져 있습니다. 실행은 켜진 도구를 무엇이든 쓸 수 있으며 셸과 보내거나 지우는 도구도 포함됩니다. Slack, Jira, GitHub에서 읽은 텍스트에는 지시가 들어 있을 수 있습니다.",
  "connectors.refresh": "새로 고침",
  "connectors.loading": "Claude Code에 닿는 커넥터를 묻는 중…",
  "connectors.vetoed": "AGENTS_DECK_NO_AGENT=1 때문에 이 컴퓨터에서는 꺼져 있습니다.",
  "connectors.readFail": "deck이 커넥터 목록을 읽지 못했습니다. 새로 고침을 눌러 보세요.",
  "connectors.error.missing": "이 컴퓨터에 Claude Code가 설치되어 있지 않거나 deck이 찾지 못했습니다.",
  "connectors.error.signedOut": "Claude Code에 로그인되어 있지 않습니다. claude를 실행해 로그인한 뒤 새로 고침을 누르세요.",
  "connectors.error.other": "Claude Code가 커넥터 목록을 가져오지 못했습니다: {error}",
  "connectors.empty": "Claude Code가 닿는 커넥터가 아직 없습니다. claude.ai에서 추가한 뒤 새로 고침을 누르세요.",
  "connectors.saveFail": "변경 사항이 저장되지 않았습니다. 다시 시도하세요.",
  "connectors.notConnected": "Claude Code가 알지만 연결되지 않음: {names}",
  "connectors.summary": "켜진 도구: {total}개 중 {on}개",
  "connectors.writeTools": "변경할 수 있는 도구: {count}",
  "connectors.showTools": "도구 보기",
  "connectors.hideTools": "도구 숨기기",
  "connectors.toolAria": "deck이 {tool}을(를) 쓰도록 허용 ({connector})",
  "connectors.group.runs": "최근 실행",
  "connectors.group.runsNote": "실행할 때마다 Claude 요금제를 사용합니다. 질문과 답변 내용은 보관하지 않습니다.",
  "connectors.runs.total": "합계: {cost}",
  "connectors.runs.none": "아직 실행이 없습니다.",
  "connectors.runs.tools": "도구 호출: {count}",
  "connectors.runs.ok": "응답함",
  "connectors.runs.failed": "실패: {code}",
  "connectors.tool.writes": "변경할 수 있음",
};

export default catalog;
