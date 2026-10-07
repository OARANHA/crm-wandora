import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";

export type OrigemResolucaoClienteExterno =
  "exact_document" | "exact_email" | "exact_name" | "existing_contact" | "corrected";

export interface VinculoIdentidadeClienteExterno {
  id: string;
  organizationId: string;
  contactId: string;
  provider: string;
  externalId: string;
  externalLabel: string;
  externalLabelKey: string;
  providerLookupLabel: string;
  resolutionOrigin: OrigemResolucaoClienteExterno;
}
interface VinculoRow {
  id: string;
  organization_id: string;
  contact_id: string;
  provider: string;
  external_id: string;
  external_label: string;
  external_label_key: string;
  provider_lookup_label: string;
  resolution_origin: OrigemResolucaoClienteExterno;
}
export interface AuditoriaVinculoCliente {
  actorUserId?: string | null;
  actorApiTokenId?: string | null;
  requestId?: string | null;
}

export function normalizarChaveRotuloCliente(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
function mapear(row: VinculoRow): VinculoIdentidadeClienteExterno {
  return {
    id: row.id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    provider: row.provider,
    externalId: row.external_id,
    externalLabel: row.external_label,
    externalLabelKey: row.external_label_key,
    providerLookupLabel: row.provider_lookup_label,
    resolutionOrigin: row.resolution_origin,
  };
}
async function contatoElegivel(db: SupabaseClient, organizationId: string, contactId: string) {
  const { data, error } = await db
    .from("contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", contactId)
    .eq("is_anonymized", false)
    .is("is_merged_into", null)
    .maybeSingle();
  if (error) return { ok: false as const };
  return { ok: true as const, elegivel: Boolean(data) };
}

export async function carregarVinculoClienteExterno(
  db: SupabaseClient,
  input: { organizationId: string; contactId: string; provider: string },
): Promise<
  { ok: true; vinculo: VinculoIdentidadeClienteExterno | null } | { ok: false; motivo: "banco" }
> {
  const contato = await contatoElegivel(db, input.organizationId, input.contactId);
  if (!contato.ok) return { ok: false, motivo: "banco" };
  if (!contato.elegivel) return { ok: true, vinculo: null };
  const { data, error } = await db
    .from("erp_customer_identity_links")
    .select(
      "id, organization_id, contact_id, provider, external_id, external_label, external_label_key, provider_lookup_label, resolution_origin",
    )
    .eq("organization_id", input.organizationId)
    .eq("contact_id", input.contactId)
    .eq("provider", input.provider)
    .eq("external_entity_type", "customer")
    .eq("status", "active")
    .limit(2);
  if (error || (data ?? []).length > 1) return { ok: false, motivo: "banco" };
  return { ok: true, vinculo: data?.[0] ? mapear(data[0] as VinculoRow) : null };
}

export async function carregarVinculoClienteExternoPorIdExterno(
  db: SupabaseClient,
  input: { organizationId: string; provider: string; externalId: string },
): Promise<
  { ok: true; vinculo: VinculoIdentidadeClienteExterno | null } | { ok: false; motivo: "banco" }
> {
  const externalId = input.externalId.trim();
  if (!externalId) return { ok: true, vinculo: null };

  const { data, error } = await db
    .from("erp_customer_identity_links")
    .select(
      "id, organization_id, contact_id, provider, external_id, external_label, external_label_key, provider_lookup_label, resolution_origin",
    )
    .eq("organization_id", input.organizationId)
    .eq("provider", input.provider)
    .eq("external_entity_type", "customer")
    .eq("external_id", externalId)
    .eq("status", "active")
    .limit(2);
  if (error || (data ?? []).length > 1) return { ok: false, motivo: "banco" };
  if (!data?.[0]) return { ok: true, vinculo: null };

  const contato = await contatoElegivel(db, input.organizationId, data[0].contact_id);
  if (!contato.ok || !contato.elegivel) return { ok: false, motivo: "banco" };
  return { ok: true, vinculo: mapear(data[0] as VinculoRow) };
}

export async function buscarVinculosClientePorRotulo(
  db: SupabaseClient,
  input: { organizationId: string; provider: string; rotulo: string },
): Promise<
  { ok: true; vinculos: VinculoIdentidadeClienteExterno[] } | { ok: false; motivo: "banco" }
> {
  const key = normalizarChaveRotuloCliente(input.rotulo);
  if (!key) return { ok: true, vinculos: [] };
  const { data, error } = await db
    .from("erp_customer_identity_links")
    .select(
      "id, organization_id, contact_id, provider, external_id, external_label, external_label_key, provider_lookup_label, resolution_origin",
    )
    .eq("organization_id", input.organizationId)
    .eq("provider", input.provider)
    .eq("external_entity_type", "customer")
    .eq("external_label_key", key)
    .eq("status", "active")
    .limit(3);
  if (error) return { ok: false, motivo: "banco" };
  if (!data?.length) return { ok: true, vinculos: [] };
  const ids = [...new Set(data.map((row) => row.contact_id))];
  const { data: contatos, error: contatosError } = await db
    .from("contacts")
    .select("id")
    .eq("organization_id", input.organizationId)
    .in("id", ids)
    .eq("is_anonymized", false)
    .is("is_merged_into", null);
  if (contatosError) return { ok: false, motivo: "banco" };
  const elegiveis = new Set((contatos ?? []).map((row) => row.id));
  return {
    ok: true,
    vinculos: data.filter((r) => elegiveis.has(r.contact_id)).map((r) => mapear(r as VinculoRow)),
  };
}

export async function vincularIdentidadeClienteExterno(
  db: SupabaseClient,
  input: {
    organizationId: string;
    contactId?: string | null;
    provider: string;
    externalId: string;
    externalLabel: string;
    providerLookupLabel: string;
    resolutionOrigin: OrigemResolucaoClienteExterno;
    evidence?: Record<string, unknown>;
    auditoria?: AuditoriaVinculoCliente;
  },
): Promise<
  | {
      ok: true;
      vinculo: VinculoIdentidadeClienteExterno;
      createdLink: boolean;
      createdContact: boolean;
    }
  | { ok: false; motivo: "conflito" | "contato_invalido" | "banco" }
> {
  const { data, error } = await db.rpc("fn_integracoes_erp_vincular_cliente", {
    p_organization_id: input.organizationId,
    p_contact_id: input.contactId ?? null,
    p_provider: input.provider,
    p_external_id: input.externalId,
    p_external_label: input.externalLabel,
    p_external_label_key: normalizarChaveRotuloCliente(input.externalLabel),
    p_provider_lookup_label: input.providerLookupLabel,
    p_resolution_origin: input.resolutionOrigin,
    p_evidence: input.evidence ?? {},
  });
  if (error) {
    const msg = String(error.message ?? "");
    if (
      error.code === "23505" ||
      msg.includes("erp_customer_identity_conflict") ||
      msg.includes("erp_customer_contact_already_linked")
    )
      return { ok: false, motivo: "conflito" };
    if (msg.includes("erp_customer_contact_invalid"))
      return { ok: false, motivo: "contato_invalido" };
    return { ok: false, motivo: "banco" };
  }
  const retorno = data as {
    link_id?: string;
    contact_id?: string;
    created_link?: boolean;
    created_contact?: boolean;
  } | null;
  if (!retorno?.link_id || !retorno.contact_id) return { ok: false, motivo: "banco" };
  const lido = await carregarVinculoClienteExterno(db, {
    organizationId: input.organizationId,
    contactId: retorno.contact_id,
    provider: input.provider,
  });
  if (!lido.ok || !lido.vinculo || lido.vinculo.id !== retorno.link_id)
    return { ok: false, motivo: "banco" };
  if (retorno.created_link) {
    await audit({
      action: "integracao_erp.cliente_vinculado",
      actorUserId: input.auditoria?.actorUserId ?? null,
      actorApiTokenId: input.auditoria?.actorApiTokenId ?? null,
      organizationId: input.organizationId,
      resourceType: "erp_customer_identity_link",
      resourceId: retorno.link_id,
      requestId: input.auditoria?.requestId ?? null,
      metadata: {
        provider: input.provider,
        resolution_origin: input.resolutionOrigin,
        created_contact: Boolean(retorno.created_contact),
      },
    });
  }
  return {
    ok: true,
    vinculo: lido.vinculo,
    createdLink: Boolean(retorno.created_link),
    createdContact: Boolean(retorno.created_contact),
  };
}

export async function invalidarVinculoClienteExterno(
  db: SupabaseClient,
  input: {
    organizationId: string;
    linkId: string;
    reason: "correction" | "provider_invalidated" | "manual_unlink";
    auditoria?: AuditoriaVinculoCliente;
  },
): Promise<{ ok: true; invalidated: boolean } | { ok: false; motivo: "banco" }> {
  const { data, error } = await db.rpc("fn_integracoes_erp_invalidar_vinculo_cliente", {
    p_organization_id: input.organizationId,
    p_link_id: input.linkId,
    p_reason: input.reason,
  });
  if (error) return { ok: false, motivo: "banco" };
  const invalidated = Boolean((data as { invalidated?: boolean } | null)?.invalidated);
  if (invalidated) {
    await audit({
      action: "integracao_erp.cliente_vinculo_invalidado",
      actorUserId: input.auditoria?.actorUserId ?? null,
      actorApiTokenId: input.auditoria?.actorApiTokenId ?? null,
      organizationId: input.organizationId,
      resourceType: "erp_customer_identity_link",
      resourceId: input.linkId,
      requestId: input.auditoria?.requestId ?? null,
      metadata: { reason: input.reason },
    });
  }
  return { ok: true, invalidated };
}
