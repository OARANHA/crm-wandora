import type { SupabaseClient } from "@supabase/supabase-js";

import { motivoDaRecusaDeDestino } from "@/lib/automation/destinos-internos-autorizados";
import { logger } from "@/lib/logger";

import { carregarConexaoVendaErp, dadosCifradosVendaErp } from "./credenciais";
import { normalizarNfesPeriodoVendaErp, type NotaFiscalPeriodoErp } from "./notas-fiscais-periodo";
import type {
  ClienteErp,
  ConexaoErpSegura,
  CredenciaisVendaErp,
  DepositoErp,
  EstoqueErp,
  EstoqueItemErp,
  InformacaoFiscalVendaErp,
  NotaErp,
  PedidoErp,
  ProdutoErp,
} from "./tipos";
import {
  ErroVendaErp,
  consultarInformacoesVendaVendaErp,
  consultarNfeVendaErp,
  consultarNfesPeriodoVendaErp,
  lerEstoqueVendaErp,
  listarDepositosVendaErp,
  pesquisarClientesVendaErp,
  pesquisarPedidosVendaErp,
  pesquisarProdutosVendaErp,
  testarConexaoVendaErp,
  type FiltrosClientesVendaErp,
  type FiltrosPedidosVendaErp,
  type FiltrosProdutosVendaErp,
} from "./vendaerp";

const PROVIDER = "vendaerp";
const COLUNAS_SEGURAS =
  "id, organization_id, provider, label, base_url, access_mode, enabled, auth_token_last4, user_last4, app_last4, last_tested_at, last_test_ok, last_test_error, created_at, updated_at";

export async function listarConexoesErp(
  admin: SupabaseClient,
  organizationId: string,
): Promise<ConexaoErpSegura[]> {
  const { data, error } = await admin
    .from("erp_connections")
    .select(COLUNAS_SEGURAS)
    .eq("organization_id", organizationId)
    .order("provider");

  if (error) {
    logger.warn("integrações ERP: não deu para listar conexões", {
      organizationId,
      codigo: error.code,
      detalhe: error.message,
    });
    return [];
  }
  return (data ?? []) as unknown as ConexaoErpSegura[];
}

export type SalvarVendaErpResultado =
  { ok: true; conexao: ConexaoErpSegura } | { ok: false; motivo: string };

export async function salvarConexaoVendaErp(
  admin: SupabaseClient,
  organizationId: string,
  actorId: string,
  credenciais: CredenciaisVendaErp,
): Promise<SalvarVendaErpResultado> {
  const baseUrl = credenciais.baseUrl.trim().replace(/\/+$/, "");
  const recusa = await motivoDaRecusaDeDestino(baseUrl, "organizacao");
  if (recusa) return { ok: false, motivo: recusa };

  let cifrados: Record<string, string>;
  try {
    cifrados = dadosCifradosVendaErp({
      authorizationToken: credenciais.authorizationToken,
      user: credenciais.user,
      app: credenciais.app,
    });
  } catch {
    return { ok: false, motivo: "cifra_indisponivel" };
  }

  const agora = new Date().toISOString();
  const { data, error } = await admin
    .from("erp_connections")
    .upsert(
      {
        organization_id: organizationId,
        provider: PROVIDER,
        label: "VendaERP",
        base_url: baseUrl,
        access_mode: "read",
        enabled: true,
        ...cifrados,
        created_by: actorId,
        updated_by: actorId,
        updated_at: agora,
        last_tested_at: null,
        last_test_ok: null,
        last_test_error: null,
      },
      { onConflict: "organization_id,provider" },
    )
    .select(COLUNAS_SEGURAS)
    .single();

  if (error || !data) {
    logger.error("integrações ERP: não deu para salvar VendaERP", {
      organizationId,
      codigo: error?.code,
      detalhe: error?.message,
    });
    return { ok: false, motivo: "write_failed" };
  }
  return { ok: true, conexao: data as unknown as ConexaoErpSegura };
}

export type TesteVendaErpResultado =
  { ok: true; conexao: ConexaoErpSegura } | { ok: false; motivo: string; status?: number | null };

