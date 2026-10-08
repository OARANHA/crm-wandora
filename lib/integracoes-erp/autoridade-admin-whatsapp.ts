import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import type {
  EtapaRenderizacaoDocumento,
  EvidenciaPdfAoExpirar,
} from "@/lib/documentos/renderizar-url-pdf";
import { canonicalPhoneBR } from "@/lib/channels/phone-variants";

import { ErroDanfeExterno, materializarDanfeExterno } from "./danfe";
import { carregarConexaoVendaErp } from "./credenciais";
import { obterNotaErp } from "./service";
import { cabecalhosDanfeVendaErp } from "./vendaerp";

export const CAPACIDADE_ERP_ADMIN_READ = "erp.admin.read" as const;

const FERRAMENTAS_ERP_ADMIN = new Set([
  "crm_erp_search_customers",
  "crm_erp_search_orders",
  "crm_erp_get_invoice",
  "crm_erp_prepare_admin_danfe",
  "crm_erp_send_danfe_to_invoice_customer",
]);

export interface AutoridadeAdminWhatsapp {
  kind: "whatsapp_admin";
  organizationId: string;
  userId: string;
  contactId: string;
  capability: typeof CAPACIDADE_ERP_ADMIN_READ;
}

interface ContatoDaConversa {
  id: string;
  organization_id: string;
  phone_number: string | null;
  is_anonymized: boolean | null;
  is_merged_into: string | null;
}

interface VinculoAdminWhatsappRow {
  id: string;
  organization_id: string;
  user_id: string;
  phone_e164: string;
  capability: string;
  enabled: boolean;
}

interface MembershipRow {
  user_id: string;
  organization_id: string;
  role: string;
  revoked_at: string | null;
}

export interface VinculoAdminWhatsappSeguro {
  id: string;
  phone_number: string;
  capability: typeof CAPACIDADE_ERP_ADMIN_READ;
  enabled: boolean;
}

export type SalvarVinculoAdminWhatsappResultado =
  | { ok: true; vinculo: VinculoAdminWhatsappSeguro }
  | {
      ok: false;
      motivo: "telefone_invalido" | "membership_invalido" | "telefone_ja_vinculado" | "banco";
    };

export function normalizarTelefoneAdminWhatsapp(raw: string): string | null {
  const limpo = raw.trim();
  if (!limpo.startsWith("+")) return null;
  const canonico = canonicalPhoneBR(limpo);
  return /^\+[1-9][0-9]{7,14}$/.test(canonico) ? canonico : null;
}

export function ferramentaErpExigeAutoridadeAdminWhatsapp(nome: string): boolean {
  return FERRAMENTAS_ERP_ADMIN.has(nome);
}

export function filtrarFerramentasErpPorAutoridadeAdminWhatsapp(
  toolIds: readonly string[],
  autoridade: AutoridadeAdminWhatsapp | null,
): string[] {
  if (autoridade) return [...toolIds];
  return toolIds.filter((id) => !ferramentaErpExigeAutoridadeAdminWhatsapp(id));
}

export function decidirAutoridadeAdminWhatsapp(input: {
  organizationId: string;
  contact: ContatoDaConversa | null;
  binding: VinculoAdminWhatsappRow | null;
  membership: MembershipRow | null;
}): AutoridadeAdminWhatsapp | null {
  const { organizationId, contact, binding, membership } = input;
  if (
    !contact ||
    contact.organization_id !== organizationId ||
    contact.is_anonymized === true ||
    contact.is_merged_into !== null ||
    !contact.phone_number
  ) {
    return null;
  }

  const telefoneContato = normalizarTelefoneAdminWhatsapp(contact.phone_number);
  if (
    !telefoneContato ||
    !binding ||
    binding.organization_id !== organizationId ||
    !binding.enabled ||
    binding.capability !== CAPACIDADE_ERP_ADMIN_READ ||
    normalizarTelefoneAdminWhatsapp(binding.phone_e164) !== telefoneContato
  ) {
    return null;
  }

  if (
    !membership ||
    membership.organization_id !== organizationId ||
    membership.user_id !== binding.user_id ||
    membership.role !== "admin" ||
    membership.revoked_at !== null
  ) {
    return null;
  }

  return {
    kind: "whatsapp_admin",
    organizationId,
    userId: binding.user_id,
    contactId: contact.id,
    capability: CAPACIDADE_ERP_ADMIN_READ,
  };
}

