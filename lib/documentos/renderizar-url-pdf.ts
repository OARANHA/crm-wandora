import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";

const RENDER_TIMEOUT_MS = 35_000;

export type CodigoErroRenderizacaoDocumento =
  "destino_inseguro" | "timeout" | "render_falhou" | "arquivo_grande" | "tipo_nao_pdf";

export type EtapaRenderizacaoDocumento =
  | "loopback_inicializacao"
  | "chromium_antes_redirect"
  | "chromium_lancamento"
  | "chromium_contexto"
  | "chromium_politicas"
  | "chromium_pagina"
  | "chromium_navegacao"
  | "chromium_apos_redirect"
  | "chromium_validacao_conteudo"
  | "chromium_impressao_pdf"
  | "pdf_leitura"
  | "pdf_validacao";

/** Retrato dos bytes existentes em disco quando o Chromium expirou: não prova PDF correto. */
export type EvidenciaPdfAoExpirar =
  | "arquivo_ausente"
  | "arquivo_vazio"
  | "sem_assinatura_pdf"
  | "sem_marcador_final"
  | "marcadores_pdf_presentes"
  | "inspecao_indisponivel";

/** Apenas eventos de bloqueio vistos pelo interceptor HTTP, nunca URLs nem causa provada. */
export type EvidenciaEgressBrowserDocumento =
  | "nenhum_bloqueio_interceptado"
  | "metodo_nao_permitido"
  | "destino_fora_origem"
  | "ambas_classes_bloqueadas";

export class ErroRenderizacaoDocumento extends Error {
  constructor(
    public readonly codigo: CodigoErroRenderizacaoDocumento,
    public readonly etapa?: EtapaRenderizacaoDocumento,
    public readonly evidenciaPdf?: EvidenciaPdfAoExpirar,
    public readonly evidenciaEgress?: EvidenciaEgressBrowserDocumento,
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
  /** Chave fiscal comprovada, somente quando fornecida por leitura estruturada ERP. */
  chaveFiscalEsperada?: string;
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

/**
 * Apenas a primeira e última parte do arquivo TEMPORÁRIO desta execução.
 * Não extrai texto nem registra o conteúdo fiscal. A presença dos marcadores
 * NÃO atesta a validade semântica ou a integridade final da DANFE.
 */
export async function evidenciarPdfNoTimeout(caminho: string): Promise<EvidenciaPdfAoExpirar> {
  let arquivo: Awaited<ReturnType<typeof open>> | undefined;
  try {
    arquivo = await open(caminho, "r");
    const tamanho = (await arquivo.stat()).size;
    if (tamanho === 0) return "arquivo_vazio";

    const inicio = Buffer.alloc(Math.min(1024, tamanho));
    const fim = Buffer.alloc(Math.min(2048, tamanho));
    const primeiro = await arquivo.read(inicio, 0, inicio.length, 0);
    const ultimo = await arquivo.read(fim, 0, fim.length, tamanho - fim.length);
    if (!inicio.subarray(0, primeiro.bytesRead).includes(Buffer.from("%PDF-"))) {
      return "sem_assinatura_pdf";
    }
    if (!fim.subarray(0, ultimo.bytesRead).includes(Buffer.from("%%EOF"))) {
      return "sem_marcador_final";
    }
    return "marcadores_pdf_presentes";
  } catch (erro) {
    if (typeof erro === "object" && erro !== null && "code" in erro && erro.code === "ENOENT") {
      return "arquivo_ausente";
    }
    return "inspecao_indisponivel";
  } finally {
    await arquivo?.close().catch(() => undefined);
  }
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
      // Impede que sockets HTTP ainda ativos mantenham o bootstrap de 302
      // aberto depois do prazo de renderização (Node 22).
      servidor.closeAllConnections();
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

function executarChromium(args: string[], timeoutMs: number = RENDER_TIMEOUT_MS): Promise<void> {
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

    await executarChromium(
      argumentosChromiumParaPdfDestino(redirecionamento.url, saida),
      politica.timeoutMs ?? RENDER_TIMEOUT_MS,
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
      const evidenciaPdf =
        erro.codigo === "timeout" ? await evidenciarPdfNoTimeout(saida) : undefined;
      throw new ErroRenderizacaoDocumento(erro.codigo, erro.etapa ?? etapaSegura, evidenciaPdf);
    }
    throw new ErroRenderizacaoDocumento("render_falhou", etapaSegura);
  } finally {
    await redirecionamento?.fechar().catch(() => undefined);
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
};
