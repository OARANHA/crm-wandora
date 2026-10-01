export type NivelDeAcessoErp = "read" | "write" | "destructive";

export const CAPACIDADES_ERP = [
  "products.search",
  "stock.read",
  "customers.search",
  "orders.search",
  "invoice.get",
  "orders.save",
  "orders.invoice",
  "invoice.issue_nfe",
  "invoice.issue_nfce",
  "orders.delete",
] as const;

export type CapacidadeErp = (typeof CAPACIDADES_ERP)[number];

export interface CapacidadeDoProvedorErp {
  id: CapacidadeErp;
  nivel: NivelDeAcessoErp;
  habilitada: boolean;
}

export interface ConexaoErpSegura {
  id: string;
  organization_id: string;
  provider: string;
  label: string;
  base_url: string;
  access_mode: NivelDeAcessoErp;
  enabled: boolean;
  auth_token_last4: string;
  user_last4: string;
  app_last4: string;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredenciaisVendaErp {
  baseUrl: string;
  authorizationToken: string;
  user: string;
  app: string;
}

/**
 * Projeções estáveis que o restante do Elus consome.
 *
 * Os nomes do VendaERP ficam confinados ao adapter do provider. O agente nunca
 * recebe o objeto cru do Swagger — em especial Pessoa, que também declara
 * campos de autenticação que não pertencem à conversa.
 */
export interface ProdutoErp {
  id: string | null;
  codigo: string | null;
  nome: string | null;
  preco: number | null;
  estoque: number | null;
  unidade: string | null;
  ean: string | null;
  marca: string | null;
  categoria: string | null;
}

export interface DepositoErp {
  id: string | null;
  nome: string | null;
  empresaId: string | null;
  empresa: string | null;
}

export interface EstoqueItemErp {
  codigo: string | null;
  estoqueAtual: number | null;
  saldoReservado: number | null;
}

export interface EstoqueErp {
  deposito: string;
  itens: EstoqueItemErp[];
}

export interface ClienteErp {
  id: string | null;
  nome: string | null;
  nomeFantasia: string | null;
  razaoSocial: string | null;
  cpfCnpj: string | null;
  email: string | null;
  telefone: string | null;
  celular: string | null;
  cidade: string | null;
  uf: string | null;
}

export interface PedidoErp {
  id: string | null;
  codigo: number | null;
  cliente: string | null;
  status: string | null;
  statusSistema: string | null;
  total: number | null;
  data: string | null;
  finalizado: boolean | null;
  numeroNFe: string | null;
  dataFaturamento: string | null;
  chaveAcessoNFe: string | null;
  danfeUrl: string | null;
  urlSefaz: string | null;
}

export interface NotaErp {
  numero: string;
  pedidoCodigo: number | null;
  statusDoPedido: string | null;
  dataFaturamento: string | null;
  chave: string | null;
  danfeUrl: string | null;
  urlSefaz: string | null;
}
