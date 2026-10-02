import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { seModuloErpDesligado } from "@/app/api/v1/integracoes-erp/_falha";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ErroDanfeExterno, materializarDanfeExterno } from "@/lib/integracoes-erp/danfe";
import { buscarPedidosErp, obterNotaErp } from "@/lib/integracoes-erp/service";
import type { NotaErp, PedidoErp } from "@/lib/integracoes-erp/tipos";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const pedidoQuerySchema = z.object({
  pedido: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

const prepararDanfeSchema = z.object({
  codigo_nfe: z.number().int().min(1).max(2_147_483_647),
});

function pedidoParaAtendimento(pedido: PedidoErp) {
  return {
    id: pedido.id,
    codigo: pedido.codigo,
    cliente: pedido.cliente,
    status: pedido.status,
    statusSistema: pedido.statusSistema,
    total: pedido.total,
    data: pedido.data,
    finalizado: pedido.finalizado,
    numeroNFe: pedido.numeroNFe,
    dataFaturamento: pedido.dataFaturamento,
    chaveAcessoNFe: pedido.chaveAcessoNFe,
    danfeDisponivel: Boolean(pedido.danfeUrl),
  };
}

function notaParaAtendimento(nota: NotaErp) {
  return {
    numero: nota.numero,
    codigoStatus: nota.codigoStatus,
    mensagemStatus: nota.mensagemStatus,
    chave: nota.chave,
    lote: nota.lote,
    danfeDisponivel: Boolean(nota.danfeUrl),
  };
}

function falhaDaConsulta(motivo: string, requestId: string): Response {
  if (motivo === "nao_encontrada" || motivo === "desativada") {
    return fail("erp_unavailable", "VendaERP não está configurado para esta organização.", 404, {
      requestId,
    });
  }
  if (motivo === "rate_limited") {
    return fail("rate_limited", "O VendaERP atingiu o limite da chave.", 429, { requestId });
  }
  if (motivo === "cifra_indisponivel" || motivo === "banco") {
    return fail("erp_unavailable", "Integração ERP indisponível.", 503, { requestId });
  }
  return fail("erp_read_failed", "Não foi possível consultar o VendaERP.", 422, { requestId });
}

function falhaDoDanfe(erro: ErroDanfeExterno, requestId: string): Response {
  if (erro.codigo === "arquivo_grande") {
    return fail("payload_too_large", "O documento do DANFE excede 50 MB.", 413, { requestId });
  }
  if (erro.codigo === "tipo_nao_documento" || erro.codigo === "mime_ausente") {
    return fail(
      "unsupported_media_type",
      "A referência de DANFE não devolveu um documento em formato suportado.",
      415,
      { requestId },
    );
  }
  if (erro.codigo === "destino_inseguro") {
    return fail(
      "erp_danfe_unsafe",
      "A referência de DANFE foi recusada pela política de destinos externos.",
      422,
      { requestId },
    );
  }
  return fail(
    "erp_danfe_unavailable",
    "Não foi possível obter o documento do DANFE com segurança.",
    erro.codigo === "timeout" ? 504 : 422,
    { requestId },
  );
}

async function conversaDaOrganizacao(
  organizationId: string,
  conversationId: string,
): Promise<{ id: string; contact_id: string } | null> {
  const { data, error } = await createAdminClient()
    .from("conversations")
    .select("id, contact_id")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !data) return null;
  return data as { id: string; contact_id: string };
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const desligado = await seModuloErpDesligado(requestId);
  if (desligado) return desligado;

  const authz = await requireRole("agent", { requestId, resource: "erp_conversation_context" });
  if (!authz.ok) return authz.response;

  const { id: conversationId } = await ctx.params;
  if (!(await conversaDaOrganizacao(authz.org.orgId, conversationId))) {
    return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  }

  const parsed = pedidoQuerySchema.safeParse({
    pedido: req.nextUrl.searchParams.get("pedido") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_failed", "Informe um código de pedido válido.", 422, { requestId });
  }

  const resultado = await buscarPedidosErp(createAdminClient(), authz.org.orgId, {
    codigo: parsed.data.pedido,
    pageSize: 20,
    skip: 0,
  });
  if (!resultado.ok) return falhaDaConsulta(resultado.motivo, requestId);

  return ok(
    {
      pedidos: resultado.dados.map(pedidoParaAtendimento),
      conversation_id: conversationId,
    },
    { requestId },
  );
}

/**
 * Só PREPARA o documento. O envio continua exclusivamente em POST /api/v1/messages.
 */
export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const desligado = await seModuloErpDesligado(requestId);
  if (desligado) return desligado;

  const authz = await requireRole("agent", { requestId, resource: "erp_conversation_context" });
  if (!authz.ok) return authz.response;

  const body = await req.json().catch(() => null);
  const parsed = prepararDanfeSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Informe um número de NFe/NFCe válido.", 422, { requestId });
  }

  const { id: conversationId } = await ctx.params;
  if (!(await conversaDaOrganizacao(authz.org.orgId, conversationId))) {
    return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  }

  const notaResultado = await obterNotaErp(
    createAdminClient(),
    authz.org.orgId,
    parsed.data.codigo_nfe,
  );
  if (!notaResultado.ok) return falhaDaConsulta(notaResultado.motivo, requestId);

  const nota = notaResultado.dados;
  if (!nota.danfeUrl?.trim()) {
    return fail(
      "erp_danfe_unavailable",
      "O VendaERP não informou uma referência de DANFE para esta nota.",
      422,
      { requestId },
    );
  }

  let documento;
  try {
    documento = await materializarDanfeExterno(nota.danfeUrl);
  } catch (erro) {
    if (erro instanceof ErroDanfeExterno) return falhaDoDanfe(erro, requestId);
    throw erro;
  }

  const nome = `danfe-nfe-${parsed.data.codigo_nfe}-${randomUUID()}.${documento.extensao}`;
  const storagePath = `${authz.org.orgId}/${conversationId}/${nome}`;
  const admin = createAdminClient();
  const bucket = admin.storage.from("whatsapp-media");

  const { error: uploadError } = await bucket.upload(storagePath, documento.buffer, {
    contentType: documento.mime,
    upsert: false,
  });
  if (uploadError) {
    return fail("internal_error", "Não foi possível preparar o documento para envio.", 500, {
      requestId,
    });
  }

  const { data: signed, error: signedError } = await bucket.createSignedUrl(storagePath, 600);
  if (signedError || !signed?.signedUrl) {
    try {
      await bucket.remove([storagePath]);
    } catch {
      // limpeza best-effort
    }
    return fail("internal_error", "Não foi possível preparar a visualização do documento.", 500, {
      requestId,
    });
  }

  await audit({
    action: "integracao_erp.danfe_preparada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "conversation",
    resourceId: conversationId,
    requestId,
    metadata: {
      provider: "vendaerp",
      codigo_nfe: parsed.data.codigo_nfe,
      media_mime: documento.mime,
      media_size_bytes: documento.sizeBytes,
    },
  });

  return ok(
    {
      nota: notaParaAtendimento(nota),
      documento: {
        storage_path: storagePath,
        media_mime: documento.mime,
        media_size_bytes: documento.sizeBytes,
        filename: nome,
        preview_url: signed.signedUrl,
        preview_expires_seconds: 600,
      },
    },
    { requestId },
  );
}
