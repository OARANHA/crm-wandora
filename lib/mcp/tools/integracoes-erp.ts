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
  obterInformacaoFiscalDaVendaErp,
  obterNotaErp,
  type ConsultaErpResultado,
  type PedidoErpComIdentidadeInterna,
} from "@/lib/integracoes-erp/service";
import { carregarVinculoClienteExterno } from "@/lib/integracoes-erp/identidade-externa-cliente";
import { PROVEDOR_VENDAERP } from "@/lib/integracoes-erp/provedores";
import {
  resolverClienteVendaErp,
  resolverClienteVendaErpPorPedidos,
  type CandidatoClienteSeguro,
} from "@/lib/integracoes-erp/resolucao-cliente-vendaerp";
import type { ClienteErp, PedidoErp } from "@/lib/integracoes-erp/tipos";

import type { McpContext, McpToolDefinition } from "../types";

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

function motivoBuscaPedidos(resultado: unknown): string | null {
  if (resultado === null || typeof resultado !== "object") return null;
  const r = resultado as Record<string, unknown>;
  if (r.erro === "identidade_pedido_nao_confirmada" || r.erro === "identidade_pedido_ambigua") {
    const resolucao = r.resolucao_cliente;
    if (resolucao && typeof resolucao === "object") {
      const motivo = (resolucao as Record<string, unknown>).motivo;
      if (typeof motivo === "string" && motivo.trim()) {
        return `${String(r.erro)}:${motivo}`;
      }
    }
  }
  return motivoDoVazio("pedidos")(resultado);
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

let buscasPedidosPorTurno = new Map<string, BuscaPedidosNoTurno>();

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
  buscasPedidosPorTurno = new Map(
    [...buscasPedidosPorTurno].filter(([, busca]) => busca.expiraEm > agora),
  );
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

// Um fallback por contato não pode esquecer a quantidade fiscal solicitada no mesmo turno.
// Guardamos somente a quantidade, por organização e requestId; nunca nome, identidade ou PII.
const PENDENCIA_NOTAS_RECENTES_TTL_MS = 120_000;
const notasRecentesPendentesPorTurno = new Map<string, { quantidade: number; expiraEm: number }>();

function chaveNotasRecentesDoTurno(ctx: McpContext): string {
  return `${ctx.organizationId}:${ctx.requestId}`;
}

function registrarNotasRecentesPendentes(ctx: McpContext, quantidade: number): void {
  const agora = Date.now();
  for (const [chave, pendencia] of notasRecentesPendentesPorTurno) {
    if (pendencia.expiraEm <= agora) notasRecentesPendentesPorTurno.delete(chave);
  }
  notasRecentesPendentesPorTurno.set(chaveNotasRecentesDoTurno(ctx), {
    quantidade,
    expiraEm: agora + PENDENCIA_NOTAS_RECENTES_TTL_MS,
  });
}

function notasRecentesPendentes(ctx: McpContext): number | null {
  const chave = chaveNotasRecentesDoTurno(ctx);
  const pendencia = notasRecentesPendentesPorTurno.get(chave);
  if (!pendencia) return null;
  if (pendencia.expiraEm <= Date.now()) {
    notasRecentesPendentesPorTurno.delete(chave);
    return null;
  }
  return pendencia.quantidade;
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
      let buscaPedidos = buscarPedidosNoMesmoTurno(ctx.requestId, input.nome);
      if (!buscaPedidos) {
        // Tool calls do mesmo step podem ser disparadas em paralelo. Cedemos um
        // tick para a busca de pedidos registrar sua promessa mesmo quando o
        // scheduler inicia customers alguns milissegundos antes.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        buscaPedidos = buscarPedidosNoMesmoTurno(ctx.requestId, input.nome);
      }
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
  ultimas_notas: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Retorna as N NFes mais recentes do cliente por data fiscal comprovada. Pagina o conjunto antes de ordenar e falha fechado se não conseguir provar a recência.",
    ),
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

const TAMANHO_PAGINA_NOTAS_RECENTES = 100;
const MAX_PAGINAS_NOTAS_RECENTES = 5;
const MAX_ENRIQUECIMENTOS_FISCAIS = 20;

async function buscarConjuntoCompleto<T>(
  buscar: (pageSize: number, skip: number) => Promise<ConsultaErpResultado<T[]>>,
): Promise<ConsultaErpResultado<T[]>> {
  const acumulados: T[] = [];
  let skip = 0;

  for (let pagina = 0; pagina < MAX_PAGINAS_NOTAS_RECENTES; pagina += 1) {
    const lote = await buscar(TAMANHO_PAGINA_NOTAS_RECENTES, skip);
    if (!lote.ok) return lote;
    if (lote.dados.length > TAMANHO_PAGINA_NOTAS_RECENTES) {
      return { ok: false, motivo: "invalid_response" };
    }
    if (lote.dados.length === 0) {
      return { ok: true, dados: acumulados };
    }

    // O provider pode limitar pageSize: avancar pelos itens recebidos, nao pelos solicitados.
    acumulados.push(...lote.dados);
    skip += lote.dados.length;
  }

  const limiteAnalisado = skip;
  const provaDeFim = await buscar(1, limiteAnalisado);
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

function instanteFiscalLocal(valor: string | null): number | null {
  if (!valor) return null;
  const iso = Date.parse(valor);
  if (Number.isFinite(iso)) return iso;

  const local = valor
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s*-\s*|\s+)(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!local) return null;
  const [, dia, mes, ano, hora, minuto, segundo] = local;
  return Date.UTC(
    Number(ano),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo ?? "0"),
  );
}

