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

import type { FiltrosPedidosErp, PedidoErp } from "@/lib/integracoes-erp/tipos";

import type { McpContext, McpToolDefinition } from "../types";

const limiteSchema = z.number().int().min(1).max(20).optional().default(10);
const skipSchema = z.number().int().min(0).max(10_000).optional().default(0);

function mensagemDeFalha(motivo: string): string {
  switch (motivo) {
    case "nao_encontrada":
      return "não há uma conexão ERP cadastrada para esta empresa.";
    case "desativada":
      return "a conexão ERP desta empresa está desativada.";
    case "cifra_indisponivel":
      return "a conexão existe, mas a instalação não conseguiu abrir as credenciais cifradas.";
    case "banco":
      return "o módulo de integrações não está disponível nesta instalação agora.";
    case "auth_failed":
      return "o sistema de gestão conectado recusou as credenciais configuradas.";
    case "rate_limited":
      return "o sistema de gestão conectado atingiu o limite de consultas; tente novamente mais tarde.";
    case "timeout":
      return "o sistema de gestão conectado não respondeu dentro do tempo limite.";
    case "invalid_response":
      return "o sistema de gestão conectado respondeu num formato diferente do contrato esperado.";
    case "consulta_parcial":
      return "há mais pedidos do que o limite seguro desta consulta; restrinja o cliente ou o período para eu responder sem adivinhar quais são os mais recentes ou os maiores.";
    case "sem_deposito":
      return "não há depósito disponível no sistema de gestão conectado para consultar o estoque.";
    case "deposito_ambiguo":
      return "há mais de um depósito no sistema de gestão conectado; escolha qual deve ser consultado.";
    case "deposito_sem_nome":
      return "o único depósito retornado pelo sistema de gestão conectado não tem nome utilizável.";
    default:
      return "não foi possível consultar o sistema de gestão conectado agora.";
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
    "Consulta produtos no sistema de gestão conectado com nome, código, código de barras, marca ou categoria e devolve identificação e preço cadastrado. Use para localizar o produto e descobrir seu código. Para confirmar estoque atual ou reservado, use crm_erp_read_stock com o código encontrado; não trate o saldo resumido do cadastro como substituto da consulta de estoque.",
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
    "Consulta o estoque real no sistema de gestão conectado pelo depósito e, opcionalmente, pelo código exato do produto. Devolve EstoqueAtual e SaldoReservado separados; não derive disponibilidade nem subtraia um do outro sem regra documentada. Se o depósito não for informado e houver mais de um, a resposta traz as opções em vez de escolher por conta própria.",
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
    "Procura clientes no sistema de gestão conectado por nome, CPF/CNPJ ou e-mail e devolve apenas identificação e contato necessários para conferir cadastro. Nunca recebe senha, salt ou outros campos brutos da pessoa.",
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
  codigo: z.number().int().min(1).optional(),
  cliente: z.string().trim().min(1).max(200).optional(),
  cpf_cnpj: z.string().trim().min(3).max(30).optional(),
  status: z.string().trim().min(1).max(100).optional(),
  numero_nfe: z.string().trim().min(1).max(50).optional(),
  ultimas_notas: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Quando informado, procura somente pedidos com NFe e devolve as N notas mais recentes pela data de faturamento. A consulta falha fechada se o conjunto for grande demais para provar a ordenação.",
    ),
  data_inicial: z
    .string()
    .date()
    .optional()
    .describe(
      "Início do período. Em consulta de nota/faturamento o período é aplicado à data de faturamento; nas demais consultas, à data de cadastro do pedido.",
    ),
  data_final: z
    .string()
    .date()
    .optional()
    .describe(
      "Fim do período. Em consulta de nota/faturamento o período é aplicado à data de faturamento; nas demais consultas, à data de cadastro do pedido.",
    ),
  somente_com_nfe: z.boolean().optional().default(false),
  somente_sem_nfe: z.boolean().optional().default(false),
  somente_faturados: z.boolean().optional().default(false),
  somente_finalizados: z.boolean().optional().default(false),
  ordenar_por: z
    .enum(["recente", "antigo", "maior_valor"])
    .optional()
    .describe(
      "Use somente quando a pessoa pedir ordenação. A capability pagina o conjunto antes de ordenar e falha fechada se não conseguir provar que viu todos os resultados.",
    ),
  limite: limiteSchema,
  skip: skipSchema,
};

const TAMANHO_PAGINA_PEDIDOS_ANALITICOS = 100;
const MAX_PAGINAS_PEDIDOS_ANALITICOS = 5;

