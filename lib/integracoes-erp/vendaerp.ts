import { fetchParaDestinoDaOrganizacao } from "@/lib/automation/destinos-internos-autorizados";

import type { CredenciaisVendaErp } from "./tipos";

const TIMEOUT_MS = 12_000;

export const VENDAERP_ENDPOINTS = {
  configuracoesGet: "/api/request/Configuracoes/Get",
  depositosGetTodos: "/api/request/Depositos/GetTodosDepositos",
  produtosPesquisar: "/api/request/Produtos/Pesquisar",
  estoqueBuscarQuantidades: "/api/request/Estoque/BuscarQuantidades",
  pessoasPesquisar: "/api/request/Pessoas/Pesquisar",
  pedidosPesquisar: "/api/request/Pedidos/Pesquisar",
  fiscalInformacoesVenda: "/api/request/Fiscal/InformacoesVenda",
  fiscalConsultarNfe: "/api/request/Fiscal/ConsultarNFE",
} as const;

export interface FiltrosProdutosVendaErp {
  codigo?: string;
  numeroSerie?: string;
  nome?: string;
  genero?: string;
  categoria?: string;
  marca?: string;
  deposito?: string;
  ean?: string;
  alteradoApos?: string;
  pageSize?: number;
  skip?: number;
}

export interface FiltrosClientesVendaErp {
  nomefantasia?: string;
  cpfcnpj?: string;
  cidade?: string;
  uf?: string;
  alteradoapos?: string;
  pageSize?: number;
  skip?: number;
  email?: string;
  codigoIdentificadorUnico?: string;
}

export interface FiltrosPedidosVendaErp {
  codigo?: number;
  origem?: string;
  status?: string;
  statuscliente?: string;
  categoria?: string;
  cliente?: string;
  pageSize?: number;
  skip?: number;
  cpf_cnpj?: string;
  alteradoApos?: string;
  dataInicial?: string;
  dataFinal?: string;
  empresa?: string;
  numeroNFe?: string;
  vendedor?: string;
  transportadora?: string;
  possuiNotaFiscal?: boolean;
  incluirImpostos?: boolean;
}

export class ErroVendaErp extends Error {
  constructor(
    public readonly codigo: string,
    public readonly status: number | null = null,
  ) {
    super(codigo);
    this.name = "ErroVendaErp";
  }
}

export function montarUrlVendaErp(
  baseUrl: string,
  caminho: string,
  query: Record<string, string | number | boolean | null | undefined> = {},
): string {
  const base = baseUrl.trim().replace(/\/+$/, "") + "/";
  const url = new URL(caminho.replace(/^\/+/, ""), base);
  for (const [chave, valor] of Object.entries(query)) {
    if (valor !== null && valor !== undefined && valor !== "") {
      url.searchParams.set(chave, String(valor));
    }
  }
  return url.toString();
}

export function cabecalhosVendaErp(
  credenciais: Pick<CredenciaisVendaErp, "authorizationToken" | "user" | "app">,
): Record<string, string> {
  return {
    "Authorization-Token": credenciais.authorizationToken,
    User: credenciais.user,
    App: credenciais.app,
    Accept: "application/json",
  };
}

async function getVendaErp(
  credenciais: CredenciaisVendaErp,
  caminho: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): Promise<unknown> {
  const url = montarUrlVendaErp(credenciais.baseUrl, caminho, query);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // O wrapper revalida o destino no momento da chamada e força redirect manual.
    const seguro = fetchParaDestinoDaOrganizacao();
    const resposta = await seguro(url, {
      method: "GET",
      headers: cabecalhosVendaErp(credenciais),
      signal: ctrl.signal,
    });

    if (resposta.status === 429) throw new ErroVendaErp("rate_limited", 429);
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroVendaErp("auth_failed", resposta.status);
    }
    if (!resposta.ok) throw new ErroVendaErp("provider_status_" + resposta.status, resposta.status);

    const texto = await resposta.text();
    if (!texto) return null;
    try {
      return JSON.parse(texto) as unknown;
    } catch {
      return texto;
    }
  } catch (erro) {
    if (erro instanceof ErroVendaErp) throw erro;
    if (erro instanceof Error && erro.name === "AbortError") throw new ErroVendaErp("timeout");
    throw new ErroVendaErp(erro instanceof Error ? erro.message : "network_error");
  } finally {
    clearTimeout(timer);
  }
}

export function testarConexaoVendaErp(credenciais: CredenciaisVendaErp): Promise<unknown> {
  return getVendaErp(credenciais, VENDAERP_ENDPOINTS.configuracoesGet);
}

export function listarDepositosVendaErp(credenciais: CredenciaisVendaErp): Promise<unknown> {
  return getVendaErp(credenciais, VENDAERP_ENDPOINTS.depositosGetTodos);
}

export function pesquisarProdutosVendaErp(
  credenciais: CredenciaisVendaErp,
  filtros: FiltrosProdutosVendaErp = {},
): Promise<unknown> {
  return getVendaErp(credenciais, VENDAERP_ENDPOINTS.produtosPesquisar, { ...filtros });
}

export function lerEstoqueVendaErp(
  credenciais: CredenciaisVendaErp,
  filtros: { deposito?: string; visivelCatalogo?: boolean } = {},
): Promise<unknown> {
  return getVendaErp(credenciais, VENDAERP_ENDPOINTS.estoqueBuscarQuantidades, filtros);
}

export function pesquisarClientesVendaErp(
  credenciais: CredenciaisVendaErp,
  filtros: FiltrosClientesVendaErp = {},
): Promise<unknown> {
  return getVendaErp(credenciais, VENDAERP_ENDPOINTS.pessoasPesquisar, {
    ...filtros,
    cliente: true,
    fornecedor: false,
  });
}

export function pesquisarPedidosVendaErp(
  credenciais: CredenciaisVendaErp,
  filtros: FiltrosPedidosVendaErp = {},
): Promise<unknown> {
  return getVendaErp(credenciais, VENDAERP_ENDPOINTS.pedidosPesquisar, { ...filtros });
}

export function consultarInformacoesVendaVendaErp(
  credenciais: CredenciaisVendaErp,
  codigoVenda: number,
): Promise<unknown> {
  return getVendaErp(credenciais, VENDAERP_ENDPOINTS.fiscalInformacoesVenda, { Codigo: codigoVenda });
}

export function consultarNfeVendaErp(
  credenciais: CredenciaisVendaErp,
  codigoNFe: number,
): Promise<unknown> {
  return getVendaErp(credenciais, VENDAERP_ENDPOINTS.fiscalConsultarNfe, { CodigoNFe: codigoNFe });
}
