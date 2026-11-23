// Area "connectors" — fr. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "Connecteurs",
  "connectors.section.note": "Vos connecteurs claude.ai, lus via votre propre Claude Code. Outils en lecture seule uniquement.",
  "connectors.group.list": "Connecteurs que votre Claude Code atteint",
  "connectors.group.listNote": "Activez les outils en lecture seule avec lesquels le deck peut lire. Chaque outil est désactivé au départ, et les outils qui peuvent écrire ne sont jamais proposés.",
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
  "connectors.noReadOnly": "Connectés, sans outil en lecture seule à proposer : {names}",
  "connectors.summary": "Outils en lecture seule activés : {on} sur {total}",
  "connectors.writeTools": "outils qui peuvent écrire, jamais proposés : {count}",
  "connectors.showTools": "Afficher les outils",
  "connectors.hideTools": "Masquer les outils",
  "connectors.toolAria": "Autoriser le deck à lire avec {tool} ({connector})",
  "connectors.group.runs": "Exécutions récentes",
  "connectors.group.runsNote": "Chaque exécution utilise votre forfait Claude. Rien de la question ni de la réponse n’est conservé.",
  "connectors.runs.total": "Total : {cost}",
  "connectors.runs.none": "Aucune exécution pour l’instant.",
  "connectors.runs.tools": "appels d’outils : {count}",
  "connectors.runs.ok": "répondu",
  "connectors.runs.failed": "échec : {code}",
};

export default catalog;
