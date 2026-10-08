/**
 * Capacidades de leitura do módulo oficial Integrações ERP.
 *
 * O campo modulo integracoes_erp faz estas entradas desaparecerem do agente,
 * do MCP externo e da tela quando o administrador da instalação não instalou o
 * módulo via /admin/modulos.
 */
import { declararTools } from "./tipos";

export const TOOLS_INTEGRACOES_ERP = declararTools([
  {
    name: "crm_erp_search_products",
    category: "read",
    rotulo: "Procurar produtos no sistema de gestão",
    explicacao:
      "Procura produtos no sistema de gestão conectado e mostra preço e disponibilidade cadastrados, para o assistente responder com o dado real.",
    oQueToca: "Produtos do sistema de gestão",
    risco: "seguro",
    pacotes: ["organizar"],
    modulo: "integracoes_erp",
  },
  {
    name: "crm_erp_read_stock",
    category: "read",
    rotulo: "Ver estoque no sistema de gestão",
    explicacao:
      "Mostra o saldo cadastrado dos produtos no sistema de gestão conectado, para o assistente confirmar quantidade sem estimar.",
    oQueToca: "Estoque do sistema de gestão",
    risco: "seguro",
    pacotes: ["organizar"],
    modulo: "integracoes_erp",
  },
  {
    name: "crm_erp_search_customers",
    category: "read",
    rotulo: "Procurar clientes no sistema de gestão",
    explicacao:
      "Procura um cliente no sistema de gestão conectado por nome ou identificação, devolvendo apenas os dados necessários para conferir o cadastro.",
    oQueToca: "Clientes do sistema de gestão",
    risco: "seguro",
    pacotes: ["organizar"],
    modulo: "integracoes_erp",
  },
  {
    name: "crm_erp_search_orders",
    category: "read",
    rotulo: "Procurar pedidos no sistema de gestão",
    explicacao:
      "Procura pedidos no sistema de gestão conectado e mostra situação, valor e faturamento cadastrados, sem alterar nenhum registro.",
    oQueToca: "Pedidos do sistema de gestão",
    risco: "seguro",
    pacotes: ["organizar"],
    modulo: "integracoes_erp",
  },
  {
    name: "crm_erp_search_recent_invoices",
    category: "read",
    rotulo: "Encontrar as notas fiscais mais recentes",
    explicacao:
      "Encontra até três notas fiscais recentes por data de emissão comprovada, com opção de filtrar por cliente. Para mais notas, pede o mês desejado antes de pesquisar.",
    oQueToca: "Notas fiscais emitidas no sistema de gestão",
    risco: "seguro",
    pacotes: ["organizar"],
    modulo: "integracoes_erp",
  },
  {
    name: "crm_erp_get_invoice",
    category: "read",
    rotulo: "Consultar nota fiscal no sistema de gestão",
    explicacao:
      "Consulta os dados fiscais já vinculados ao pedido no sistema de gestão conectado, para confirmar número, chave e documento sem inventar.",
    oQueToca: "Notas fiscais do sistema de gestão",
    risco: "seguro",
    pacotes: ["organizar"],
    modulo: "integracoes_erp",
  },
]);