async function ordenarUltimasNotas(
  ctx: McpContext,
  pedidosBrutos: readonly PedidoErp[],
  quantidade: number,
): Promise<
  | { ok: true; pedidos: PedidoErp[]; quantidadeEncontrada: number }
  | { ok: false; erro: string; mensagem: string }
> {
  const comNfe = pedidosBrutos.filter((pedido) => Boolean(pedido.numeroNFe?.trim()));
  if (comNfe.length === 0) return { ok: true, pedidos: [], quantidadeEncontrada: 0 };

  const semData = comNfe.filter((pedido) => instanteFiscalLocal(pedido.dataFaturamento) === null);
  if (semData.length > MAX_ENRIQUECIMENTOS_FISCAIS) {
    return {
      ok: false,
      erro: "data_faturamento_indisponivel",
      mensagem:
        "há muitas notas sem data fiscal utilizável para provar quais são as mais recentes com segurança.",
    };
  }

  const datasPorPedido = new Map<PedidoErp, number>();
  for (const pedido of comNfe) {
    const direta = instanteFiscalLocal(pedido.dataFaturamento);
    if (direta !== null) {
      datasPorPedido.set(pedido, direta);
      continue;
    }

    if (typeof pedido.codigo !== "number") {
      return {
        ok: false,
        erro: "data_faturamento_indisponivel",
        mensagem:
          "há nota sem data de faturamento e sem código de venda utilizável para confirmar a data fiscal.",
      };
    }

    const fiscal = await obterInformacaoFiscalDaVendaErp(
      ctx.supabase,
      ctx.organizationId,
      pedido.codigo,
    );
    if (!fiscal.ok) {
      return {
        ok: false,
        erro: fiscal.motivo,
        mensagem: mensagemDeFalha(fiscal.motivo),
      };
    }

    const enriquecida = instanteFiscalLocal(fiscal.dados.dataEmissao);
    if (enriquecida === null) {
      return {
        ok: false,
        erro: "data_faturamento_indisponivel",
        mensagem:
          "há nota cuja data fiscal não pôde ser confirmada; não dá para afirmar quais são as últimas sem adivinhar.",
      };
    }
    datasPorPedido.set(pedido, enriquecida);
  }

  const ordenados = [...comNfe].sort((a, b) => {
    const dataA = datasPorPedido.get(a) ?? Number.NEGATIVE_INFINITY;
    const dataB = datasPorPedido.get(b) ?? Number.NEGATIVE_INFINITY;
    if (dataA !== dataB) return dataB - dataA;
    return (b.codigo ?? Number.NEGATIVE_INFINITY) - (a.codigo ?? Number.NEGATIVE_INFINITY);
  });

  return {
    ok: true,
    pedidos: ordenados.slice(0, quantidade),
    quantidadeEncontrada: ordenados.length,
  };
}

