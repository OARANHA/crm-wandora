import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EtapaRenderizacaoDocumento } from "@/lib/documentos/renderizar-url-pdf";

import {
  auditarConsultaAdminWhatsapp,
  resolverAutoridadeAdminWhatsapp,
} from "./autoridade-admin-whatsapp";
import { carregarConexaoVendaErp } from "./credenciais";
import { ErroDanfeExterno, materializarDanfeExterno, type DanfeMaterializado } from "./danfe";
import { obterNotaErp } from "./service";
import { cabecalhosDanfeVendaErp } from "./vendaerp";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ETAPAS = new Set([
  "loopback_inicializacao",
  "chromium_antes_redirect",
  "chromium_apos_redirect",
  "pdf_leitura",
  "pdf_validacao",
]);

export type FalhaCanarioAdmin =
  | "invalid_scope"
  | "crm_read_failed"
  | "conversation_not_found"
  | "admin_authority_denied"
  | "erp_read_denied"
  | "erp_read_failed"
  | "nfe_number_mismatch"
  | "danfe_unavailable"
  | "danfe_failed"
  | "audit_failed";

export type ResultadoCanarioDanfeAdmin =
  | {
      ok: true;
      pdf_valido: true;
      pdf_size_bytes: number;
      whatsapp_sent: false;
      vendaerp_writes: 0;
    }
  | {
      ok: false;
      code: FalhaCanarioAdmin;
      codigo_tecnico?: ErroDanfeExterno["codigo"];
      etapa_renderizacao?: EtapaRenderizacaoDocumento;
      whatsapp_sent: false;
      vendaerp_writes: 0;
    };

export interface DependenciasCanarioDanfeAdmin {
  resolverAutoridade: typeof resolverAutoridadeAdminWhatsapp;
  carregarConexao: typeof carregarConexaoVendaErp;
  obterNota: typeof obterNotaErp;
  renderizar: (url: string, headers: Record<string, string> | null) => Promise<DanfeMaterializado>;
  auditar: typeof auditarConsultaAdminWhatsapp;
  uuid: () => string;
}

const depsPadrao: DependenciasCanarioDanfeAdmin = {
  resolverAutoridade: resolverAutoridadeAdminWhatsapp,
  carregarConexao: carregarConexaoVendaErp,
  obterNota: obterNotaErp,
  renderizar: (url, headers) =>
    materializarDanfeExterno(url, undefined, headers ? { headers } : undefined),
  auditar: auditarConsultaAdminWhatsapp,
  uuid: randomUUID,
};

function falhar(code: FalhaCanarioAdmin): ResultadoCanarioDanfeAdmin {
  return { ok: false, code, whatsapp_sent: false, vendaerp_writes: 0 };
}

/**
 * Diagnóstico de renderização ADMIN, separado do canário CLIENTE.
 *
 * O UUID da conversa reidrata organization_id + contact_id do CRM. A autoridade
 * real é a mesma do WhatsApp da ISIS (contato → vínculo → membership → capability).
 * Não aceita organization_id, usuário ou role de argumentos externos.
 *
 * Faz somente leituras ERP via service canônico e executa exatamente o mesmo
 * materializador/allowlist do DANFE administrativo. Não persiste PDF, não gera
 * signed URL e nunca invoca sender. A chamada externa one-shot e seu receipt
 * pertencem ao Remote-Ops/Agent Mesh; este módulo não implementa retry.
 */