export async function testarConexaoVendaErpSalva(
  admin: SupabaseClient,
  organizationId: string,
): Promise<TesteVendaErpResultado> {
  const leitura = await carregarConexaoVendaErp(admin, organizationId);
  if (!leitura.ok) return { ok: false, motivo: leitura.motivo };

  let okTeste = false;
  let erro: string | null = null;
  let status: number | null = null;
  try {
    await testarConexaoVendaErp(leitura.credenciais);
    okTeste = true;
  } catch (e) {
    if (e instanceof ErroVendaErp) {
      erro = e.codigo;
      status = e.status;
    } else {
      erro = e instanceof Error ? e.message : "network_error";
    }
  }

  const testadoEm = new Date().toISOString();
  const { data } = await admin
    .from("erp_connections")
    .update({
      last_tested_at: testadoEm,
      last_test_ok: okTeste,
      last_test_error: erro,
      updated_at: testadoEm,
    })
    .eq("organization_id", organizationId)
    .eq("provider", PROVIDER)
    .select(COLUNAS_SEGURAS)
    .single();

  if (!okTeste) return { ok: false, motivo: erro ?? "provider_error", status };
  if (!data) return { ok: false, motivo: "write_failed" };
  return { ok: true, conexao: data as unknown as ConexaoErpSegura };
}

// ---------------------------------------------------------------------------
// Leitura para o agente: conexão -> provider -> projeção estável do Elus
// ---------------------------------------------------------------------------

export type ConsultaErpResultado<T> =
  | { ok: true; dados: T }
  | { ok: false; motivo: string; status?: number | null; detalhes?: Record<string, unknown> };

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function listaDeObjetos(valor: unknown): Record<string, unknown>[] {
  if (!Array.isArray(valor)) throw new ErroVendaErp("invalid_response");
  const registros: Record<string, unknown>[] = [];
  for (const item of valor) {
    const registro = objeto(item);
    if (!registro) throw new ErroVendaErp("invalid_response");
    registros.push(registro);
  }
  return registros;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
}

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function booleano(valor: unknown): boolean | null {
  return typeof valor === "boolean" ? valor : null;
}

export function normalizarDepositosVendaErp(valor: unknown): DepositoErp[] {
  return listaDeObjetos(valor).map((d) => ({
    // O Swagger documenta camelCase; resposta real observada em 2026-10-01
    // veio em PascalCase. O adapter aceita os dois e o resto do Elus não precisa
    // conhecer essa inconsistência do provider.
    id: texto(d.id ?? d.ID),
    nome: texto(d.nome ?? d.Nome),
    empresaId: texto(d.empresaID ?? d.EmpresaID),
    empresa: texto(d.empresa ?? d.Empresa),
  }));
}

export function normalizarEstoqueVendaErp(valor: unknown): EstoqueItemErp[] {
  const envelope = objeto(valor);
  if (!envelope) throw new ErroVendaErp("invalid_response");

  // O Swagger recebido não descreve o corpo de BuscarQuantidades. A forma
  // abaixo foi observada em resposta autenticada real em 2026-10-01.
  const itens = envelope.EstoqueItens ?? envelope.estoqueItens;
  return listaDeObjetos(itens).map((item) => ({
    codigo: texto(item.ProdutoCodigo ?? item.produtoCodigo),
    estoqueAtual: numero(item.EstoqueAtual ?? item.estoqueAtual),
    saldoReservado: numero(item.SaldoReservado ?? item.saldoReservado),
  }));
}

export type ResolucaoDepositoEstoque =
  | { ok: true; deposito: string; origem: "informado" | "unico" }
  | {
      ok: false;
      motivo: "sem_deposito" | "deposito_ambiguo" | "deposito_sem_nome";
      depositos: DepositoErp[];
    };

export function resolverDepositoEstoque(
  informado: string | undefined,
  depositos: readonly DepositoErp[],
): ResolucaoDepositoEstoque {
  const nomeInformado = informado?.trim();
  if (nomeInformado) return { ok: true, deposito: nomeInformado, origem: "informado" };

  if (depositos.length === 0) return { ok: false, motivo: "sem_deposito", depositos: [] };
  if (depositos.length > 1) {
    return { ok: false, motivo: "deposito_ambiguo", depositos: [...depositos] };
  }

  const nome = depositos[0]?.nome?.trim();
  if (!nome) return { ok: false, motivo: "deposito_sem_nome", depositos: [...depositos] };
  return { ok: true, deposito: nome, origem: "unico" };
}

