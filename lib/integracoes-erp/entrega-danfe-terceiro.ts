import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { parseServiceBoundary, type ServiceBoundary } from "@/lib/atendimento/fronteira";
import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import { hashCpf, normalizeCpf } from "@/lib/contacts/cpf";

import {
  conferirContatoComClienteErp,
  selecionarClienteDoPedido,
  type IdentidadeContatoParaDocumento,
} from "./autoridade-documento";
import {
  resolverAutoridadeAdminWhatsapp,
  type AutoridadeAdminWhatsapp,
} from "./autoridade-admin-whatsapp";
import { materializarDanfeNaConversa } from "./danfe-conversa";
import {
  buscarClientesErp,
  buscarPedidosErpComIdentidadeInterna,
  type PedidoErpComIdentidadeInterna,
} from "./service";
import type { ClienteErp } from "./tipos";

type Db = SupabaseClient;

export type MotivoResolucaoDestinoDanfe =
  | "nfe_sem_pedido"
  | "nfe_pedido_ambiguo"
  | "identidade_erp_insuficiente"
  | "cliente_erp_nao_encontrado"
  | "cliente_erp_ambiguo"
  | "erp_read_failed"
  | "contato_crm_nao_encontrado"
  | "contato_crm_ambiguo"
  | "identidade_inconsistente"
  | "conversa_destino_nao_encontrada"
  | "conversa_destino_ambigua"
  | "fronteira_destino_indisponivel"
  | "banco";

export interface DestinoDanfeResolvido {
  contactId: string;
  conversationId: string;
  channelSessionId: string;
  serviceBoundary: ServiceBoundary;
}

function emailNormalizado(valor: string | null | undefined): string | null {
  const v = valor?.trim().toLowerCase();
  return v || null;
}

function documentoNormalizado(valor: string | null | undefined): string | null {
  const v = normalizeCpf(valor ?? "");
  return v || null;
}

function notaDoPedidoEh(pedido: PedidoErpComIdentidadeInterna, codigoNfe: number): boolean {
  const bruto = pedido.pedido.numeroNFe?.trim();
  if (!bruto) return false;
  return bruto.replace(/^0+/, "") === String(codigoNfe).replace(/^0+/, "");
}

async function resolverClienteErp(
  db: Db,
  organizationId: string,
  pedido: PedidoErpComIdentidadeInterna,
): Promise<
  | { ok: true; cliente: ClienteErp }
  | { ok: false; motivo: MotivoResolucaoDestinoDanfe }
> {
  const cpfCnpj = pedido.identidadeCliente.cpfCnpj?.trim();
  const email = pedido.identidadeCliente.email?.trim();
  if (!cpfCnpj && !email) return { ok: false, motivo: "identidade_erp_insuficiente" };

  const resposta = await buscarClientesErp(db, organizationId, {
    ...(cpfCnpj ? { cpfcnpj: cpfCnpj } : { email }),
    pageSize: 20,
    skip: 0,
  });
  if (!resposta.ok) return { ok: false, motivo: "erp_read_failed" };

  const selecionado = selecionarClienteDoPedido(pedido, resposta.dados);
  return selecionado.ok
    ? { ok: true, cliente: selecionado.cliente }
    : { ok: false, motivo: selecionado.motivo };
}

/**
 * Descobre candidatos por identificadores canônicos que o CRM realmente persiste.
 * Telefone do ERP NÃO é usado sozinho como autoridade de descoberta.
 */
async function contatosCandidatos(
  db: Db,
  organizationId: string,
  cliente: ClienteErp,
): Promise<{ ok: true; contatos: IdentidadeContatoParaDocumento[] } | { ok: false }> {
  const achados = new Map<string, IdentidadeContatoParaDocumento>();
  const select = "id, phone_number, email_normalized, cpf_hash, is_anonymized";

  const doc = documentoNormalizado(cliente.cpfCnpj);
  if (doc?.length === 11) {
    const { data, error } = await db
      .from("contacts")
      .select(select)
      .eq("organization_id", organizationId)
      .eq("cpf_hash", hashCpf(doc))
      .eq("is_anonymized", false)
      .is("is_merged_into", null)
      .limit(3);
    if (error) return { ok: false };
    for (const row of data ?? []) achados.set(row.id, row as IdentidadeContatoParaDocumento);
  }

  const email = emailNormalizado(cliente.email);
  if (email) {
    const { data, error } = await db
      .from("contacts")
      .select(select)
      .eq("organization_id", organizationId)
      .eq("email_normalized", email)
      .eq("is_anonymized", false)
      .is("is_merged_into", null)
      .limit(3);
    if (error) return { ok: false };
    for (const row of data ?? []) achados.set(row.id, row as IdentidadeContatoParaDocumento);
  }

  // Telefone só descobre candidatos depois que a Pessoa ERP já foi provada pelo
  // pedido. A decisão final continua em conferirContatoComClienteErp, que exige
  // concordância de TODAS as evidências comparáveis.
  for (const bruto of [cliente.celular, cliente.telefone]) {
    if (!bruto?.trim()) continue;
    const digits = bruto.replace(/\D/g, "");
    const e164 = digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
    const variantes = phoneLookupVariants(e164);
    if (variantes.length === 0) continue;
    const { data, error } = await db
      .from("contacts")
      .select(select)
      .eq("organization_id", organizationId)
      .in("phone_number", variantes)
      .eq("is_anonymized", false)
      .is("is_merged_into", null)
      .limit(3);
    if (error) return { ok: false };
    for (const row of data ?? []) achados.set(row.id, row as IdentidadeContatoParaDocumento);
  }

  return { ok: true, contatos: [...achados.values()] };
}

