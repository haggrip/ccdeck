// Area "connectors" — pt-BR. Every key here starts with "connectors.".
import type { Catalog } from "../../catalogs";

const catalog: Catalog = {
  "connectors.section.label": "Conectores",
  "connectors.section.note": "Seus conectores do claude.ai e as ferramentas do próprio Claude Code, usados pelo seu Claude Code.",
  "connectors.group.list": "Ferramentas que o seu Claude Code pode usar",
  "connectors.group.listNote": "Toda ferramenta fica ligada até você desligá-la. Uma execução pode usar qualquer ferramenta ligada, incluindo o shell e as que enviam ou apagam, e o texto que ela lê do Slack, Jira ou GitHub pode trazer instruções.",
  "connectors.refresh": "Atualizar",
  "connectors.loading": "Perguntando ao Claude Code quais conectores ele alcança…",
  "connectors.vetoed": "AGENTS_DECK_NO_AGENT=1 mantém isto desligado nesta máquina.",
  "connectors.readFail": "O deck não conseguiu ler a lista de conectores. Tente Atualizar.",
  "connectors.error.missing": "O Claude Code não está instalado aqui, ou o deck não o encontra.",
  "connectors.error.signedOut": "O Claude Code não está conectado. Execute claude, entre na conta e pressione Atualizar.",
  "connectors.error.other": "O Claude Code não conseguiu listar seus conectores: {error}",
  "connectors.empty": "O Claude Code ainda não alcança nenhum conector. Adicione um no claude.ai e pressione Atualizar.",
  "connectors.saveFail": "Essa alteração não foi salva. Tente de novo.",
  "connectors.notConnected": "Conhecidos pelo Claude Code, mas não conectados: {names}",
  "connectors.summary": "Ferramentas ligadas: {on} de {total}",
  "connectors.writeTools": "podem mudar coisas: {count}",
  "connectors.showTools": "Mostrar ferramentas",
  "connectors.hideTools": "Ocultar ferramentas",
  "connectors.toolAria": "Permitir que o deck use {tool} ({connector})",
  "connectors.group.runs": "Execuções recentes",
  "connectors.group.runsNote": "Cada execução usa o seu plano do Claude. Nada do que foi perguntado ou respondido é guardado.",
  "connectors.runs.total": "Total: {cost}",
  "connectors.runs.none": "Nenhuma execução ainda.",
  "connectors.runs.tools": "chamadas de ferramentas: {count}",
  "connectors.runs.ok": "respondida",
  "connectors.runs.failed": "falhou: {code}",
  "connectors.tool.writes": "Pode mudar coisas",
};

export default catalog;