export function normalizarProdutosVendaErp(valor: unknown): ProdutoErp[] {
  return listaDeObjetos(valor).map((p) => ({
    id: texto(p.id),
    codigo: texto(p.codigo),
    nome: texto(p.nome),
    preco: numero(p.precoVenda),
    estoque: numero(p.estoqueSaldo),
    unidade: texto(p.estoqueUnidade),
    ean: texto(p.ean),
    marca: texto(p.marca),
    categoria: texto(p.categoria),
  }));
}

export function normalizarClientesVendaErp(valor: unknown): ClienteErp[] {
  return listaDeObjetos(valor).map((p) => {
    const nomeFantasia = texto(p.nomeFantasia);
    const razaoSocial = texto(p.razaoSocial);
    return {
      id: texto(p.id),
      nome: nomeFantasia ?? razaoSocial,
      nomeFantasia,
      razaoSocial,
      cpfCnpj: texto(p.cnpJ_CPF),
      email: texto(p.email),
      telefone: texto(p.telefone),
      celular: texto(p.celular),
      cidade: texto(p.cidade),
      uf: texto(p.uf),
    };
  });
}

export function normalizarNotaVendaErp(valor: unknown): NotaErp {
  const n = objeto(valor);
  if (!n) throw new ErroVendaErp("invalid_response");

  // Resposta observada em execução em 2026-10-01. XML é deliberadamente
  // ignorado: é grande, pode carregar dados fiscais/PII desnecessários e não é
  // preciso para o agente confirmar autorização, chave ou DANFE.
  return {
    numero: numero(n.Numero ?? n.numero),
    codigoStatus: numero(n.CodigoStatus ?? n.codigoStatus),
    mensagemStatus: texto(n.MsgStatus ?? n.msgStatus),
    chave: texto(n.ChaveNFe ?? n.chaveNFe),
    lote: numero(n.Lote ?? n.lote),
    danfeUrl: texto(n.UrlImpressaoDanfe ?? n.urlImpressaoDanfe),
  };
}

export function normalizarInformacaoFiscalVendaVendaErp(valor: unknown): InformacaoFiscalVendaErp {
  const n = objeto(valor);
  if (!n) throw new ErroVendaErp("invalid_response");

  // InformacoesVenda é uma visão fiscal por código da venda. A data observada
  // vem como texto local do provider ("dd/MM/yyyy - HH:mm"), por isso não é
  // convertida para ISO sem contrato explícito de timezone.
  return {
    tipo: texto(n.Tipo ?? n.tipo),
    numero: numero(n.Numero ?? n.numero),
    serie: texto(n.Serie ?? n.serie),
    chave: texto(n.ChaveAcesso ?? n.chaveAcesso),
    dataEmissao: texto(n.DataEmissao ?? n.dataEmissao),
    danfeUrl: texto(n.UrlImpressaoUrl ?? n.urlImpressaoUrl),
  };
}

function normalizarPedidoVendaErp(p: Record<string, unknown>): PedidoErp {
  return {
    id: texto(p.id),
    codigo: numero(p.codigo),
    cliente: texto(p.cliente),
    status: texto(p.status),
    statusSistema: texto(p.statusSistema),
    total: numero(p.valorFinal),
    data: texto(p.data),
    finalizado: booleano(p.finalizado),
    numeroNFe: texto(p.numeroNFe),
    dataFaturamento: texto(p.dataFaturamento),
    chaveAcessoNFe: texto(p.chaveAcessoNFe),
    danfeUrl: texto(p.danfeURL),
    urlSefaz: texto(p.urlSefaz),
  };
}

export function normalizarPedidosVendaErp(valor: unknown): PedidoErp[] {
  return listaDeObjetos(valor).map(normalizarPedidoVendaErp);
}