export const crmErpSearchOrders: McpToolDefinition<typeof pedidosInputShape> = {
  name: "crm_erp_search_orders",
  description:
    "Procura pedidos e localiza NFe/NFCe relacionadas no ERP. Quando a solicitação JÁ é sobre pedidos, compras, notas ou NFes de um cliente e você só tem o nome/razão social, use esta ferramenta DIRETAMENTE com cliente; crm_erp_search_customers NÃO é pré-requisito. Para 'última nota' ou 'últimas N notas', informe ultimas_notas=N: a capability pagina o conjunto, considera somente pedidos com NFe, comprova a data fiscal e devolve as NFes mais recentes em ordem decrescente. Se o cliente já foi resolvido e existe cliente_contact_id, prefira esse id.",
  inputSchema: pedidosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  redigirParaAuditoria: redigirBusca,
  motivoDoVazio: motivoBuscaPedidos,
  handler: async (input, ctx) => {
    if (
      !input.codigo &&
      !input.cliente &&
      !input.cpf_cnpj &&
      !input.cliente_contact_id &&
      !input.status &&
      !input.numero_nfe &&
      !input.ultimas_notas
    ) {
      return {
        erro: "filtro_obrigatorio",
        mensagem:
          "informe ao menos um identificador, cliente resolvido, status, número da nota ou quantidade de últimas notas.",
      };
    }

    if (input.cliente_contact_id) {
      // O modelo pode mudar para a identidade vinculada após uma busca por nome vazia,
      // mas não pode transformar "últimas 2" em uma lista arbitrária de 20 pedidos.
      const quantidadePendente = notasRecentesPendentes(ctx);
      if (quantidadePendente !== null && !input.ultimas_notas) {
        return {
          erro: "continuacao_notas_sem_ranking",
          mensagem:
            `A solicitação ainda exige as últimas ${quantidadePendente} NFes. Confirme que cliente_contact_id corresponde ao cliente solicitado e repita crm_erp_search_orders com cliente_contact_id e ultimas_notas=${quantidadePendente}. Não use uma lista comum de pedidos como ranking fiscal e não peça ao administrador o número/data da outra NFe.`,
          ultimas_notas_necessarias: quantidadePendente,
        };
      }
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

      const r = input.ultimas_notas
        ? await buscarConjuntoCompleto<PedidoErpComIdentidadeInterna>((pageSize, skip) =>
            buscarPedidosErpComIdentidadeInterna(ctx.supabase, ctx.organizationId, {
              codigo: input.codigo,
              cliente: leitura.vinculo!.providerLookupLabel,
              status: input.status,
              numeroNFe: input.numero_nfe,
              pageSize,
              skip,
            }),
          )
        : await buscarPedidosErpComIdentidadeInterna(ctx.supabase, ctx.organizationId, {
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

      if (input.ultimas_notas) {
        const ranking = await ordenarUltimasNotas(
          ctx,
          comprovados.map((item) => item.pedido),
          input.ultimas_notas,
        );
        if (!ranking.ok) return ranking;
        notasRecentesPendentesPorTurno.delete(chaveNotasRecentesDoTurno(ctx));
        return {
          resolucao_cliente: {
            status: "resolved",
            contact_id: input.cliente_contact_id,
            origem: "external_identity_link",
          },
          pedidos: ranking.pedidos.map(projetarPedidoParaTool),
          resumo: {
            quantidadeEncontrada: ranking.quantidadeEncontrada,
            quantidadeRetornada: ranking.pedidos.length,
            resultadoCompleto: true,
          },
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

    if (input.cliente && !input.cpf_cnpj) {
      const resolverSequenciamento = registrarBuscaPedidosNoTurno(ctx.requestId, input.cliente);
      try {
        const r = input.ultimas_notas
          ? await buscarConjuntoCompleto<PedidoErpComIdentidadeInterna>((pageSize, skip) =>
              buscarPedidosErpComIdentidadeInterna(ctx.supabase, ctx.organizationId, {
                codigo: input.codigo,
                cliente: input.cliente,
                status: input.status,
                numeroNFe: input.numero_nfe,
                pageSize,
                skip,
              }),
            )
          : await buscarPedidosErpComIdentidadeInterna(ctx.supabase, ctx.organizationId, {
              codigo: input.codigo,
              cliente: input.cliente,
              status: input.status,
              numeroNFe: input.numero_nfe,
              pageSize: input.limite,
              skip: input.skip,
            });
        if (!r.ok) {
          resolverSequenciamento?.(false);
          return resposta(r);
        }

        const pedidos = r.dados.map((item) => item.pedido);
        if (pedidos.length === 0) {
          resolverSequenciamento?.(false);
          if (input.ultimas_notas) {
            registrarNotasRecentesPendentes(ctx, input.ultimas_notas);
          }
          return { pedidos: [] };
        }

        const resolucao = await resolverClienteVendaErpPorPedidos(
          ctx.supabase,
          ctx.organizationId,
          input.cliente,
          r.dados,
          {
            actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
            actorApiTokenId: ctx.actor.type === "user" ? null : ctx.apiTokenId,
            requestId: ctx.requestId,
          },
        );

        if (resolucao.status === "resolved") {
          resolverSequenciamento?.(true);
          if (input.ultimas_notas) {
            const ranking = await ordenarUltimasNotas(ctx, pedidos, input.ultimas_notas);
            if (!ranking.ok) return ranking;
            return {
              resolucao_cliente: {
                status: "resolved",
                contact_id: resolucao.contactId,
                origem: resolucao.origem,
                materializado: resolucao.materialized,
              },
              pedidos: ranking.pedidos.map(projetarPedidoParaTool),
              resumo: {
                quantidadeEncontrada: ranking.quantidadeEncontrada,
                quantidadeRetornada: ranking.pedidos.length,
                resultadoCompleto: true,
              },
            };
          }
          return {
            resolucao_cliente: {
              status: "resolved",
              contact_id: resolucao.contactId,
              origem: resolucao.origem,
              materializado: resolucao.materialized,
            },
            pedidos: pedidos.map(projetarPedidoParaTool),
          };
        }

        resolverSequenciamento?.(false);
        if (resolucao.status === "ambiguous") {
          return {
            erro: "identidade_pedido_ambigua",
            mensagem:
              "o VendaERP retornou pedidos ligados a mais de uma identidade de cliente para esse Nome/Razão Social; informe CPF/CNPJ ou outro identificador forte antes de escolher.",
            resolucao_cliente: { status: "ambiguous", motivo: resolucao.motivo },
            candidatos: resolucao.candidatos,
          };
        }

        return {
          erro: "identidade_pedido_nao_confirmada",
          mensagem:
            "o VendaERP encontrou pedidos para esse nome, mas a identidade do cliente não pôde ser provada com segurança. Resolva o cliente por CPF/CNPJ, e-mail ou crm_erp_search_customers antes de usar esses pedidos.",
          resolucao_cliente: {
            status: "unresolved",
            motivo: resolucao.status === "not_found" ? "nao_encontrado" : resolucao.motivo,
          },
        };
      } catch (erro) {
        resolverSequenciamento?.(false);
        throw erro;
      }
    }

    const r = input.ultimas_notas
      ? await buscarConjuntoCompleto<PedidoErp>((pageSize, skip) =>
          buscarPedidosErp(ctx.supabase, ctx.organizationId, {
            codigo: input.codigo,
            cliente: input.cliente,
            cpf_cnpj: input.cpf_cnpj,
            status: input.status,
            numeroNFe: input.numero_nfe,
            pageSize,
            skip,
          }),
        )
      : await buscarPedidosErp(ctx.supabase, ctx.organizationId, {
          codigo: input.codigo,
          cliente: input.cliente,
          cpf_cnpj: input.cpf_cnpj,
          status: input.status,
          numeroNFe: input.numero_nfe,
          pageSize: input.limite,
          skip: input.skip,
        });
    const saida = resposta(r);
    if (saida.erro) return saida;

    if (input.ultimas_notas) {
      const ranking = await ordenarUltimasNotas(ctx, saida.dados ?? [], input.ultimas_notas);
      if (!ranking.ok) return ranking;
      return {
        pedidos: ranking.pedidos.map(projetarPedidoParaTool),
        resumo: {
          quantidadeEncontrada: ranking.quantidadeEncontrada,
          quantidadeRetornada: ranking.pedidos.length,
          resultadoCompleto: true,
        },
      };
    }

    return { pedidos: saida.dados?.map((pedido) => projetarPedidoParaTool(pedido)) };
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
