/**
 * Capacidades READ-ONLY do módulo oficial Integrações ERP.
 *
 * O runtime do agente e o MCP externo usam estas MESMAS definições. O gate
 * modulo integracoes_erp fica no catálogo; aqui ficam somente o contrato
 * de entrada, a redação da auditoria e a chamada ao service do módulo.
 */
import { z } from "zod";

import {
  buscarPedidosErp,
  buscarPedidosErpComIdentidadeInterna,
  buscarProdutosErp,
  lerEstoqueErp,
  obterNotaErp,
  type ConsultaErpResultado,
} from "@/lib/integracoes-erp/service";
import { carregarVinculoClienteExterno } from "@/lib/integracoes-erp/identidade-externa-cliente";
import { PROVEDOR_VENDAERP } from "@/lib/integracoes-erp/provedores";
import {
  resolverClienteVendaErp,
  type CandidatoClienteSeguro,
} from "@/lib/integracoes-erp/resolucao-cliente-vendaerp";
import type { ClienteErp, PedidoErp } from "@/lib/integracoes-erp/tipos";

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
    case "sem_deposito":
      return "não há depósito cadastrado no VendaERP para consultar o estoque.";
    case "deposito_ambiguo":
      return "há mais de um depósito no VendaERP; escolha qual deve ser consultado.";
    case "deposito_sem_nome":
      return "o único depósito retornado pelo VendaERP não tem nome utilizável.";
    case "cliente_nao_resolvido":
      return "este cliente ainda não possui uma identidade ERP resolvida para esta empresa.";
    case "identidade_pedido_nao_confirmada":
      return "o ERP retornou pedidos, mas nenhum pôde ser provado como pertencente à identidade resolvida.";
    default:
      return "não foi possível consultar o VendaERP agora.";
  }
}

function resposta<T>(resultado: ConsultaErpResultado<T>): {
  dados?: T;
  erro?: string;
  mensagem?: string;
  detalhes?: Record<string, unknown>;
} {
  if (resultado.ok) return { dados: resultado.dados };
  return {
    erro: resultado.motivo,
    mensagem: mensagemDeFalha(resultado.motivo),
    ...(resultado.detalhes ? { detalhes: resultado.detalhes } : {}),
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
  "cliente_contact_id",
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
    "Consulta produtos no VendaERP com nome, código, código de barras, marca ou categoria e devolve identificação e preço cadastrado. Use para localizar o produto e descobrir seu código. Para confirmar estoque atual ou reservado, use crm_erp_read_stock com o código encontrado; não trate o saldo resumido do cadastro como substituto da consulta de estoque.",
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
  codigo: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Código exato do produto. Se a pessoa informou só o nome, procure o produto primeiro.",
    ),
  deposito: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe(
      "Nome do depósito. Se omitido e houver um único depósito, ele é usado automaticamente.",
    ),
  somente_visiveis_catalogo: z.boolean().optional().default(false),
  limite: z.number().int().min(1).max(100).optional().default(50),
};

export const crmErpReadStock: McpToolDefinition<typeof estoqueInputShape> = {
  name: "crm_erp_read_stock",
  description:
    "Consulta o estoque real no VendaERP pelo depósito e, opcionalmente, pelo código exato do produto. Devolve EstoqueAtual e SaldoReservado separados; não derive disponibilidade nem subtraia um do outro sem regra documentada. Se o depósito não for informado e houver mais de um, a resposta traz as opções em vez de escolher por conta própria.",
  inputSchema: estoqueInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: redigirBusca,
  motivoDoVazio: motivoDoVazio("estoque"),
  handler: async (input, ctx) => {
    const r = await lerEstoqueErp(ctx.supabase, ctx.organizationId, {
      codigo: input.codigo,
      deposito: input.deposito,
      visivelCatalogo: input.somente_visiveis_catalogo,
    });
    if (!r.ok) return resposta(r);

    const estoque = r.dados.itens.slice(0, input.limite);
    return {
      deposito: r.dados.deposito,
      estoque: estoque.map((item) => ({
        codigo: item.codigo,
        estoque_atual: item.estoqueAtual,
        saldo_reservado: item.saldoReservado,
      })),
      ...(r.dados.itens.length > estoque.length
        ? { truncado: true, total_itens: r.dados.itens.length }
        : {}),
    };
  },
};