/**
 * Identidade do cliente que existe no schema Pedido do VendaERP, mas NÃO faz
 * parte da projeção pública PedidoErp. Estes campos servem apenas para provar,
 * no backend, que um documento fiscal pertence ao contato da conversa.
 *
 * Nunca devolver este envelope ao browser ou ao contexto do agente.
 */
export interface PedidoErpComIdentidadeInterna {
  pedido: PedidoErp;
  identidadeCliente: {
    pessoaId: string | null;
    cpfCnpj: string | null;
    email: string | null;
  };
}

export function normalizarPedidosVendaErpComIdentidadeInterna(
  valor: unknown,
): PedidoErpComIdentidadeInterna[] {
  return listaDeObjetos(valor).map((p) => ({
    pedido: normalizarPedidoVendaErp(p),
    identidadeCliente: {
      // O provider já respondeu em PascalCase em outros endpoints reais.
      // O Swagger documenta camelCase; aceitamos ambos sem alterar semântica.
      pessoaId: texto(p.pessoaID ?? p.PessoaID),
      cpfCnpj: texto(p.clienteCNPJ ?? p.ClienteCNPJ),
      email: texto(p.clienteEmail ?? p.ClienteEmail),
    },
  }));
}

async function executarLeituraVendaErp<T>(
  admin: SupabaseClient,
  organizationId: string,
  executar: (credenciais: CredenciaisVendaErp) => Promise<T>,
): Promise<ConsultaErpResultado<T>> {
  const leitura = await carregarConexaoVendaErp(admin, organizationId);
  if (!leitura.ok) return { ok: false, motivo: leitura.motivo };

  try {
    return { ok: true, dados: await executar(leitura.credenciais) };
  } catch (erro) {
    if (erro instanceof ErroVendaErp) {
      return { ok: false, motivo: erro.codigo, status: erro.status };
    }
    return { ok: false, motivo: "provider_error" };
  }
}

export async function buscarProdutosErp(
  admin: SupabaseClient,
  organizationId: string,
  filtros: FiltrosProdutosVendaErp,
): Promise<ConsultaErpResultado<ProdutoErp[]>> {
  return executarLeituraVendaErp(admin, organizationId, async (credenciais) =>
    normalizarProdutosVendaErp(await pesquisarProdutosVendaErp(credenciais, filtros)),
  );
}

/**
 * Consulta o endpoint oficial Estoque/BuscarQuantidades.
 *
 * Se o depósito vier informado, não fazemos uma chamada extra para "validar":
 * o provider é a fonte da verdade e o teste real confirmou que ele aceita o
 * NOME do depósito. Se não vier, listamos os depósitos; um único é escolhido
 * automaticamente, vários viram resposta ambígua para o agente decidir com a
 * pessoa — nunca escolhemos no chute.
 *
 * EstoqueAtual e SaldoReservado são preservados separadamente. Não calculamos
 * "disponível" porque o material recebido ainda não documenta a relação
 * semântica entre esses dois números.
 */
export async function lerEstoqueErp(
  admin: SupabaseClient,
  organizationId: string,
  filtros: {
    codigo?: string;
    deposito?: string;
    visivelCatalogo?: boolean;
  },
): Promise<ConsultaErpResultado<EstoqueErp>> {
  const leitura = await carregarConexaoVendaErp(admin, organizationId);
  if (!leitura.ok) return { ok: false, motivo: leitura.motivo };

  try {
    let depositos: DepositoErp[] = [];
    if (!filtros.deposito?.trim()) {
      depositos = normalizarDepositosVendaErp(await listarDepositosVendaErp(leitura.credenciais));
    }

    const resolucao = resolverDepositoEstoque(filtros.deposito, depositos);
    if (!resolucao.ok) {
      return {
        ok: false,
        motivo: resolucao.motivo,
        detalhes: { depositos: resolucao.depositos },
      };
    }

    let itens = normalizarEstoqueVendaErp(
      await lerEstoqueVendaErp(leitura.credenciais, {
        deposito: resolucao.deposito,
        visivelCatalogo: filtros.visivelCatalogo ?? false,
      }),
    );

    const codigo = filtros.codigo?.trim().toLocaleLowerCase("pt-BR");
    if (codigo) {
      itens = itens.filter((item) => item.codigo?.trim().toLocaleLowerCase("pt-BR") === codigo);
    }

    return {
      ok: true,
      dados: {
        deposito: resolucao.deposito,
        itens,
      },
    };
  } catch (erro) {
    if (erro instanceof ErroVendaErp) {
      return { ok: false, motivo: erro.codigo, status: erro.status };
    }
    return { ok: false, motivo: "provider_error" };
  }
}

