import { fetchParaDestinoDaOrganizacao } from "@/lib/automation/destinos-internos-autorizados";
import { MAX_MEDIA_BYTES, extFromMime } from "@/lib/messaging/media/types";
import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";

const DANFE_TIMEOUT_MS = 20_000;

export type CodigoErroDanfeExterno =
  | "url_ausente"
  | "destino_inseguro"
  | "timeout"
  | "download_falhou"
  | "http_invalido"
  | "arquivo_grande"
  | "mime_ausente"
  | "tipo_nao_documento";

export class ErroDanfeExterno extends Error {
  constructor(
    public readonly codigo: CodigoErroDanfeExterno,
    public readonly status?: number,
  ) {
    super(codigo);
    this.name = "ErroDanfeExterno";
  }
}

export interface DanfeMaterializado {
  buffer: Buffer;
  mime: string;
  sizeBytes: number;
  extensao: string;
}

function mimeBase(valor: string | null): string | null {
  const mime = valor?.split(";")[0]?.trim().toLowerCase();
  return mime ? mime : null;
}

function parecePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from("%PDF-"));
}

async function lerCorpoComLimite(
  body: ReadableStream<Uint8Array> | null,
  limite: number = MAX_MEDIA_BYTES,
): Promise<Buffer> {
  if (!body) throw new ErroDanfeExterno("download_falhou");

  const reader = body.getReader();
  const partes: Buffer[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limite) {
        await reader.cancel("media_too_large").catch(() => undefined);
        throw new ErroDanfeExterno("arquivo_grande");
      }
      partes.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  if (total <= 0) throw new ErroDanfeExterno("download_falhou");
  return Buffer.concat(partes, total);
}

/**
 * Materializa a referência de DANFE sem entregar a URL ao gateway de mensageria.
 *
 * A URL veio de um provider configurado pela organização, então usa a mesma
 * régua de egress de organização do restante do produto: valida esquema/host,
 * resolve DNS e não segue redirect. O chamador pode fornecer headers de download
 * já restringidos ao mesmo origin do provider; este módulo nunca decide sozinho
 * para onde uma credencial pode sair.
 *
 * Não presume PDF. O MIME efetivo precisa pertencer à allowlist documental já
 * usada pelo upload outbound. A única correção conservadora é
 * application/octet-stream/sem Content-Type com assinatura real %PDF-, caso em
 * que os bytes provam application/pdf em vez de a extensão da URL "provar".
 */
export async function materializarDanfeExterno(
  urlBruta: string,
  fetcher: typeof fetch = fetchParaDestinoDaOrganizacao(),
  options?: { headers?: Record<string, string> },
): Promise<DanfeMaterializado> {
  const url = urlBruta.trim();
  if (!url) throw new ErroDanfeExterno("url_ausente");

  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new DOMException("DANFE fetch timeout", "TimeoutError")),
    DANFE_TIMEOUT_MS,
  );

  try {
    let resposta: Response;
    try {
      resposta = await fetcher(url, {
        method: "GET",
        signal: ctrl.signal,
        ...(options?.headers ? { headers: options.headers } : {}),
      });
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      if (mensagem.startsWith("unsafe_url:")) {
        throw new ErroDanfeExterno("destino_inseguro");
      }
      if (
        erro instanceof DOMException &&
        (erro.name === "TimeoutError" || erro.name === "AbortError")
      ) {
        throw new ErroDanfeExterno("timeout");
      }
      throw new ErroDanfeExterno("download_falhou");
    }

    if (!resposta.ok) {
      throw new ErroDanfeExterno(
        resposta.status >= 300 && resposta.status < 400 ? "destino_inseguro" : "http_invalido",
        resposta.status,
      );
    }

    const declarado = Number(resposta.headers.get("content-length") ?? 0);
    if (Number.isFinite(declarado) && declarado > MAX_MEDIA_BYTES) {
      throw new ErroDanfeExterno("arquivo_grande");
    }

    const buffer = await lerCorpoComLimite(resposta.body);
    let mime = mimeBase(resposta.headers.get("content-type"));

    if ((!mime || mime === "application/octet-stream") && parecePdf(buffer)) {
      mime = "application/pdf";
    }
    if (!mime) throw new ErroDanfeExterno("mime_ausente");

    if (mime === "application/pdf" && !parecePdf(buffer)) {
      throw new ErroDanfeExterno("tipo_nao_documento");
    }

    const validacao = validateOutboundMedia(mime, buffer.length);
    if (!validacao.ok) {
      throw new ErroDanfeExterno(
        validacao.code === "payload_too_large" ? "arquivo_grande" : "tipo_nao_documento",
      );
    }
    if (validacao.kind !== "document") {
      throw new ErroDanfeExterno("tipo_nao_documento");
    }

    return {
      buffer,
      mime,
      sizeBytes: buffer.length,
      extensao: extFromMime(mime),
    };
  } finally {
    clearTimeout(timer);
  }
}
