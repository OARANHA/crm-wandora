import { fetchParaDestinoDaOrganizacao } from "@/lib/automation/destinos-internos-autorizados";

import type { CredenciaisVendaErp } from "./tipos";

const TIMEOUT_MS = 12_000;

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
  return getVendaErp(credenciais, "/api/request/Configuracoes/Get");
}

export function pesquisarProdutosVendaErp(
  credenciais: CredenciaisVendaErp,
  filtros: { codigo?: string; nome?: string; pageSize?: number; skip?: number } = {},
): Promise<unknown> {
  return getVendaErp(credenciais, "/api/request/Produtos/Pesquisar", filtros);
}

export function lerEstoqueVendaErp(
  credenciais: CredenciaisVendaErp,
  filtros: { deposito?: string; visivelCatalogo?: boolean } = {},
): Promise<unknown> {
  return getVendaErp(credenciais, "/api/request/Estoque/BuscarQuantidades", filtros);
}

export function pesquisarClientesVendaErp(
  credenciais: CredenciaisVendaErp,
  filtros: { nomefantasia?: string; cpfcnpj?: string; email?: string; pageSize?: number; skip?: number } = {},
): Promise<unknown> {
  return getVendaErp(credenciais, "/api/request/Pessoas/Pesquisar", {
    ...filtros,
    cliente: true,
    fornecedor: false,
  });
}

export function pesquisarPedidosVendaErp(
  credenciais: CredenciaisVendaErp,
  filtros: { codigo?: number; cliente?: string; cpf_cnpj?: string; pageSize?: number; skip?: number } = {},
): Promise<unknown> {
  return getVendaErp(credenciais, "/api/request/Pedidos/Pesquisar", filtros);
}

export function consultarNfeVendaErp(
  credenciais: CredenciaisVendaErp,
  codigoNFe: number,
): Promise<unknown> {
  return getVendaErp(credenciais, "/api/request/Fiscal/ConsultarNFE", { CodigoNFe: codigoNFe });
}
