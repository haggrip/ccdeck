// Area "connectors" — de. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "Konnektoren",
  "connectors.section.note": "Ihre claude.ai-Konnektoren und die eigenen Werkzeuge von Claude Code, genutzt über Ihr Claude Code.",
  "connectors.group.list": "Werkzeuge, die Ihr Claude Code nutzen kann",
  "connectors.group.listNote": "Jedes Werkzeug ist an, bis Sie es ausschalten. Ein Lauf kann jedes eingeschaltete Werkzeug nutzen, auch die Shell und Werkzeuge, die senden oder löschen, und Text, den er aus Slack, Jira oder GitHub liest, kann Anweisungen enthalten.",
  "connectors.refresh": "Aktualisieren",
  "connectors.loading": "Claude Code wird gefragt, welche Konnektoren es erreicht…",
  "connectors.vetoed": "AGENTS_DECK_NO_AGENT=1 hält dies auf diesem Rechner aus.",
  "connectors.readFail": "Das Deck konnte die Liste der Konnektoren nicht lesen. Versuchen Sie Aktualisieren.",
  "connectors.error.missing": "Claude Code ist hier nicht installiert, oder das Deck findet es nicht.",
  "connectors.error.signedOut": "Claude Code ist nicht angemeldet. Starten Sie claude, melden Sie sich an und drücken Sie dann Aktualisieren.",
  "connectors.error.other": "Claude Code konnte seine Konnektoren nicht auflisten: {error}",
  "connectors.empty": "Claude Code erreicht noch keinen Konnektor. Fügen Sie auf claude.ai einen hinzu und drücken Sie dann Aktualisieren.",
  "connectors.saveFail": "Diese Änderung wurde nicht gespeichert. Versuchen Sie es erneut.",
  "connectors.notConnected": "Claude Code bekannt, aber nicht verbunden: {names}",
  "connectors.summary": "Werkzeuge an: {on} von {total}",
  "connectors.writeTools": "können etwas ändern: {count}",
  "connectors.showTools": "Werkzeuge zeigen",
  "connectors.hideTools": "Werkzeuge ausblenden",
  "connectors.toolAria": "Dem Deck erlauben, {tool} zu nutzen ({connector})",
  "connectors.group.runs": "Letzte Läufe",
  "connectors.group.runsNote": "Jeder Lauf nutzt Ihren Claude-Plan. Von Frage und Antwort wird nichts aufbewahrt.",
  "connectors.runs.total": "Gesamt: {cost}",
  "connectors.runs.none": "Noch keine Läufe.",
  "connectors.runs.tools": "Werkzeugaufrufe: {count}",
  "connectors.runs.ok": "beantwortet",
  "connectors.runs.failed": "fehlgeschlagen: {code}",
  "connectors.runs.refused": "abgelehnt, nicht freigegeben: {tools}",
  "connectors.tool.writes": "Kann etwas ändern",
};

export default catalog;
