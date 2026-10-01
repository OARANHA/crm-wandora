import type { SupabaseClient } from "@supabase/supabase-js";

import { motivoDaRecusaDeDestino } from "@/lib/automation/destinos-internos-autorizados";
import { logger } from "@/lib/logger";

import { carregarConexaoVendaErp, dadosCifradosVendaErp } from "./credenciais";
import type { ConexaoErpSegura, CredenciaisVendaErp } from "./tipos";
import { ErroVendaErp, testarConexaoVendaErp } from "./vendaerp";

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
  | { ok: true; conexao: ConexaoErpSegura }
  | { ok: false; motivo: string };

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
  | { ok: true; conexao: ConexaoErpSegura }
  | { ok: false; motivo: string; status?: number | null };

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