export async function resolverAutoridadeAdminWhatsapp(
  db: SupabaseClient,
  organizationId: string,
  contactId: string,
): Promise<AutoridadeAdminWhatsapp | null> {
  const { data: contact, error: contactError } = await db
    .from("contacts")
    .select("id, organization_id, phone_number, is_anonymized, is_merged_into")
    .eq("organization_id", organizationId)
    .eq("id", contactId)
    .maybeSingle();
  if (contactError || !contact) return null;

  const telefone = normalizarTelefoneAdminWhatsapp(contact.phone_number ?? "");
  if (!telefone) return null;

  const { data: binding, error: bindingError } = await db
    .from("erp_admin_whatsapp_bindings")
    .select("id, organization_id, user_id, phone_e164, capability, enabled")
    .eq("organization_id", organizationId)
    .eq("phone_e164", telefone)
    .eq("enabled", true)
    .maybeSingle();
  if (bindingError || !binding) return null;

  const { data: membership, error: membershipError } = await db
    .from("user_organizations")
    .select("user_id, organization_id, role, revoked_at")
    .eq("organization_id", organizationId)
    .eq("user_id", binding.user_id)
    .maybeSingle();
  if (membershipError) return null;

  return decidirAutoridadeAdminWhatsapp({
    organizationId,
    contact: contact as ContatoDaConversa,
    binding: binding as VinculoAdminWhatsappRow,
    membership: (membership as MembershipRow | null) ?? null,
  });
}

function seguro(row: {
  id: string;
  phone_e164: string;
  capability: string;
  enabled: boolean;
}): VinculoAdminWhatsappSeguro {
  return {
    id: row.id,
    phone_number: row.phone_e164,
    capability: CAPACIDADE_ERP_ADMIN_READ,
    enabled: row.enabled,
  };
}

export async function obterVinculoAdminWhatsappDoUsuario(
  db: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<VinculoAdminWhatsappSeguro | null> {
  const { data, error } = await db
    .from("erp_admin_whatsapp_bindings")
    .select("id, phone_e164, capability, enabled")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data || data.capability !== CAPACIDADE_ERP_ADMIN_READ) return null;
  return seguro(data);
}

