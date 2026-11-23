// Area "connectors" — ro. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "Conectori",
  "connectors.section.note": "Conectorii tăi claude.ai, citiți prin propriul tău Claude Code. Doar unelte care citesc.",
  "connectors.group.list": "Conectorii la care ajunge Claude Code",
  "connectors.group.listNote": "Pornește uneltele doar pentru citire cu care deck-ul are voie să citească. Fiecare unealtă pornește oprită, iar uneltele care pot scrie nu sunt oferite niciodată.",
  "connectors.refresh": "Reîmprospătează",
  "connectors.loading": "Claude Code este întrebat la ce conectori ajunge…",
  "connectors.vetoed": "AGENTS_DECK_NO_AGENT=1 ține asta oprit pe acest calculator.",
  "connectors.readFail": "Deck-ul nu a putut citi lista conectorilor. Încearcă Reîmprospătează.",
  "connectors.error.missing": "Claude Code nu este instalat aici sau deck-ul nu îl găsește.",
  "connectors.error.signedOut": "Claude Code nu este autentificat. Rulează claude, autentifică-te, apoi apasă Reîmprospătează.",
  "connectors.error.other": "Claude Code nu și-a putut lista conectorii: {error}",
  "connectors.empty": "Claude Code nu ajunge încă la niciun conector. Adaugă unul pe claude.ai, apoi apasă Reîmprospătează.",
  "connectors.saveFail": "Modificarea nu a fost salvată. Încearcă din nou.",
  "connectors.notConnected": "Cunoscuți de Claude Code, dar neconectați: {names}",
  "connectors.noReadOnly": "Conectați, dar fără unelte doar pentru citire de oferit: {names}",
  "connectors.summary": "Unelte doar pentru citire pornite: {on} din {total}",
  "connectors.writeTools": "unelte care pot scrie, niciodată oferite: {count}",
  "connectors.showTools": "Arată uneltele",
  "connectors.hideTools": "Ascunde uneltele",
  "connectors.toolAria": "Permite deck-ului să citească cu {tool} ({connector})",
  "connectors.group.runs": "Rulări recente",
  "connectors.group.runsNote": "Fiecare rulare folosește planul tău Claude. Nu se păstrează nimic din întrebare sau din răspuns.",
  "connectors.runs.total": "Total: {cost}",
  "connectors.runs.none": "Încă nicio rulare.",
  "connectors.runs.tools": "apeluri de unelte: {count}",
  "connectors.runs.ok": "a răspuns",
  "connectors.runs.failed": "a eșuat: {code}",
};

export default catalog;
