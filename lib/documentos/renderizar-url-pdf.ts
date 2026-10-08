import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";

import {
  observarNavegacaoChromium,
  type DiagnosticoNavegacaoDocumento,
} from "./observar-navegacao-chromium";

const RENDER_TIMEOUT_MS = 35_000;

export type CodigoErroRenderizacaoDocumento =
  "destino_inseguro" | "timeout" | "render_falhou" | "arquivo_grande" | "tipo_nao_pdf";

export type EtapaRenderizacaoDocumento =
  | "loopback_inicializacao"
  | "chromium_antes_redirect"
  | "chromium_apos_redirect"
  | "pdf_leitura"
  | "pdf_validacao";

export class ErroRenderizacaoDocumento extends Error {
  constructor(
    public readonly codigo: CodigoErroRenderizacaoDocumento,
    public readonly etapa?: EtapaRenderizacaoDocumento,
    public readonly diagnosticoNavegacao?: DiagnosticoNavegacaoDocumento,
  ) {
    super(codigo);
    this.name = "ErroRenderizacaoDocumento";
  }
}

export interface PoliticaRenderizacaoUrlPdf {
  nome: string;
  permiteUrl: (url: string) => boolean;
  maxBytes?: number;
  timeoutMs?: number;
  /** Apenas telemetria enum via pipe privado; não modifica PDF/navegação. */
  observarNavegacao?: boolean;
}

export type RenderizadorUrlPdf = (
  url: string,
  politica: PoliticaRenderizacaoUrlPdf,
) => Promise<Buffer>;

export interface RedirectLocalDocumento {
  url: string;
  fechar: () => Promise<void>;
  houveRedirecionamento: () => boolean;
}

function parecePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from("%PDF-"));
}

export function argumentosChromiumParaPdfDestino(destino: string, saida: string): string[] {
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
    destino,
  ];
}

/**
 * Compatibilidade para callers/testes antigos que montavam um file:// local.
 * O renderer real não usa mais este salto por JavaScript.
 */
export function argumentosChromiumParaPdf(entrada: string, saida: string): string[] {
  return argumentosChromiumParaPdfDestino("file://" + entrada, saida);
}

/**
 * A URL autorizada pode carregar token provider-specific e não deve aparecer
 * em argv/process list. O Chromium recebe apenas um endpoint loopback com nonce
 * imprevisível; esse endpoint responde 302 para a URL autorizada em memória.
 *
 * O servidor escuta somente 127.0.0.1, não é exposto pela rede do container e
 * permanece aberto apenas durante a renderização.
 */
export async function abrirRedirectLocalParaDocumento(
  destino: string,
): Promise<RedirectLocalDocumento> {
  const nonce = randomUUID();
  const caminho = "/" + nonce;
  let redirecionou = false;
  const servidor = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== caminho) {
      res.statusCode = 404;
      res.setHeader("Cache-Control", "no-store");
      res.end();
      return;
    }

    redirecionou = true;
    res.statusCode = 302;
    res.setHeader("Location", destino);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.end();
  });

  const fechar = (): Promise<void> =>
    new Promise((resolve) => {
      if (!servidor.listening) {
        resolve();
        return;
      }
      servidor.close(() => resolve());
    });

  try {
    await new Promise<void>((resolve, reject) => {
      const falhar = (erro: Error) => reject(erro);
      servidor.once("error", falhar);
      servidor.listen(0, "127.0.0.1", () => {
        servidor.off("error", falhar);
        resolve();
      });
    });

    const endereco = servidor.address();
    if (!endereco || typeof endereco === "string") {
      await fechar();
      throw new ErroRenderizacaoDocumento("render_falhou");
    }

    servidor.unref();
    return {
      url: "http://127.0.0.1:" + endereco.port + caminho,
      fechar,
      houveRedirecionamento: () => redirecionou,
    };
  } catch (erro) {
    await fechar();
    if (erro instanceof ErroRenderizacaoDocumento) throw erro;
    throw new ErroRenderizacaoDocumento("render_falhou");
  }
}