export async function buscarClientesErp(
  admin: SupabaseClient,
  organizationId: string,
  filtros: FiltrosClientesVendaErp,
): Promise<ConsultaErpResultado<ClienteErp[]>> {
  return executarLeituraVendaErp(admin, organizationId, async (credenciais) =>
    normalizarClientesVendaErp(await pesquisarClientesVendaErp(credenciais, filtros)),
  );
}

export async function buscarPedidosErp(
  admin: SupabaseClient,
  organizationId: string,
  filtros: FiltrosPedidosVendaErp,
): Promise<ConsultaErpResultado<PedidoErp[]>> {
  return executarLeituraVendaErp(admin, organizationId, async (credenciais) =>
    normalizarPedidosVendaErp(await pesquisarPedidosVendaErp(credenciais, filtros)),
  );
}

/**
 * Mesma leitura de Pedidos/Pesquisar, porém com a identidade mínima necessária
 * para o gate documento -> cliente. A capability pública continua chamando
 * buscarPedidosErp(), que não contém estes campos sensíveis.
 */
export async function buscarPedidosErpComIdentidadeInterna(
  admin: SupabaseClient,
  organizationId: string,
  filtros: FiltrosPedidosVendaErp,
): Promise<ConsultaErpResultado<PedidoErpComIdentidadeInterna[]>> {
  return executarLeituraVendaErp(admin, organizationId, async (credenciais) =>
    normalizarPedidosVendaErpComIdentidadeInterna(
      await pesquisarPedidosVendaErp(credenciais, filtros),
    ),
  );
}

/**
 * Consulta fiscal direta por número de NFe/NFCe.
 *
 * O Swagger não tipa o 200, mas a resposta real foi observada em 2026-10-01.
 * A projeção interna mantém apenas status, chave, lote e URL de DANFE; o XML
 * retornado pelo provider não entra no contexto do agente.
 */
export async function obterNotaErp(
  admin: SupabaseClient,
  organizationId: string,
  codigoNFe: number,
): Promise<ConsultaErpResultado<NotaErp>> {
  return executarLeituraVendaErp(admin, organizationId, async (credenciais) =>
    normalizarNotaVendaErp(await consultarNfeVendaErp(credenciais, codigoNFe)),
  );
}

/**
 * Segunda visão fiscal, por código da venda. Ela fica disponível no service para
 * composições futuras, mas não cria uma sexta capability pública nesta V1.
 */
export async function obterInformacaoFiscalDaVendaErp(
  admin: SupabaseClient,
  organizationId: string,
  codigoVenda: number,
): Promise<ConsultaErpResultado<InformacaoFiscalVendaErp>> {
  return executarLeituraVendaErp(admin, organizationId, async (credenciais) =>
    normalizarInformacaoFiscalVendaVendaErp(
      await consultarInformacoesVendaVendaErp(credenciais, codigoVenda),
    ),
  );
}


/**
 * Leitura fiscal isolada, com filtragem do XML no servidor e sem retorno de PII
 * ao modelo. A paginação é conduzida pela capability, não pelo LLM.
 */
export async function buscarNfesPeriodoErp(
  admin: SupabaseClient,
  organizationId: string,
  filtros: { dataInicial: string; dataFinal: string; pageSize: number; skip: number },
): Promise<ConsultaErpResultado<NotaFiscalPeriodoErp[]>> {
  return executarLeituraVendaErp(admin, organizationId, async (credenciais) => {
    const resposta = await consultarNfesPeriodoVendaErp(credenciais, filtros);
    try {
      return normalizarNfesPeriodoVendaErp(resposta);
    } catch {
      throw new ErroVendaErp("invalid_response");
    }
  });
}