export async function salvarVinculoAdminWhatsappDoUsuario(
  db: SupabaseClient,
  organizationId: string,
  userId: string,
  rawPhone: string,
): Promise<SalvarVinculoAdminWhatsappResultado> {
  const telefone = normalizarTelefoneAdminWhatsapp(rawPhone);
  if (!telefone) return { ok: false, motivo: "telefone_invalido" };

  const { data: membership, error: membershipError } = await db
    .from("user_organizations")
    .select("role, revoked_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) return { ok: false, motivo: "banco" };
  if (!membership || membership.role !== "admin" || membership.revoked_at !== null) {
    return { ok: false, motivo: "membership_invalido" };
  }

  const { data, error } = await db
    .from("erp_admin_whatsapp_bindings")
    .upsert(
      {
        organization_id: organizationId,
        user_id: userId,
        phone_e164: telefone,
        capability: CAPACIDADE_ERP_ADMIN_READ,
        enabled: true,
        created_by: userId,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,user_id" },
    )
    .select("id, phone_e164, capability, enabled")
    .single();

  if (error) {
    if (error.code === "23505") return { ok: false, motivo: "telefone_ja_vinculado" };
    return { ok: false, motivo: "banco" };
  }
  return { ok: true, vinculo: seguro(data) };
}

export async function removerVinculoAdminWhatsappDoUsuario(
  db: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("erp_admin_whatsapp_bindings")
    .delete()
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) return null;
  return typeof data?.id === "string" ? data.id : null;
}

const ETAPAS_RENDERIZACAO_AUDITAVEIS = new Set<EtapaRenderizacaoDocumento>([
  "loopback_inicializacao",
  "chromium_antes_redirect",
  "chromium_apos_redirect",
  "pdf_leitura",
  "pdf_validacao",
]);

const EVIDENCIAS_PDF_AUDITAVEIS = new Set<EvidenciaPdfAoExpirar>([
  "arquivo_ausente",
  "arquivo_vazio",
  "sem_assinatura_pdf",
  "sem_marcador_final",
  "marcadores_pdf_presentes",
  "inspecao_indisponivel",
]);

const RECURSO_POR_TOOL: Record<string, string> = {
  crm_erp_search_customers: "erp_customer",
  crm_erp_search_orders: "erp_order",
  crm_erp_get_invoice: "erp_invoice",
  crm_erp_prepare_admin_danfe: "erp_danfe",
  crm_erp_send_danfe_to_invoice_customer: "erp_danfe_delivery",
};

export async function auditarConsultaAdminWhatsapp(input: {
  autoridade: AutoridadeAdminWhatsapp;
  toolName: string;
  requestId: string;
  success: boolean;
  motivo?: string | null;
  codigoTecnico?: string | null;
  statusHttp?: number | null;
  autenticacaoSameOrigin?: boolean | null;
  etapaRenderizacao?: EtapaRenderizacaoDocumento | null;
  evidenciaPdf?: EvidenciaPdfAoExpirar | null;
}): Promise<void> {
  if (!ferramentaErpExigeAutoridadeAdminWhatsapp(input.toolName)) return;
  const etapaAuditavel = input.etapaRenderizacao
    ? ETAPAS_RENDERIZACAO_AUDITAVEIS.has(input.etapaRenderizacao)
    : false;
  const evidenciaAuditavel = input.evidenciaPdf
    ? EVIDENCIAS_PDF_AUDITAVEIS.has(input.evidenciaPdf)
    : false;
  await audit({
    action: "integracao_erp.admin_consulta",
    actorUserId: input.autoridade.userId,
    organizationId: input.autoridade.organizationId,
    resourceType: RECURSO_POR_TOOL[input.toolName] ?? "erp_resource",
    requestId: input.requestId,
    metadata: {
      channel: "whatsapp",
      origem: "agent_inbound_turn",
      capability: input.autoridade.capability,
      tool: input.toolName,
      success: input.success,
      ...(input.motivo ? { motivo: input.motivo } : {}),
      ...(input.codigoTecnico ? { codigo_tecnico: input.codigoTecnico } : {}),
      ...(etapaAuditavel ? { etapa_renderizacao: input.etapaRenderizacao } : {}),
      ...(evidenciaAuditavel ? { evidencia_pdf_timeout: input.evidenciaPdf } : {}),
      ...(typeof input.statusHttp === "number" ? { status_http: input.statusHttp } : {}),
      ...(typeof input.autenticacaoSameOrigin === "boolean"
        ? { autenticacao_same_origin: input.autenticacaoSameOrigin }
        : {}),
    },
  });
}

export type PrepararDanfeAdminWhatsappResultado =
  | {
      ok: true;
      documento: {
        codigo_nfe: number;
        filename: string;
        media_mime: string;
        media_size_bytes: number;
        preview_url: string;
        preview_expires_seconds: 600;
        /** Referência interna para o sender canônico; nunca deve ser devolvida ao modelo. */
        storage_path: string;
      };
    }
  | {
      ok: false;
      motivo:
        | "erp_read_failed"
        | "danfe_indisponivel"
        | "danfe_inseguro"
        | "danfe_download_failed"
        | "storage_failed";
    };

/**
 * Prepara o DANFE da organização para a PRÓPRIA conversa administrativa.
 *
 * Não usa identidade do cliente e não chama nenhum write do VendaERP. A única
 * escrita é interna, no bucket privado whatsapp-media da conversa, para que a
 * URL externa do provider nunca precise ir ao modelo nem ao WhatsApp.
 */
export async function prepararDanfeAdminWhatsapp(
  db: SupabaseClient,
  autoridade: AutoridadeAdminWhatsapp,
  conversationId: string,
  codigoNfe: number,
  requestId: string,
): Promise<PrepararDanfeAdminWhatsappResultado> {
  const falhar = async (
    motivo: Exclude<PrepararDanfeAdminWhatsappResultado, { ok: true }>["motivo"],
    diagnostico?: {
      codigoTecnico?: string | null;
      statusHttp?: number | null;
      autenticacaoSameOrigin?: boolean | null;
      etapaRenderizacao?: EtapaRenderizacaoDocumento | null;
      evidenciaPdf?: EvidenciaPdfAoExpirar | null;
    },
  ): Promise<PrepararDanfeAdminWhatsappResultado> => {
    await auditarConsultaAdminWhatsapp({
      autoridade,
      toolName: "crm_erp_prepare_admin_danfe",
      requestId,
      success: false,
      motivo,
      ...(diagnostico?.codigoTecnico ? { codigoTecnico: diagnostico.codigoTecnico } : {}),
      ...(diagnostico?.etapaRenderizacao
        ? { etapaRenderizacao: diagnostico.etapaRenderizacao }
        : {}),
      ...(diagnostico?.evidenciaPdf ? { evidenciaPdf: diagnostico.evidenciaPdf } : {}),
      ...(typeof diagnostico?.statusHttp === "number"
        ? { statusHttp: diagnostico.statusHttp }
        : {}),
      ...(typeof diagnostico?.autenticacaoSameOrigin === "boolean"
        ? { autenticacaoSameOrigin: diagnostico.autenticacaoSameOrigin }
        : {}),
    });
    return { ok: false, motivo };
  };

  const notaResultado = await obterNotaErp(db, autoridade.organizationId, codigoNfe);
  if (!notaResultado.ok) return falhar("erp_read_failed");

  const nota = notaResultado.dados;
  if (!nota.danfeUrl?.trim()) return falhar("danfe_indisponivel");

  const leitura = await carregarConexaoVendaErp(db, autoridade.organizationId);
  if (!leitura.ok) return falhar("erp_read_failed");

  const headers = cabecalhosDanfeVendaErp(leitura.credenciais, nota.danfeUrl);

  let documento;
  try {
    documento = await materializarDanfeExterno(
      nota.danfeUrl,
      undefined,
      headers ? { headers } : undefined,
    );
  } catch (erro) {
    if (erro instanceof ErroDanfeExterno) {
      return falhar(
        erro.codigo === "destino_inseguro" ? "danfe_inseguro" : "danfe_download_failed",
        {
          codigoTecnico: erro.codigo,
          ...(erro.etapa ? { etapaRenderizacao: erro.etapa } : {}),
          ...(erro.evidenciaPdf ? { evidenciaPdf: erro.evidenciaPdf } : {}),
          ...(typeof erro.status === "number" ? { statusHttp: erro.status } : {}),
          autenticacaoSameOrigin: Boolean(headers),
        },
      );
    }
    return falhar("danfe_download_failed");
  }

  const filename = `danfe-admin-nfe-${codigoNfe}-${randomUUID()}.${documento.extensao}`;
  const storagePath = `${autoridade.organizationId}/${conversationId}/${filename}`;
  const bucket = db.storage.from("whatsapp-media");

  const { error: uploadError } = await bucket.upload(storagePath, documento.buffer, {
    contentType: documento.mime,
    upsert: false,
  });
  if (uploadError) return falhar("storage_failed");

  const { data: signed, error: signedError } = await bucket.createSignedUrl(storagePath, 600);
  if (signedError || !signed?.signedUrl) {
    await bucket.remove([storagePath]).catch(() => undefined);
    return falhar("storage_failed");
  }

  await auditarConsultaAdminWhatsapp({
    autoridade,
    toolName: "crm_erp_prepare_admin_danfe",
    requestId,
    success: true,
  });

  return {
    ok: true,
    documento: {
      codigo_nfe: codigoNfe,
      filename,
      media_mime: documento.mime,
      media_size_bytes: documento.sizeBytes,
      preview_url: signed.signedUrl,
      preview_expires_seconds: 600,
      storage_path: storagePath,
    },
  };
}
