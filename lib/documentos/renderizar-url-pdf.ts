import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";

const RENDER_TIMEOUT_MS = 35_000;

export type CodigoErroRenderizacaoDocumento =
  "destino_inseguro" | "timeout" | "render_falhou" | "arquivo_grande" | "tipo_nao_pdf";

export class ErroRenderizacaoDocumento extends Error {
  constructor(public readonly codigo: CodigoErroRenderizacaoDocumento) {
    super(codigo);
    this.name = "ErroRenderizacaoDocumento";
  }
}

export interface PoliticaRenderizacaoUrlPdf {
  nome: string;
  permiteUrl: (url: string) => boolean;
  maxBytes?: number;
}

export type RenderizadorUrlPdf = (
  url: string,
  politica: PoliticaRenderizacaoUrlPdf,
) => Promise<Buffer>;

function parecePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from("%PDF-"));
}

export function argumentosChromiumParaPdf(entrada: string, saida: string): string[] {
  return [
    "--headless=new",
    // O runner do Elus já está isolado pelo container e não concede os
    // namespaces de usuário/PID que o sandbox do Chromium tenta criar.
    // Sem esta flag o processo aborta com EPERM antes de carregar qualquer URL.
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=12000",
    "--no-pdf-header-footer",
    "--print-to-pdf=" + saida,
    "file://" + entrada,
  ];
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
      concluir(new ErroRenderizacaoDocumento("timeout"));
    }, RENDER_TIMEOUT_MS);

    filho.once("error", () => concluir(new ErroRenderizacaoDocumento("render_falhou")));
    filho.once("exit", (codigo) => {
      if (codigo === 0) concluir();
      else concluir(new ErroRenderizacaoDocumento("render_falhou"));
    });
  });
}

/**
 * Capability interna de documento: renderiza uma URL previamente autorizada em PDF.
 *
 * Não é tool MCP e não recebe URL arbitrária do modelo. O chamador é obrigado a
 * fornecer uma política explícita de allowlist. A URL sensível também não vai na
 * linha de comando do Chromium: ela fica num HTML temporário local, apagado no
 * bloco de limpeza.
 */
export const renderizarUrlParaPdf: RenderizadorUrlPdf = async (url, politica) => {
  if (!politica.permiteUrl(url)) {
    throw new ErroRenderizacaoDocumento("destino_inseguro");
  }

  const limite = politica.maxBytes ?? MAX_MEDIA_BYTES;
  const pasta = await mkdtemp(join(tmpdir(), "elus-document-render-"));
  const entrada = join(pasta, "entrada.html");
  const saida = join(pasta, "documento.pdf");
  const destinoSerializado = JSON.stringify(url).replace(/</g, "\\u003c");

  try {
    await writeFile(
      entrada,
      '<!doctype html><meta charset="utf-8"><script>location.replace(' +
        destinoSerializado +
        ")</script>",
      { encoding: "utf8", mode: 0o600 },
    );

    await executarChromium(argumentosChromiumParaPdf(entrada, saida));

    const buffer = await readFile(saida);
    if (!buffer.length) throw new ErroRenderizacaoDocumento("render_falhou");
    if (buffer.length > limite) throw new ErroRenderizacaoDocumento("arquivo_grande");
    if (!parecePdf(buffer)) throw new ErroRenderizacaoDocumento("tipo_nao_pdf");
    return buffer;
  } catch (erro) {
    if (erro instanceof ErroRenderizacaoDocumento) throw erro;
    throw new ErroRenderizacaoDocumento("render_falhou");
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
};