async function buscarPedidosParaAnaliseCompleta(
  ctx: McpContext,
  filtros: FiltrosPedidosErp,
): Promise<ConsultaErpResultado<PedidoErp[]>> {
  const acumulados: PedidoErp[] = [];

  for (let pagina = 0; pagina < MAX_PAGINAS_PEDIDOS_ANALITICOS; pagina += 1) {
    const lote = await buscarPedidosErp(ctx.supabase, ctx.organizationId, {
      ...filtros,
      pageSize: TAMANHO_PAGINA_PEDIDOS_ANALITICOS,
      skip: pagina * TAMANHO_PAGINA_PEDIDOS_ANALITICOS,
    });
    if (!lote.ok) return lote;

    acumulados.push(...lote.dados);
    if (lote.dados.length < TAMANHO_PAGINA_PEDIDOS_ANALITICOS) {
      return { ok: true, dados: acumulados };
    }
  }

  const limiteAnalisado =
    TAMANHO_PAGINA_PEDIDOS_ANALITICOS * MAX_PAGINAS_PEDIDOS_ANALITICOS;
  const provaDeFim = await buscarPedidosErp(ctx.supabase, ctx.organizationId, {
    ...filtros,
    pageSize: 1,
    skip: limiteAnalisado,
  });
  if (!provaDeFim.ok) return provaDeFim;
  if (provaDeFim.dados.length > 0) {
    return {
      ok: false,
      motivo: "consulta_parcial",
      detalhes: { limiteAnalisado },
    };
  }

  return { ok: true, dados: acumulados };
}