function executarChromium(
  args: string[],
  timeoutMs: number = RENDER_TIMEOUT_MS,
  destinoObservado?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const binario = process.env.CHROMIUM_PATH?.trim() || "/usr/bin/chromium-browser";
    const filho = spawn(binario, args, {
      stdio: destinoObservado ? ["ignore", "ignore", "ignore", "pipe", "pipe"] : "ignore",
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "production",
        PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        HOME: "/tmp",
      },
    });

    // Os FDs 3/4 pertencem somente a este filho. Nenhuma porta de debug é aberta.
    // O observador lê somente status/etapas e nunca devolve a URL ou corpo.
    let observador: ReturnType<typeof observarNavegacaoChromium> | null = null;
    if (destinoObservado && filho.stdio[3] && filho.stdio[4]) {
      try {
        observador = observarNavegacaoChromium(
          filho.stdio[3] as import("node:stream").Writable,
          filho.stdio[4] as import("node:stream").Readable,
          destinoObservado,
        );
      } catch {
        // Telemetria best-effort: jamais falhar documento por diagnóstico.
      }
    }

    let finalizado = false;
    const concluir = (erro?: Error) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timer);
      const diagnostico = observador?.diagnostico();
      observador?.fechar();
      if (erro instanceof ErroRenderizacaoDocumento) {
        reject(new ErroRenderizacaoDocumento(erro.codigo, erro.etapa, diagnostico));
      } else if (erro) reject(erro);
      else resolve();
    };

    const timer = setTimeout(() => {
      filho.kill("SIGKILL");
      concluir(new ErroRenderizacaoDocumento("timeout"));
    }, timeoutMs);

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
 * linha de comando do Chromium: fica apenas na memória do redirect HTTP loopback,
 * que é removido assim que a renderização termina.
 */
export const renderizarUrlParaPdf: RenderizadorUrlPdf = async (url, politica) => {
  if (!politica.permiteUrl(url)) {
    throw new ErroRenderizacaoDocumento("destino_inseguro");
  }

  const limite = politica.maxBytes ?? MAX_MEDIA_BYTES;
  const pasta = await mkdtemp(join(tmpdir(), "elus-document-render-"));
  const saida = join(pasta, "documento.pdf");
  let redirecionamento: RedirectLocalDocumento | null = null;
  let etapa: EtapaRenderizacaoDocumento = "loopback_inicializacao";

  try {
    redirecionamento = await abrirRedirectLocalParaDocumento(url);
    etapa = "chromium_antes_redirect";

    const argumentos = argumentosChromiumParaPdfDestino(redirecionamento.url, saida);
    if (politica.observarNavegacao) {
      // Pipe CDP via FDs privados; nunca passa a URL externa no argv.
      // Chrome 136+ recusa depuração no perfil padrão. Um perfil exclusivo
      // elimina também qualquer disputa entre renderizações simultâneas.
      // O caminho temporário não contém URLs nem dados fiscais e é expurgado.
      argumentos.splice(
        argumentos.length - 1,
        0,
        "--remote-debugging-pipe",
        "--user-data-dir=" + join(pasta, "chromium-profile"),
      );
    }
    await executarChromium(
      argumentos,
      politica.timeoutMs ?? RENDER_TIMEOUT_MS,
      politica.observarNavegacao ? url : undefined,
    );

    etapa = "pdf_leitura";
    const buffer = await readFile(saida);
    etapa = "pdf_validacao";
    if (!buffer.length) throw new ErroRenderizacaoDocumento("render_falhou");
    if (buffer.length > limite) throw new ErroRenderizacaoDocumento("arquivo_grande");
    if (!parecePdf(buffer)) throw new ErroRenderizacaoDocumento("tipo_nao_pdf");
    return buffer;
  } catch (erro) {
    // Só a etapa atravessa as camadas: jamais registrar URL, argv, stderr ou token.
    const etapaSegura =
      etapa === "chromium_antes_redirect" && redirecionamento?.houveRedirecionamento()
        ? "chromium_apos_redirect"
        : etapa;
    if (erro instanceof ErroRenderizacaoDocumento) {
      throw new ErroRenderizacaoDocumento(
        erro.codigo,
        erro.etapa ?? etapaSegura,
        erro.diagnosticoNavegacao,
      );
    }
    throw new ErroRenderizacaoDocumento("render_falhou", etapaSegura);
  } finally {
    await redirecionamento?.fechar().catch(() => undefined);
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
};
