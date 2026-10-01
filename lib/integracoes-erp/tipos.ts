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
