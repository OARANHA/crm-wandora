/**
 * Capacidades READ-ONLY do módulo oficial Integrações ERP.
 *
 * O runtime do agente e o MCP externo usam estas MESMAS definições. O gate
 * modulo integracoes_erp fica no catálogo; aqui ficam somente o contrato
 * de entrada, a redação da auditoria e a chamada ao service do módulo.
 */
import { z } from "zod";

import {
  buscarClientesErp,
  buscarPedidosErp,
  buscarProdutosErp,
  lerEstoqueErp,
  obterNotaErp,
  type ConsultaErpResultado,
} from "@/lib/integracoes-erp/service";

import type { McpToolDefinition } from "../types";

const limiteSchema = z.number().int().min(1).max(20).optional().default(10);
const skipSchema = z.number().int().min(0).max(10_000).optional().default(0);

function mensagemDeFalha(motivo: string): string {
  switch (motivo) {
    case "nao_encontrada":
      return "não há uma conexão VendaERP cadastrada para esta empresa.";
    case "desativada":
      return "a conexão VendaERP desta empresa está desativada.";
    case "cifra_indisponivel":
      return "a conexão existe, mas a instalação não conseguiu abrir as credenciais cifradas.";
    case "banco":
      return "o módulo de integrações não está disponível nesta instalação agora.";
    case "auth_failed":
      return "o VendaERP recusou as credenciais configuradas.";
    case "rate_limited":
      return "o VendaERP atingiu o limite de consultas da chave; tente mais tarde.";
    case "timeout":
      return "o VendaERP não respondeu dentro do tempo limite.";
    case "invalid_response":
      return "o VendaERP respondeu num formato diferente do contrato esperado.";
    default:
      return "não foi possível consultar o VendaERP agora.";
  }
}

function resposta<T>(resultado: ConsultaErpResultado<T>): { dados?: T; erro?: string; mensagem?: string } {
  if (resultado.ok) return { dados: resultado.dados };
  return {
    erro: resultado.motivo,
    mensagem: mensagemDeFalha(resultado.motivo),
  };
}

function motivoDoVazio(chave: string) {
  return (resultado: unknown): string | null => {
    if (resultado === null || typeof resultado !== "object") return null;
    const r = resultado as Record<string, unknown>;
    if (typeof r.erro === "string") return r.erro;
    const dados = r[chave];
    return Array.isArray(dados) && dados.length === 0 ? "nenhum_resultado" : null;
  };
}

const CHAVES_DE_BUSCA = new Set([
  "codigo",
  "nome",
  "ean",
  "marca",
  "categoria",
  "deposito",
  "cpf_cnpj",
  "email",
  "cliente",
  "status",
  "numero_nfe",
  "codigo_nfe",
]);

function redigirBusca(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([chave, valor]) =>
      CHAVES_DE_BUSCA.has(chave) && valor !== undefined ? [chave, "[redigido]"] : [chave, valor],
    ),
  );
}

const produtosInputShape = {
  codigo: z.string().trim().min(1).max(100).optional(),
  nome: z.string().trim().min(1).max(200).optional(),
  ean: z.string().trim().min(1).max(100).optional(),
  marca: z.string().trim().min(1).max(120).optional(),
  categoria: z.string().trim().min(1).max(120).optional(),
  deposito: z.string().trim().min(1).max(120).optional(),
  limite: limiteSchema,
  skip: skipSchema,
};

export const crmErpSearchProducts: McpToolDefinition<typeof produtosInputShape> = {
  name: "crm_erp_search_products",
  description:
    "Consulta produtos no VendaERP com nome, código, código de barras, marca ou categoria e devolve somente campos úteis ao atendimento: nome, preço de venda, saldo, unidade e identificação. Use o resultado real; nunca estime preço ou estoque.",
  inputSchema: produtosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: redigirBusca,
  motivoDoVazio: motivoDoVazio("produtos"),
  handler: async (input, ctx) => {
    const r = await buscarProdutosErp(ctx.supabase, ctx.organizationId, {
      codigo: input.codigo,
      nome: input.nome,
      ean: input.ean,
      marca: input.marca,
      categoria: input.categoria,
      deposito: input.deposito,
      pageSize: input.limite,
      skip: input.skip,
    });
    const saida = resposta(r);
    return saida.erro ? saida : { produtos: saida.dados };
  },
};

const estoqueInputShape = {
  codigo: z.string().trim().min(1).max(100).optional(),
  nome: z.string().trim().min(1).max(200).optional(),
  deposito: z.string().trim().min(1).max(120).optional(),
  limite: limiteSchema,
  skip: skipSchema,
};