const BUSCA_PEDIDOS_TURNO_TTL_MS = 120_000;

interface BuscaPedidosNoTurno {
  promessa: Promise<boolean>;
  expiraEm: number;
}

const buscasPedidosPorTurno = new Map<string, BuscaPedidosNoTurno>();

function chaveNomeClienteTurno(requestId: string, nome: unknown): string | null {
  if (typeof nome !== "string") return null;
  const normalizado = nome
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ");
  return normalizado ? `${requestId}:${normalizado}` : null;
}

function limparBuscasPedidosExpiradas(agora = Date.now()): void {
  for (const [chave, busca] of buscasPedidosPorTurno) {
    if (busca.expiraEm <= agora) buscasPedidosPorTurno.delete(chave);
  }
}

function registrarBuscaPedidosNoTurno(
  requestId: string,
  nome: unknown,
): ((encontrou: boolean) => void) | null {
  const chave = chaveNomeClienteTurno(requestId, nome);
  if (!chave) return null;

  limparBuscasPedidosExpiradas();
  let resolver!: (encontrou: boolean) => void;
  const promessa = new Promise<boolean>((resolve) => {
    resolver = resolve;
  });
  buscasPedidosPorTurno.set(chave, {
    promessa,
    expiraEm: Date.now() + BUSCA_PEDIDOS_TURNO_TTL_MS,
  });

  let resolvida = false;
  return (encontrou) => {
    if (resolvida) return;
    resolvida = true;
    resolver(encontrou);
  };
}

function buscarPedidosNoMesmoTurno(requestId: string, nome: unknown): Promise<boolean> | null {
  const chave = chaveNomeClienteTurno(requestId, nome);
  if (!chave) return null;
  limparBuscasPedidosExpiradas();
  return buscasPedidosPorTurno.get(chave)?.promessa ?? null;
}

const clientesInputShape = {
  nome: z.string().trim().min(2).max(200).optional(),
  cpf_cnpj: z.string().trim().min(3).max(30).optional(),
  email: z.string().trim().email().max(254).optional(),
  cliente_contact_id: z.string().uuid().optional(),
  limite: limiteSchema,
  skip: skipSchema,
};

function clienteSeguroParaTool(
  cliente: ClienteErp | undefined,
  fallback: string,
): CandidatoClienteSeguro {
  return cliente
    ? {
        nome: cliente.nome,
        nomeFantasia: cliente.nomeFantasia,
        razaoSocial: cliente.razaoSocial,
        cidade: cliente.cidade,
        uf: cliente.uf,
      }
    : { nome: fallback, nomeFantasia: null, razaoSocial: null, cidade: null, uf: null };
}

function motivoResolucaoCliente(resultado: unknown): string | null {
  if (!resultado || typeof resultado !== "object") return null;
  const objeto = resultado as {
    erro?: string;
    resolucao?: { status?: string; motivo?: string };
  };
  if (typeof objeto.erro === "string") return objeto.erro;
  const r = objeto.resolucao;
  if (!r?.status || r.status === "resolved") return null;
  return r.motivo ?? r.status;
}