export async function resolverDestinoDanfeDaNota(
  db: Db,
  organizationId: string,
  codigoNfe: number,
): Promise<
  | { ok: true; destino: DestinoDanfeResolvido }
  | { ok: false; motivo: MotivoResolucaoDestinoDanfe }
> {
  const pedidos = await buscarPedidosErpComIdentidadeInterna(db, organizationId, {
    numeroNFe: String(codigoNfe),
    pageSize: 20,
    skip: 0,
  });
  if (!pedidos.ok) return { ok: false, motivo: "erp_read_failed" };

  const exatos = pedidos.dados.filter((p) => notaDoPedidoEh(p, codigoNfe));
  if (exatos.length === 0) return { ok: false, motivo: "nfe_sem_pedido" };
  if (exatos.length > 1) return { ok: false, motivo: "nfe_pedido_ambiguo" };
  const pedido = exatos[0]!;

  const cliente = await resolverClienteErp(db, organizationId, pedido);
  if (!cliente.ok) return cliente;

  const candidatos = await contatosCandidatos(db, organizationId, cliente.cliente);
  if (!candidatos.ok) return { ok: false, motivo: "banco" };

  const confirmados = candidatos.contatos.filter(
    (contato) => conferirContatoComClienteErp(contato, cliente.cliente).ok,
  );
  if (confirmados.length === 0) {
    return {
      ok: false,
      motivo:
        candidatos.contatos.length > 0
          ? "identidade_inconsistente"
          : "contato_crm_nao_encontrado",
    };
  }
  if (confirmados.length > 1) return { ok: false, motivo: "contato_crm_ambiguo" };
  const contactId = confirmados[0]!.id;

  const { data: conversas, error: conversaError } = await db
    .from("conversations")
    .select("id, contact_id, channel_session_id, status, is_group")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("is_group", false)
    .not("status", "in", "(closed,resolved,archived)")
    .limit(3);
  if (conversaError) return { ok: false, motivo: "banco" };
  if (!conversas || conversas.length === 0) {
    return { ok: false, motivo: "conversa_destino_nao_encontrada" };
  }

  const sessionIds = [...new Set(conversas.map((c) => c.channel_session_id).filter(Boolean))];
  const { data: sessoes, error: sessaoError } = await db
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", organizationId)
    .in("id", sessionIds)
    .is("archived_at", null);
  if (sessaoError) return { ok: false, motivo: "banco" };

  const ativas = new Set((sessoes ?? []).map((s) => s.id));
  const elegiveis = conversas.filter((c) => ativas.has(c.channel_session_id));
  if (elegiveis.length === 0) return { ok: false, motivo: "conversa_destino_nao_encontrada" };
  if (elegiveis.length > 1) return { ok: false, motivo: "conversa_destino_ambigua" };
  const conversa = elegiveis[0]!;
  const channelSessionId = conversa.channel_session_id;
  if (typeof channelSessionId !== "string") {
    return { ok: false, motivo: "conversa_destino_nao_encontrada" };
  }

  const { data: boundaryRaw, error: boundaryError } = await db.rpc("fn_service_boundary", {
    p_org: organizationId,
    p_conversation: conversa.id,
  });
  if (boundaryError) return { ok: false, motivo: "banco" };
  const boundary = parseServiceBoundary(boundaryRaw);
  if (
    !boundary ||
    boundary.organization_id !== organizationId ||
    boundary.contact_id !== contactId ||
    boundary.conversation_id !== conversa.id
  ) {
    return { ok: false, motivo: "fronteira_destino_indisponivel" };
  }

  return {
    ok: true,
    destino: {
      contactId,
      conversationId: conversa.id,
      channelSessionId,
      serviceBoundary: boundary,
    },
  };
}

export type SolicitarEntregaDanfeResultado =
  | { ok: true; status: "queued" | "already_queued"; codigo_nfe: number }
  | {
      ok: false;
      motivo:
        | MotivoResolucaoDestinoDanfe
        | "autoridade_revogada"
        | "danfe_prepare_failed"
        | "queue_failed";
    };

