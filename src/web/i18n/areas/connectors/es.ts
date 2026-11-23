// Area "connectors" — es. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "Conectores",
  "connectors.section.note": "Tus conectores de claude.ai, leídos a través de tu propio Claude Code. Solo herramientas de lectura.",
  "connectors.group.list": "Conectores que alcanza tu Claude Code",
  "connectors.group.listNote": "Activa las herramientas de solo lectura con las que el deck puede leer. Todas empiezan apagadas, y las que pueden escribir nunca se ofrecen.",
  "connectors.refresh": "Actualizar",
  "connectors.loading": "Preguntando a Claude Code qué conectores alcanza…",
  "connectors.vetoed": "AGENTS_DECK_NO_AGENT=1 mantiene esto apagado en esta máquina.",
  "connectors.readFail": "El deck no pudo leer la lista de conectores. Prueba Actualizar.",
  "connectors.error.missing": "Claude Code no está instalado aquí, o el deck no lo encuentra.",
  "connectors.error.signedOut": "Claude Code no ha iniciado sesión. Ejecuta claude, inicia sesión y pulsa Actualizar.",
  "connectors.error.other": "Claude Code no pudo listar sus conectores: {error}",
  "connectors.empty": "Claude Code aún no alcanza ningún conector. Añade uno en claude.ai y pulsa Actualizar.",
  "connectors.saveFail": "Ese cambio no se guardó. Inténtalo de nuevo.",
  "connectors.notConnected": "Conocidos por Claude Code pero sin conectar: {names}",
  "connectors.noReadOnly": "Conectados, sin herramientas de solo lectura que ofrecer: {names}",
  "connectors.summary": "Herramientas de solo lectura activas: {on} de {total}",
  "connectors.writeTools": "herramientas que pueden escribir, nunca ofrecidas: {count}",
  "connectors.showTools": "Mostrar herramientas",
  "connectors.hideTools": "Ocultar herramientas",
  "connectors.toolAria": "Permitir que el deck lea con {tool} ({connector})",
  "connectors.group.runs": "Ejecuciones recientes",
  "connectors.group.runsNote": "Cada ejecución usa tu plan de Claude. No se guarda nada de lo preguntado ni de lo respondido.",
  "connectors.runs.total": "Total: {cost}",
  "connectors.runs.none": "Aún no hay ejecuciones.",
  "connectors.runs.tools": "llamadas a herramientas: {count}",
  "connectors.runs.ok": "respondida",
  "connectors.runs.failed": "falló: {code}",
};

export default catalog;
