import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { carregarConexaoVendaErp } from "./credenciais";
import { chaveFiscalComprovadaDaNota } from "./chave-fiscal-comprovada";
import { ErroDanfeExterno, materializarDanfeExterno } from "./danfe";
import { obterNotaErp } from "./service";
import { cabecalhosDanfeVendaErp } from "./vendaerp";

export type MaterializarDanfeNaConversaResultado =
  | {
      ok: true;
      documento: {
        storagePath: string;
        filename: string;
        mime: string;
        sizeBytes: number;
      };
    }
  | {
      ok: false;
      motivo:
        | "erp_read_failed"
        | "danfe_indisponivel"
        | "danfe_inseguro"
        | "danfe_download_failed"
        | "conversa_destino_invalida"
        | "storage_failed";
      codigoTecnico?: string;
      statusHttp?: number;
      autenticacaoSameOrigin?: boolean;
    };

/**
 * Materializa uma DANFE no namespace de uma conversa já resolvida.
 * A URL do provider morre aqui; só bytes validados chegam ao bucket privado.
 */
export async function materializarDanfeNaConversa(
  db: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    codigoNfe: number;
    filenamePrefix: string;
  },
): Promise<MaterializarDanfeNaConversaResultado> {
  const { data: conversa, error: conversaError } = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("id", input.conversationId)
    .maybeSingle();
  if (conversaError || !conversa) return { ok: false, motivo: "conversa_destino_invalida" };

  const notaResultado = await obterNotaErp(db, input.organizationId, input.codigoNfe);
  if (!notaResultado.ok) return { ok: false, motivo: "erp_read_failed" };
  const danfeUrl = notaResultado.dados.danfeUrl?.trim();
  if (!danfeUrl) return { ok: false, motivo: "danfe_indisponivel" };
  const chaveFiscalEsperada = chaveFiscalComprovadaDaNota(notaResultado.dados);
  if (!chaveFiscalEsperada) return { ok: false, motivo: "danfe_indisponivel" };

  const leitura = await carregarConexaoVendaErp(db, input.organizationId);
  if (!leitura.ok) return { ok: false, motivo: "erp_read_failed" };
  const headers = cabecalhosDanfeVendaErp(leitura.credenciais, danfeUrl);

  let documento;
  try {
    documento = await materializarDanfeExterno(danfeUrl, undefined, {
      ...(headers ? { headers } : {}),
      chaveFiscalEsperada,
    });
  } catch (erro) {
    if (erro instanceof ErroDanfeExterno) {
      return {
        ok: false,
        motivo: erro.codigo === "destino_inseguro" ? "danfe_inseguro" : "danfe_download_failed",
        codigoTecnico: erro.codigo,
        ...(typeof erro.status === "number" ? { statusHttp: erro.status } : {}),
        autenticacaoSameOrigin: Boolean(headers),
      };
    }
    return { ok: false, motivo: "danfe_download_failed" };
  }

  const filename = `${input.filenamePrefix}-${input.codigoNfe}-${randomUUID()}.${documento.extensao}`;
  const storagePath = `${input.organizationId}/${input.conversationId}/${filename}`;
  const { error: uploadError } = await db.storage
    .from("whatsapp-media")
    .upload(storagePath, documento.buffer, { contentType: documento.mime, upsert: false });
  if (uploadError) return { ok: false, motivo: "storage_failed" };

  return {
    ok: true,
    documento: {
      storagePath,
      filename,
      mime: documento.mime,
      sizeBytes: documento.sizeBytes,
    },
  };
}