export const crmErpReadStock: McpToolDefinition<typeof estoqueInputShape> = {
  name: "crm_erp_read_stock",
  description:
    "Consulta o saldo documentado dos produtos no VendaERP, opcionalmente por código, nome ou depósito. Devolve produto, saldo e unidade sem expor o payload bruto do sistema externo.",
  inputSchema: estoqueInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: redigirBusca,
  motivoDoVazio: motivoDoVazio("estoque"),
  handler: async (input, ctx) => {
    const r = await lerEstoqueErp(ctx.supabase, ctx.organizationId, {
      codigo: input.codigo,
      nome: input.nome,
      deposito: input.deposito,
      pageSize: input.limite,
      skip: input.skip,
    });
    if (!r.ok) return resposta(r);
    return {
      estoque: r.dados.map((p) => ({
        codigo: p.codigo,
        nome: p.nome,
        saldo: p.estoque,
        unidade: p.unidade,
      })),
    };
  },
};

const clientesInputShape = {
  nome: z.string().trim().min(2).max(200).optional(),
  cpf_cnpj: z.string().trim().min(3).max(30).optional(),
  email: z.string().trim().email().max(254).optional(),
  limite: limiteSchema,
  skip: skipSchema,
};

export const crmErpSearchCustomers: McpToolDefinition<typeof clientesInputShape> = {
  name: "crm_erp_search_customers",
  description:
    "Procura clientes no VendaERP por nome, CPF/CNPJ ou e-mail e devolve apenas identificação e contato necessários para conferir cadastro. Nunca recebe senha, salt ou outros campos brutos da pessoa.",
  inputSchema: clientesInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: redigirBusca,
  motivoDoVazio: motivoDoVazio("clientes"),
  handler: async (input, ctx) => {
    if (!input.nome && !input.cpf_cnpj && !input.email) {
      return {
        erro: "filtro_obrigatorio",
        mensagem: "informe nome, CPF/CNPJ ou e-mail para procurar um cliente.",
      };
    }
    const r = await buscarClientesErp(ctx.supabase, ctx.organizationId, {
      nomefantasia: input.nome,
      cpfcnpj: input.cpf_cnpj,
      email: input.email,
      pageSize: input.limite,
      skip: input.skip,
    });
    const saida = resposta(r);
    return saida.erro ? saida : { clientes: saida.dados };
  },
};

const pedidosInputShape = {
  codigo: z.number().int().positive().optional(),
  cliente: z.string().trim().min(2).max(200).optional(),
  cpf_cnpj: z.string().trim().min(3).max(30).optional(),
  status: z.string().trim().min(1).max(100).optional(),
  numero_nfe: z.string().trim().min(1).max(60).optional(),
  limite: limiteSchema,
  skip: skipSchema,
};

export const crmErpSearchOrders: McpToolDefinition<typeof pedidosInputShape> = {
  name: "crm_erp_search_orders",
  description:
    "Procura pedidos no VendaERP por número, cliente, CPF/CNPJ, status ou número da nota e devolve situação, total e os dados fiscais documentados no pedido. Use para conferir pedido existente e faturamento.",
  inputSchema: pedidosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: redigirBusca,
  motivoDoVazio: motivoDoVazio("pedidos"),
  handler: async (input, ctx) => {
    if (!input.codigo && !input.cliente && !input.cpf_cnpj && !input.status && !input.numero_nfe) {
      return {
        erro: "filtro_obrigatorio",
        mensagem: "informe ao menos um identificador, cliente, status ou número da nota para procurar pedidos.",
      };
    }
    const r = await buscarPedidosErp(ctx.supabase, ctx.organizationId, {
      codigo: input.codigo,
      cliente: input.cliente,
      cpf_cnpj: input.cpf_cnpj,
      status: input.status,
      numeroNFe: input.numero_nfe,
      pageSize: input.limite,
      skip: input.skip,
    });
    const saida = resposta(r);
    return saida.erro ? saida : { pedidos: saida.dados };
  },
};

const notaInputShape = {
  codigo_nfe: z.number().int().min(1).max(2_147_483_647),
};

export const crmErpGetInvoice: McpToolDefinition<typeof notaInputShape> = {
  name: "crm_erp_get_invoice",
  description:
    "Consulta uma nota vinculada a pedido no VendaERP pelo número da NFe/NFCe e devolve apenas os campos fiscais documentados no pedido: chave, data de faturamento e endereços de consulta/DANFE.",
  inputSchema: notaInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: redigirBusca,
  motivoDoVazio: motivoDoVazio("notas"),
  handler: async (input, ctx) => {
    const r = await obterNotaErp(ctx.supabase, ctx.organizationId, input.codigo_nfe);
    const saida = resposta(r);
    return saida.erro ? saida : { notas: saida.dados };
  },
};