async function auditarOrdem(input: {
  autoridade: AutoridadeAdminWhatsapp;
  originConversationId: string;
  destinationConversationId?: string;
  codigoNfe: number;
  success: boolean;
  motivo?: string;
}) {
  await audit({
    action: "integracao_erp.admin_entrega_danfe",
    actorUserId: input.autoridade.userId,
    organizationId: input.autoridade.organizationId,
    resourceType: "erp_danfe_delivery",
    metadata: {
      channel: "whatsapp",
      capability: input.autoridade.capability,
      origin_conversation_id: input.originConversationId,
      ...(input.destinationConversationId
        ? { destination_conversation_id: input.destinationConversationId }
        : {}),
      codigo_nfe: input.codigoNfe,
      success: input.success,
      ...(input.motivo ? { motivo: input.motivo } : {}),
    },
  });
}

export async function solicitarEntregaDanfeAoClienteDaNota(
  db: Db,
  input: {
    autoridade: AutoridadeAdminWhatsapp;
    originConversationId: string;
    originJobId: string;
    agentId: string;
    codigoNfe: number;
  },
): Promise<SolicitarEntregaDanfeResultado> {
  const atual = await resolverAutoridadeAdminWhatsapp(
    db,
    input.autoridade.organizationId,
    input.autoridade.contactId,
  );
  if (!atual || atual.userId !== input.autoridade.userId) {
    await auditarOrdem({ ...input, success: false, motivo: "autoridade_revogada" });
    return { ok: false, motivo: "autoridade_revogada" };
  }

  const chaveIntent = {
    origin_job_id: input.originJobId,
    operation: "erp_danfe_to_invoice_customer",
    codigo_nfe: input.codigoNfe,
  };
  const { data: existente } = await db
    .from("job_queue")
    .select("id")
    .eq("organization_id", input.autoridade.organizationId)
    .eq("kind", "governed_delivery")
    .contains("payload", chaveIntent)
    .limit(1)
    .maybeSingle();
  if (existente) {
    return { ok: true, status: "already_queued", codigo_nfe: input.codigoNfe };
  }

  const resolucao = await resolverDestinoDanfeDaNota(
    db,
    input.autoridade.organizationId,
    input.codigoNfe,
  );
  if (!resolucao.ok) {
    await auditarOrdem({ ...input, success: false, motivo: resolucao.motivo });
    return resolucao;
  }

  const preparado = await materializarDanfeNaConversa(db, {
    organizationId: input.autoridade.organizationId,
    conversationId: resolucao.destino.conversationId,
    codigoNfe: input.codigoNfe,
    filenamePrefix: "danfe-nfe",
  });
  if (!preparado.ok) {
    await auditarOrdem({ ...input, success: false, motivo: "danfe_prepare_failed" });
    return { ok: false, motivo: "danfe_prepare_failed" };
  }

  const payload = {
    ...chaveIntent,
    origin_conversation_id: input.originConversationId,
    actor_user_id: input.autoridade.userId,
    conversation_id: resolucao.destino.conversationId,
    expected_contact_id: resolucao.destino.contactId,
    expected_channel_session_id: resolucao.destino.channelSessionId,
    service_boundary: {
      organization_id: resolucao.destino.serviceBoundary.organization_id,
      contact_id: resolucao.destino.serviceBoundary.contact_id,
      conversation_id: resolucao.destino.serviceBoundary.conversation_id,
      service_revision: resolucao.destino.serviceBoundary.service_revision,
      demanda_id: resolucao.destino.serviceBoundary.demanda_id,
      demanda_revision: resolucao.destino.serviceBoundary.demanda_revision,
    },
    agent_id: input.agentId,
    body: `DANFE da NFe ${input.codigoNfe}.`,
    media: {
      storage_path: preparado.documento.storagePath,
      mime: preparado.documento.mime,
      kind: "document",
    },
  };

  const { error: queueError } = await db.from("job_queue").insert({
    organization_id: input.autoridade.organizationId,
    contact_id: resolucao.destino.contactId,
    kind: "governed_delivery",
    payload,
    priority: 90,
    max_attempts: 5,
  });

  if (queueError) {
    await db.storage
      .from("whatsapp-media")
      .remove([preparado.documento.storagePath])
      .catch(() => undefined);
    if (queueError.code === "23505") {
      return { ok: true, status: "already_queued", codigo_nfe: input.codigoNfe };
    }
    await auditarOrdem({
      ...input,
      destinationConversationId: resolucao.destino.conversationId,
      success: false,
      motivo: "queue_failed",
    });
    return { ok: false, motivo: "queue_failed" };
  }

  await auditarOrdem({
    ...input,
    destinationConversationId: resolucao.destino.conversationId,
    success: true,
  });
  return { ok: true, status: "queued", codigo_nfe: input.codigoNfe };
}