export const crmErpSearchCustomers: McpToolDefinition<typeof clientesInputShape> = {
  name: "crm_erp_search_customers",
  description:
    "Resolve um cliente no ERP e devolve um contact_id local estável. Reutilize esse contact_id em consultas seguintes; ambiguidade nunca escolhe o primeiro resultado. Se houver candidatos parecidos sem correspondência exata, apresente os candidatos e peça confirmação — nunca diga que o cliente não existe.",
  inputSchema: clientesInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: redigirBusca,
  motivoDoVazio: motivoResolucaoCliente,
  handler: async (input, ctx) => {
    if (!input.nome && !input.cpf_cnpj && !input.email && !input.cliente_contact_id) {
      return {
        erro: "filtro_obrigatorio",
        mensagem: "informe nome, CPF/CNPJ, e-mail ou um contact_id já resolvido.",
      };
    }
    if (input.cliente_contact_id && (input.nome || input.cpf_cnpj || input.email)) {
      return {
        erro: "sinais_cliente_conflitantes",
        mensagem:
          "use o contact_id já resolvido sozinho; se o cliente mudou, faça uma nova resolução por nome, CPF/CNPJ ou e-mail.",
      };
    }

    if (input.nome && !input.cpf_cnpj && !input.email && !input.cliente_contact_id) {
      const buscaPedidos = buscarPedidosNoMesmoTurno(ctx.requestId, input.nome);
      if (buscaPedidos && (await buscaPedidos)) {
        return {
          erro: "resolucao_cliente_desnecessaria_apos_pedidos",
          mensagem:
            "A busca de pedidos deste mesmo turno já encontrou pedidos para esse Nome/Razão Social. Use os pedidos já retornados para responder à solicitação; não diga que o cliente não existe e não repita a resolução de cliente apenas para validar o cadastro.",
        };
      }
    }

    const resolucao = await resolverClienteVendaErp(
      ctx.supabase,
      ctx.organizationId,
      {
        nome: input.nome,
        cpfCnpj: input.cpf_cnpj,
        email: input.email,
        contactId: input.cliente_contact_id,
        limite: input.limite,
        skip: input.skip,
      },
      {
        actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
        actorApiTokenId: ctx.actor.type === "user" ? null : ctx.apiTokenId,
        requestId: ctx.requestId,
      },
    );
    if (resolucao.status === "resolved") {
      return {
        resolucao: {
          status: "resolved",
          contact_id: resolucao.contactId,
          origem: resolucao.origem,
          materializado: resolucao.materialized,
        },
        clientes: [clienteSeguroParaTool(resolucao.cliente, resolucao.externalLabel)],
      };
    }
    if (resolucao.status === "ambiguous") {
      return {
        resolucao: { status: "ambiguous", motivo: resolucao.motivo },
        candidatos: resolucao.candidatos,
      };
    }
    if (resolucao.status === "not_found")
      return { resolucao: { status: "not_found" }, clientes: [] };
    return {
      erro: resolucao.motivoProvider ?? resolucao.motivo,
      mensagem:
        resolucao.motivo === "provider_error" && resolucao.motivoProvider
          ? mensagemDeFalha(resolucao.motivoProvider)
          : resolucao.motivo === "busca_nome_incompleta"
            ? "a busca por nome não conseguiu provar uma identidade única; informe CPF/CNPJ ou e-mail para confirmar o cliente."
            : resolucao.motivo === "sem_correspondencia_exata"
              ? "o VendaERP retornou cadastros parecidos, mas nenhum coincide exatamente com o nome informado; não diga que o cliente não existe. Mostre os candidatos retornados e peça confirmação do nome exato ou CPF/CNPJ."
              : "não foi possível resolver o cliente de forma determinística.",
      resolucao: { status: "unresolved", motivo: resolucao.motivo },
      ...(resolucao.candidatos ? { candidatos: resolucao.candidatos } : {}),
    };
  },
};

const pedidosInputShape = {
  codigo: z.number().int().positive().optional(),
  cliente: z.string().trim().min(2).max(200).optional(),
  cpf_cnpj: z.string().trim().min(3).max(30).optional(),
  cliente_contact_id: z.string().uuid().optional(),
  status: z.string().trim().min(1).max(100).optional(),
  numero_nfe: z.string().trim().min(1).max(60).optional(),
  limite: limiteSchema,
  skip: skipSchema,
};

function projetarPedidoParaTool(pedido: PedidoErp) {
  return {
    id: pedido.id,
    codigo: pedido.codigo,
    cliente: pedido.cliente,
    status: pedido.status,
    statusSistema: pedido.statusSistema,
    total: pedido.total,
    data: pedido.data,
    finalizado: pedido.finalizado,
    numeroNFe: pedido.numeroNFe,
    dataFaturamento: pedido.dataFaturamento,
    chaveAcessoNFe: pedido.chaveAcessoNFe,
    danfeDisponivel: Boolean(pedido.danfeUrl),
  };
}