export const crmErpSearchOrders: McpToolDefinition<typeof pedidosInputShape> = {
  name: "crm_erp_search_orders",
  description:
    "Procura pedidos e notas no sistema de gestão conectado por cliente, CPF/CNPJ, status, período ou número da nota e devolve situação, total e dados fiscais documentados. Para perguntas como 'quais as últimas 2 notas da Eco Projetos', CHAME ESTA FERRAMENTA NO MESMO TURNO com cliente='Eco Projetos' e ultimas_notas=2; não prometa verificar depois. Em consultas de nota/faturamento, o período é aplicado à data de faturamento; nas demais, à data de cadastro. Ordenações e filtros locais que exigem visão do conjunto paginam de forma limitada e falham fechado se o conjunto exceder o limite seguro.",
  inputSchema: pedidosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: redigirBusca,
  motivoDoVazio: motivoDoVazio("pedidos"),
  handler: async (input, ctx) => {
    if ((input.somente_com_nfe || input.ultimas_notas) && input.somente_sem_nfe) {
      return {
        erro: "filtros_incompativeis",
        mensagem:
          "não é possível pedir notas emitidas/últimas notas e, ao mesmo tempo, somente pedidos sem NFe.",
      };
    }

    if (input.data_inicial && input.data_final && input.data_inicial > input.data_final) {
      return {
        erro: "periodo_invalido",
        mensagem: "a data inicial não pode ser posterior à data final.",
      };
    }

    const temFiltro =
      Boolean(input.codigo) ||
      Boolean(input.cliente) ||
      Boolean(input.cpf_cnpj) ||
      Boolean(input.status) ||
      Boolean(input.numero_nfe) ||
      Boolean(input.data_inicial) ||
      Boolean(input.data_final) ||
      Boolean(input.ultimas_notas) ||
      input.somente_com_nfe ||
      input.somente_sem_nfe ||
      input.somente_faturados ||
      input.somente_finalizados;

    if (!temFiltro) {
      return {
        erro: "filtro_obrigatorio",
        mensagem:
          "informe ao menos um identificador, cliente, status, período ou condição de pedido/nota para consultar.",
      };
    }

    const consultaPorFaturamento = Boolean(
      input.ultimas_notas || input.somente_com_nfe || input.somente_faturados || input.numero_nfe,
    );
    const temPeriodo = Boolean(input.data_inicial || input.data_final);

    const filtros: FiltrosPedidosErp = {
      codigo: input.codigo,
      cliente: input.cliente,
      cpf_cnpj: input.cpf_cnpj,
      status: input.status,
      numeroNFe: input.numero_nfe,
      ...(input.ultimas_notas || input.somente_com_nfe ? { possuiNotaFiscal: true } : {}),
      ...(input.somente_sem_nfe ? { possuiNotaFiscal: false } : {}),
      dataInicial: input.data_inicial,
      dataFinal: input.data_final,
      ...(temPeriodo
        ? { dataReferencia: consultaPorFaturamento ? "faturamento" : "cadastro" }
        : {}),
    };

    const precisaAnaliseCompleta = Boolean(
      input.ultimas_notas ||
        input.somente_faturados ||
        input.somente_finalizados ||
        input.ordenar_por,
    );

    const r = precisaAnaliseCompleta
      ? await buscarPedidosParaAnaliseCompleta(ctx, filtros)
      : await buscarPedidosErp(ctx.supabase, ctx.organizationId, {
          ...filtros,
          pageSize: input.limite,
          skip: input.skip,
        });
    const saida = resposta(r);
    if (saida.erro) return saida;

    const instante = (valor: string | null): number => {
      if (!valor) return Number.NEGATIVE_INFINITY;
      const t = Date.parse(valor);
      return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
    };

    let pedidos = [...(saida.dados ?? [])];

    if (input.somente_faturados) {
      pedidos = pedidos.filter((pedido) => Boolean(pedido.dataFaturamento || pedido.numeroNFe));
    }
    if (input.somente_finalizados) {
      pedidos = pedidos.filter((pedido) => pedido.finalizado === true);
    }

    if (
      input.ultimas_notas &&
      pedidos.some((pedido) => !Number.isFinite(Date.parse(pedido.dataFaturamento ?? "")))
    ) {
      return {
        erro: "data_faturamento_indisponivel",
        mensagem:
          "há nota sem data de faturamento utilizável; não dá para afirmar quais são as últimas sem adivinhar.",
      };
    }

    const ordenarPor = input.ultimas_notas ? "recente" : input.ordenar_por;
    const dataParaOrdenacao = (pedido: PedidoErp): number =>
      consultaPorFaturamento ? instante(pedido.dataFaturamento) : instante(pedido.data);

    if (
      ordenarPor === "maior_valor" &&
      pedidos.some((pedido) => typeof pedido.total !== "number" || !Number.isFinite(pedido.total))
    ) {
      return {
        erro: "valor_indisponivel_para_ordenacao",
        mensagem:
          "há pedido sem valor total utilizável; não dá para afirmar quais são as maiores compras sem adivinhar.",
      };
    }

    if (ordenarPor) {
      pedidos.sort((a, b) => {
        if (ordenarPor === "maior_valor") {
          const valorA = a.total ?? Number.NEGATIVE_INFINITY;
          const valorB = b.total ?? Number.NEGATIVE_INFINITY;
          if (valorA !== valorB) return valorB - valorA;
        } else {
          const dataA = dataParaOrdenacao(a);
          const dataB = dataParaOrdenacao(b);
          if (dataA !== dataB) return ordenarPor === "antigo" ? dataA - dataB : dataB - dataA;
        }
        return (b.codigo ?? Number.NEGATIVE_INFINITY) - (a.codigo ?? Number.NEGATIVE_INFINITY);
      });
    }

    const inicio = input.ultimas_notas ? 0 : precisaAnaliseCompleta ? input.skip : 0;
    const quantidade = input.ultimas_notas ?? input.limite;
    const selecionados = pedidos.slice(inicio, inicio + quantidade);

    const valoresConhecidos = pedidos
      .map((pedido) => pedido.total)
      .filter((valor): valor is number => typeof valor === "number" && Number.isFinite(valor));
    const datasConhecidas = pedidos
      .map(dataParaOrdenacao)
      .filter((valor) => Number.isFinite(valor) && valor !== Number.NEGATIVE_INFINITY);

    return {
      pedidos: selecionados.map((pedido) => ({
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
      })),
      ...(precisaAnaliseCompleta
        ? {
            resumo: {
              quantidadeEncontrada: pedidos.length,
              quantidadeRetornada: selecionados.length,
              totalEncontrado:
                valoresConhecidos.length === pedidos.length
                  ? valoresConhecidos.reduce((soma, valor) => soma + valor, 0)
                  : null,
              maisRecenteEm:
                datasConhecidas.length > 0
                  ? new Date(Math.max(...datasConhecidas)).toISOString()
                  : null,
              resultadoCompleto: true,
            },
          }
        : {}),
    };
  },
};

const notaInputShape = {
  codigo_nfe: z.number().int().min(1).max(2_147_483_647),
};

export const crmErpGetInvoice: McpToolDefinition<typeof notaInputShape> = {
  name: "crm_erp_get_invoice",
  description:
    "Consulta diretamente uma NFe/NFCe já emitida no sistema de gestão conectado pelo número e devolve status de autorização, chave, lote e se há DANFE disponível. O XML fiscal bruto e a URL externa do DANFE não são entregues ao agente.",
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