export async function executarCanarioDanfeAdmin(
  db: SupabaseClient,
  input: { conversationId: string; codigoNfe: number },
  deps: DependenciasCanarioDanfeAdmin = depsPadrao,
): Promise<ResultadoCanarioDanfeAdmin> {
  if (!UUID_RE.test(input.conversationId) ||
      !Number.isSafeInteger(input.codigoNfe) || input.codigoNfe < 1) {
    return falhar("invalid_scope");
  }

  let conversa;
  try {
    conversa = await db
      .from("conversations")
      .select("id, organization_id, contact_id")
      .eq("id", input.conversationId)
      .maybeSingle();
  } catch {
    return falhar("crm_read_failed");
  }
  if (conversa.error) return falhar("crm_read_failed");
  const row = conversa.data;
  if (!row?.organization_id || !row.contact_id) return falhar("conversation_not_found");

  let autoridade;
  try {
    autoridade = await deps.resolverAutoridade(db, row.organization_id, row.contact_id);
  } catch {
    return falhar("admin_authority_denied");
  }
  if (!autoridade ||
      autoridade.organizationId !== row.organization_id ||
      autoridade.contactId !== row.contact_id ||
      autoridade.capability !== "erp.admin.read") {
    return falhar("admin_authority_denied");
  }

  const requestId = deps.uuid();
  const registrar = async (
    success: boolean,
    motivo?: string,
    codigoTecnico?: ErroDanfeExterno["codigo"],
    etapaRenderizacao?: EtapaRenderizacaoDocumento,
  ): Promise<boolean> => {
    try {
      await deps.auditar({
        autoridade,
        toolName: "crm_erp_prepare_admin_danfe",
        requestId,
        success,
        origem: "canario_admin_readonly",
        ...(motivo ? { motivo } : {}),
        ...(codigoTecnico ? { codigoTecnico } : {}),
        ...(etapaRenderizacao && ETAPAS.has(etapaRenderizacao)
          ? { etapaRenderizacao }
          : {}),
      });
      return true;
    } catch {
      return false;
    }
  };

  // Gate read-only ANTES de qualquer chamada real ao provider.
  let conexao;
  try {
    conexao = await deps.carregarConexao(db, autoridade.organizationId);
  } catch {
    return (await registrar(false, "erp_read_failed")) ? falhar("erp_read_failed") : falhar("audit_failed");
  }
  if (!conexao.ok || conexao.conexao.access_mode !== "read") {
    const code = conexao.ok ? "erp_read_denied" : "erp_read_failed";
    return (await registrar(false, code)) ? falhar(code) : falhar("audit_failed");
  }

  // Não repetir chamadas ao VendaERP nem escolher nota por data/código de pedido.
  let nota;
  try {
    nota = await deps.obterNota(db, autoridade.organizationId, input.codigoNfe);
  } catch {
    return (await registrar(false, "erp_read_failed")) ? falhar("erp_read_failed") : falhar("audit_failed");
  }
  if (!nota.ok) {
    return (await registrar(false, "erp_read_failed")) ? falhar("erp_read_failed") : falhar("audit_failed");
  }
  if (nota.dados.numero !== input.codigoNfe) {
    return (await registrar(false, "nfe_number_mismatch")) ? falhar("nfe_number_mismatch") : falhar("audit_failed");
  }
  if (!nota.dados.danfeUrl?.trim()) {
    return (await registrar(false, "danfe_unavailable")) ? falhar("danfe_unavailable") : falhar("audit_failed");
  }

  try {
    const headers = cabecalhosDanfeVendaErp(conexao.credenciais, nota.dados.danfeUrl);
    const doc = await deps.renderizar(nota.dados.danfeUrl, headers);
    if (doc.mime !== "application/pdf" || doc.sizeBytes < 5 ||
        !doc.buffer.subarray(0, Math.min(doc.buffer.length, 1024)).includes(Buffer.from("%PDF-"))) {
      return (await registrar(false, "danfe_failed", "tipo_nao_documento"))
        ? { ...falhar("danfe_failed"), codigo_tecnico: "tipo_nao_documento" }
        : falhar("audit_failed");
    }
    if (!(await registrar(true))) return falhar("audit_failed");
    return {
      ok: true,
      pdf_valido: true,
      pdf_size_bytes: doc.sizeBytes,
      whatsapp_sent: false,
      vendaerp_writes: 0,
    };
  } catch (err) {
    const codigo = err instanceof ErroDanfeExterno ? err.codigo : "download_falhou";
    const etapa = err instanceof ErroDanfeExterno && err.etapa && ETAPAS.has(err.etapa)
      ? err.etapa
      : undefined;
    if (!(await registrar(false, "danfe_download_failed", codigo, etapa))) {
      return falhar("audit_failed");
    }
    return {
      ...falhar("danfe_failed"),
      codigo_tecnico: codigo,
      ...(etapa ? { etapa_renderizacao: etapa } : {}),
    };
  }
}