export const crmErpSearchOrders: McpToolDefinition<typeof pedidosInputShape> = {
  name: "crm_erp_search_orders",
  description:
    "Procura pedidos e localiza NFe/NFCe relacionadas no ERP. Quando a solicitação JÁ é sobre pedidos, compras, notas ou NFes de um cliente e você só tem o nome/razão social, use esta ferramenta DIRETAMENTE com cliente; crm_erp_search_customers NÃO é pré-requisito. Se o cliente já foi resolvido e existe cliente_contact_id, prefira esse id: o backend reutiliza o vínculo e revalida Pedido.pessoaID antes de expor pedidos.",
  inputSchema: pedidosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: redigirBusca,
  motivoDoVazio: motivoDoVazio("pedidos"),
  handler: async (input, ctx) => {
    if (
      !input.codigo &&
      !input.cliente &&
      !input.cpf_cnpj &&
      !input.cliente_contact_id &&
      !input.status &&
      !input.numero_nfe
    ) {
      return {
        erro: "filtro_obrigatorio",
        mensagem:
          "informe ao menos um identificador, cliente resolvido, status ou número da nota para procurar pedidos.",
      };
    }

    if (input.cliente_contact_id) {
      if (input.cliente || input.cpf_cnpj) {
        return {
          erro: "filtros_cliente_conflitantes",
          mensagem:
            "use o cliente já resolvido sem misturar nome/CPF; resolva outra entidade explicitamente se o alvo mudou.",
        };
      }
      const leitura = await carregarVinculoClienteExterno(ctx.supabase, {
        organizationId: ctx.organizationId,
        contactId: input.cliente_contact_id,
        provider: PROVEDOR_VENDAERP.id,
      });
      if (!leitura.ok) return resposta({ ok: false, motivo: "banco" });
      if (!leitura.vinculo)
        return {
          erro: "cliente_nao_resolvido",
          mensagem: mensagemDeFalha("cliente_nao_resolvido"),
        };

      const r = await buscarPedidosErpComIdentidadeInterna(ctx.supabase, ctx.organizationId, {
        codigo: input.codigo,
        cliente: leitura.vinculo.providerLookupLabel,
        status: input.status,
        numeroNFe: input.numero_nfe,
        pageSize: input.limite,
        skip: input.skip,
      });
      if (!r.ok) return resposta(r);
      const comprovados = r.dados.filter(
        (p) => p.identidadeCliente.pessoaId === leitura.vinculo!.externalId,
      );
      if (r.dados.length > 0 && comprovados.length === 0) {
        return {
          erro: "identidade_pedido_nao_confirmada",
          mensagem: mensagemDeFalha("identidade_pedido_nao_confirmada"),
          resolucao_cliente: { status: "unresolved", contact_id: input.cliente_contact_id },
        };
      }
      return {
        resolucao_cliente: {
          status: "resolved",
          contact_id: input.cliente_contact_id,
          origem: "external_identity_link",
        },
        pedidos: comprovados.map((item) => projetarPedidoParaTool(item.pedido)),
      };
    }

    const resolverSequenciamento = registrarBuscaPedidosNoTurno(ctx.requestId, input.cliente);
    try {
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
      if (saida.erro) {
        resolverSequenciamento?.(false);
        return saida;
      }
      const pedidos = saida.dados?.map((pedido) => projetarPedidoParaTool(pedido)) ?? [];
      resolverSequenciamento?.(pedidos.length > 0);
      return { pedidos };
    } catch (erro) {
      resolverSequenciamento?.(false);
      throw erro;
    }
  },
};

const notaInputShape = {
  codigo_nfe: z.number().int().min(1).max(2_147_483_647),
};

export const crmErpGetInvoice: McpToolDefinition<typeof notaInputShape> = {
  name: "crm_erp_get_invoice",
  description:
    "Consulta diretamente uma NFe/NFCe já emitida no VendaERP pelo número e devolve status de autorização, chave, lote e se há DANFE disponível. O XML fiscal bruto e a URL externa do DANFE não são entregues ao agente.",
  inputSchema: notaInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: redigirBusca,
  handler: async (input, ctx) => {
    const r = await obterNotaErp(ctx.supabase, ctx.organizationId, input.codigo_nfe);
    const saida = resposta(r);
    if (saida.erro) return saida;
    const nota = saida.dados;
    return {
      nota: nota
        ? {
            numero: nota.numero,
            codigoStatus: nota.codigoStatus,
            mensagemStatus: nota.mensagemStatus,
            chave: nota.chave,
            lote: nota.lote,
            danfeDisponivel: Boolean(nota.danfeUrl),
          }
        : null,
    };
  },
};
