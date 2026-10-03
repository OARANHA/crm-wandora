import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  provarPedidoDoContato,
  type ProvaPedidoDoContato,
} from "@/lib/integracoes-erp/autoridade-documento";
import {
  ErroDanfeExterno,
  materializarDanfeExterno,
  type DanfeMaterializado,
} from "@/lib/integracoes-erp/danfe";
import {
  buscarPedidosErpComIdentidadeInterna,
  obterNotaErp,
  type ConsultaErpResultado,
  type PedidoErpComIdentidadeInterna,
} from "@/lib/integracoes-erp/service";
import type { NotaErp } from "@/lib/integracoes-erp/tipos";

const PREVIEW_TTL_SECONDS = 600;
const BUCKET = "whatsapp-media";

type FalhaCanario = {
  ok: false;
  code:
    | "crm_read_failed"
    | "conversation_not_found"
    | "order_read_failed"
    | "order_not_found"
    | "order_ambiguous"
    | "identity_unverified"
    | "invoice_missing"
    | "nfe_read_failed"
    | "nfe_number_mismatch"
    | "danfe_unavailable"
    | "danfe_invalid"
    | "preview_upload_failed"
    | "preview_sign_failed"
    | "preview_fetch_failed";
  detail?: string;
};

export type ResultadoCanarioDanfeReadonly =
  | {
      ok: true;
      pedido_codigo: number;
      nfe_numero: number;
      identity_evidence: string[];
      provider_calls: ["GET Pedidos/Pesquisar", "GET Pessoas/Pesquisar", "GET Fiscal/ConsultarNFE"];
      danfe: {
        mime: "application/pdf";
        size_bytes: number;
        pdf_signature: true;
      };
      preview: {
        ready: true;
        http_status: number;
        expires_seconds: number;
      };
      whatsapp_sent: false;
      vendaerp_writes: 0;
    }
  | FalhaCanario;

export interface DependenciasCanarioDanfe {
  buscarPedidos: typeof buscarPedidosErpComIdentidadeInterna;
  provarPedido: typeof provarPedidoDoContato;
  obterNota: typeof obterNotaErp;
  materializarDanfe: (url: string) => Promise<DanfeMaterializado>;
  fetchPreview: (url: string) => Promise<Response>;
  uuid: () => string;
}

const dependenciasPadrao: DependenciasCanarioDanfe = {
  buscarPedidos: buscarPedidosErpComIdentidadeInterna,
  provarPedido: provarPedidoDoContato,
  obterNota: obterNotaErp,
  materializarDanfe: materializarDanfeExterno,
  fetchPreview: (url) => fetch(url, { method: "GET", redirect: "manual" }),
  uuid: randomUUID,
};

function falha(code: FalhaCanario["code"], detail?: string): FalhaCanario {
  return detail ? { ok: false, code, detail } : { ok: false, code };
}

function numeroNfeDoPedido(pedido: PedidoErpComIdentidadeInterna): number | null {
  const bruto = pedido.pedido.numeroNFe?.trim();
  if (!bruto || !/^\d+$/.test(bruto)) return null;
  const numero = Number(bruto);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

function detalheSeguroDaAutoridade(prova: Exclude<ProvaPedidoDoContato, { ok: true }>): string {
  return prova.motivo;
}

async function limparPreview(admin: SupabaseClient, path: string): Promise<void> {
  try {
    await admin.storage.from(BUCKET).remove([path]);
  } catch {
    // best-effort: a falha principal continua sendo a autoridade.
  }
}

export async function executarCanarioDanfeReadonly(
  admin: SupabaseClient,
  input: {
    conversationId: string;
    pedidoCodigo: number;
  },
  deps: DependenciasCanarioDanfe = dependenciasPadrao,
): Promise<ResultadoCanarioDanfeReadonly> {
  const conversa = await admin
    .from("conversations")
    .select("id, organization_id, contact_id")
    .eq("id", input.conversationId)
    .maybeSingle();

  if (conversa.error) return falha("crm_read_failed");
  if (!conversa.data) return falha("conversation_not_found");

  const row = conversa.data as {
    id: string;
    organization_id: string;
    contact_id: string;
  };

  let pedidos: ConsultaErpResultado<PedidoErpComIdentidadeInterna[]>;
  try {
    pedidos = await deps.buscarPedidos(admin, row.organization_id, {
      codigo: input.pedidoCodigo,
      pageSize: 20,
      skip: 0,
    });
  } catch {
    return falha("order_read_failed");
  }
  if (!pedidos.ok) return falha("order_read_failed", pedidos.motivo);

  const exatos = pedidos.dados.filter(({ pedido }) => pedido.codigo === input.pedidoCodigo);
  if (exatos.length === 0) return falha("order_not_found");
  if (exatos.length !== 1) return falha("order_ambiguous");

  const pedido = exatos[0]!;
  const prova = await deps.provarPedido(admin, row.organization_id, row.contact_id, pedido);
  if (!prova.ok) {
    return falha("identity_unverified", detalheSeguroDaAutoridade(prova));
  }

  const nfeNumero = numeroNfeDoPedido(pedido);
  if (!nfeNumero) return falha("invoice_missing");

  let notaResultado: ConsultaErpResultado<NotaErp>;
  try {
    notaResultado = await deps.obterNota(admin, row.organization_id, nfeNumero);
  } catch {
    return falha("nfe_read_failed");
  }
  if (!notaResultado.ok) return falha("nfe_read_failed", notaResultado.motivo);

  const nota = notaResultado.dados;
  if (nota.numero !== nfeNumero) return falha("nfe_number_mismatch");
  if (!nota.danfeUrl?.trim()) return falha("danfe_unavailable");

  let documento: DanfeMaterializado;
  try {
    documento = await deps.materializarDanfe(nota.danfeUrl);
  } catch (erro) {
    if (erro instanceof ErroDanfeExterno) return falha("danfe_invalid", erro.codigo);
    return falha("danfe_invalid");
  }

  if (documento.mime !== "application/pdf") {
    return falha("danfe_invalid", "not_pdf");
  }

  const storagePath = `${row.organization_id}/${row.id}/canary-danfe-${nfeNumero}-${deps.uuid()}.pdf`;
  const bucket = admin.storage.from(BUCKET);
  const upload = await bucket.upload(storagePath, documento.buffer, {
    contentType: documento.mime,
    upsert: false,
  });
  if (upload.error) return falha("preview_upload_failed");

  const signed = await bucket.createSignedUrl(storagePath, PREVIEW_TTL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    await limparPreview(admin, storagePath);
    return falha("preview_sign_failed");
  }

  let preview: Response;
  try {
    preview = await deps.fetchPreview(signed.data.signedUrl);
  } catch {
    await limparPreview(admin, storagePath);
    return falha("preview_fetch_failed");
  }
  if (!preview.ok || (preview.status >= 300 && preview.status < 400)) {
    await limparPreview(admin, storagePath);
    return falha("preview_fetch_failed", String(preview.status));
  }

  return {
    ok: true,
    pedido_codigo: input.pedidoCodigo,
    nfe_numero: nfeNumero,
    identity_evidence: prova.evidencias,
    provider_calls: ["GET Pedidos/Pesquisar", "GET Pessoas/Pesquisar", "GET Fiscal/ConsultarNFE"],
    danfe: {
      mime: "application/pdf",
      size_bytes: documento.sizeBytes,
      pdf_signature: true,
    },
    preview: {
      ready: true,
      http_status: preview.status,
      expires_seconds: PREVIEW_TTL_SECONDS,
    },
    whatsapp_sent: false,
    vendaerp_writes: 0,
  };
}
