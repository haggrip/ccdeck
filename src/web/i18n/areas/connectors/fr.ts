// Area "connectors" — fr. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "Connecteurs",
  "connectors.section.note": "Vos connecteurs claude.ai et les outils propres à Claude Code, utilisés via votre Claude Code.",
  "connectors.group.list": "Outils que votre Claude Code peut utiliser",
  "connectors.group.listNote": "Chaque outil est activé tant que vous ne le désactivez pas. Une exécution peut utiliser tout outil activé, y compris le shell et les outils qui envoient ou suppriment, et le texte qu’elle lit dans Slack, Jira ou GitHub peut contenir des instructions.",
  "connectors.refresh": "Actualiser",
  "connectors.loading": "Claude Code est interrogé sur les connecteurs qu’il atteint…",
  "connectors.vetoed": "AGENTS_DECK_NO_AGENT=1 maintient ceci désactivé sur cette machine.",
  "connectors.readFail": "Le deck n’a pas pu lire la liste des connecteurs. Essayez Actualiser.",
  "connectors.error.missing": "Claude Code n’est pas installé ici, ou le deck ne le trouve pas.",
  "connectors.error.signedOut": "Claude Code n’est pas connecté. Lancez claude, connectez-vous, puis appuyez sur Actualiser.",
  "connectors.error.other": "Claude Code n’a pas pu lister ses connecteurs : {error}",
  "connectors.empty": "Claude Code n’atteint encore aucun connecteur. Ajoutez-en un sur claude.ai, puis appuyez sur Actualiser.",
  "connectors.saveFail": "Cette modification n’a pas été enregistrée. Réessayez.",
  "connectors.notConnected": "Connus de Claude Code mais non connectés : {names}",
  "connectors.summary": "Outils activés : {on} sur {total}",
  "connectors.writeTools": "peuvent modifier des choses : {count}",
  "connectors.showTools": "Afficher les outils",
  "connectors.hideTools": "Masquer les outils",
  "connectors.toolAria": "Autoriser le deck à utiliser {tool} ({connector})",
  "connectors.group.runs": "Exécutions récentes",
  "connectors.group.runsNote": "Chaque exécution utilise votre forfait Claude. Rien de la question ni de la réponse n’est conservé.",
  "connectors.runs.total": "Total : {cost}",
  "connectors.runs.none": "Aucune exécution pour l’instant.",
  "connectors.runs.tools": "appels d’outils : {count}",
  "connectors.runs.ok": "répondu",
  "connectors.runs.failed": "échec : {code}",
  "connectors.runs.refused": "refusés, non accordés : {tools}",
  "connectors.tool.writes": "Peut modifier des choses",
};

export default catalog;
