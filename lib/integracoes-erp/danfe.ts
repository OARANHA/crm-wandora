import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fetchParaDestinoDaOrganizacao } from "@/lib/automation/destinos-internos-autorizados";
import { MAX_MEDIA_BYTES, extFromMime } from "@/lib/messaging/media/types";
import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";

const DANFE_TIMEOUT_MS = 20_000;
const DANFE_RENDER_TIMEOUT_MS = 35_000;
const VENDAERP_DANFE_HOST = "app.vendaerp.com.br";
const VENDAERP_DANFE_PATH = "/v3/public/NFe/Danfe";

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

export type RenderizadorDanfeVendaErp = (url: string) => Promise<Buffer>;

export function ehUrlDanfePublicoVendaErp(urlBruta: string): boolean {
  try {
    const url = new URL(urlBruta);
    if (
      url.protocol !== "https:" ||
      url.hostname !== VENDAERP_DANFE_HOST ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== VENDAERP_DANFE_PATH
    ) {
      return false;
    }

    const permitidos = new Set(["print", "Cod", "t", "trib", "g"]);
    for (const chave of url.searchParams.keys()) {
      if (!permitidos.has(chave)) return false;
    }

    const cod = url.searchParams.get("Cod") ?? "";
    const geren = url.searchParams.get("g") ?? "";
    const token = url.searchParams.get("t");
    const print = url.searchParams.get("print");
    const trib = url.searchParams.get("trib");

    if (!/^[a-f0-9]{24}$/i.test(cod)) return false;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(geren)) {
      return false;
    }
    if (token !== null && !/^[a-f0-9]{16,128}$/i.test(token)) return false;
    if (print !== null && print !== "true" && print !== "false") return false;
    if (trib !== null && trib !== "true" && trib !== "false") return false;
    return true;
  } catch {
    return false;
  }
}

function executarChromium(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const binario = process.env.CHROMIUM_PATH?.trim() || "/usr/bin/chromium-browser";
    const filho = spawn(binario, args, {
      stdio: "ignore",
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "production",
        PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        HOME: "/tmp",
      },
    });
    let finalizado = false;
    const concluir = (erro?: Error) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timer);
      if (erro) reject(erro);
      else resolve();
    };
    const timer = setTimeout(() => {
      filho.kill("SIGKILL");
      concluir(new ErroDanfeExterno("timeout"));
    }, DANFE_RENDER_TIMEOUT_MS);
    filho.once("error", () => concluir(new ErroDanfeExterno("download_falhou")));
    filho.once("exit", (codigo) => {
      if (codigo === 0) concluir();
      else concluir(new ErroDanfeExterno("download_falhou"));
    });
  });
}

export const renderizarDanfePublicoVendaErp: RenderizadorDanfeVendaErp = async (url) => {
  if (!ehUrlDanfePublicoVendaErp(url)) {
    throw new ErroDanfeExterno("destino_inseguro");
  }

  const pasta = await mkdtemp(join(tmpdir(), "elus-danfe-vendaerp-"));
  const entrada = join(pasta, "entrada.html");
  const saida = join(pasta, "danfe.pdf");
  const destinoSerializado = JSON.stringify(url).replace(/</g, "\\u003c");

  try {
    await writeFile(
      entrada,
      `<!doctype html><meta charset="utf-8"><script>location.replace(${destinoSerializado})</script>`,
      { encoding: "utf8", mode: 0o600 },
    );

    await executarChromium([
      "--headless=new",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=12000",
      "--no-pdf-header-footer",
      `--print-to-pdf=${saida}`,
      `file://${entrada}`,
    ]);

    const buffer = await readFile(saida);
    if (!buffer.length) throw new ErroDanfeExterno("download_falhou");
    if (buffer.length > MAX_MEDIA_BYTES) throw new ErroDanfeExterno("arquivo_grande");
    if (!parecePdf(buffer)) throw new ErroDanfeExterno("tipo_nao_documento");
    return buffer;
  } catch (erro) {
    if (erro instanceof ErroDanfeExterno) throw erro;
    throw new ErroDanfeExterno("download_falhou");
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
};

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
  options?: {
    headers?: Record<string, string>;
    renderizadorVendaErp?: RenderizadorDanfeVendaErp;
  },
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

    if (
      mime === "text/html" &&
      ehUrlDanfePublicoVendaErp(url)
    ) {
      const renderizador = options?.renderizadorVendaErp ?? renderizarDanfePublicoVendaErp;
      const pdf = await renderizador(url);
      const validacaoPdf = validateOutboundMedia("application/pdf", pdf.length);
      if (!validacaoPdf.ok) {
        throw new ErroDanfeExterno(
          validacaoPdf.code === "payload_too_large" ? "arquivo_grande" : "tipo_nao_documento",
        );
      }
      if (!parecePdf(pdf) || validacaoPdf.kind !== "document") {
        throw new ErroDanfeExterno("tipo_nao_documento");
      }
      return {
        buffer: pdf,
        mime: "application/pdf",
        sizeBytes: pdf.length,
        extensao: "pdf",
      };
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
