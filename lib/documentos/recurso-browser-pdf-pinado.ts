import { request as requisitarHttps } from "node:https";
import { checkServerIdentity } from "node:tls";
import { isIPv4 } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

import { ipEhEspecial } from "@/lib/automation/outbound-ip";

const MAX_RESPOSTA_BYTES = 8 * 1024 * 1024;
const MAX_POST_BYTES = 128 * 1024;

/**
 * Faz a requisição autorizada através do IP previamente validado, sem nova
 * resolução DNS e SEM seguir 3xx. O Chromium recebe os bytes por route.fulfill,
 * logo não cria sockets remotos nem segue redirects fora da nossa autorização.
 *
 * O método, host, path e query são previamente checados pela policy chamadora.
 * Não incluir URL, corpo ou headers sensíveis em erros ou logs.
 */
export async function buscarRecursoBrowserPdfPinado(args: {
  url: string;
  metodo: string;
  ip: string;
  headers: Record<string, string>;
  body: Buffer | null;
  prazoMs: number;
}): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const url = new URL(args.url);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !isIPv4(args.ip) ||
    ipEhEspecial(args.ip) ||
    !["GET", "HEAD", "POST", "OPTIONS"].includes(args.metodo) ||
    !Number.isFinite(args.prazoMs) ||
    args.prazoMs <= 0 ||
    args.prazoMs > 8_000 ||
    (args.body?.length ?? 0) > MAX_POST_BYTES ||
    (args.metodo !== "POST" && args.body?.length)
  ) {
    throw new Error("recurso_pdf_recusado");
  }

  // Não encaminhar cookie, Authorization, referrer com query fiscal ou headers
  // arbitrários produzidos pelo documento remoto.
  const headers: Record<string, string> = {
    Host: url.hostname,
    Accept: args.headers.accept || "*/*",
    "Accept-Encoding": "identity",
  };
  const tipo = args.headers["content-type"];
  if (tipo && tipo.length <= 120) headers["Content-Type"] = tipo;
  const origem = args.headers.origin;
  if (origem === "https://app.vendaerp.com.br") headers.Origin = origem;
  if (args.body?.length) headers["Content-Length"] = String(args.body.length);

  return new Promise((resolve, reject) => {
    const requisicao = requisitarHttps(
      {
        hostname: args.ip,
        port: 443,
        method: args.metodo,
        path: url.pathname + url.search,
        servername: url.hostname,
        checkServerIdentity: (_host, cert) => checkServerIdentity(url.hostname, cert),
        headers,
        timeout: args.prazoMs,
        agent: false,
      },
      (resposta) => {
        const status = resposta.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          resposta.destroy();
          reject(new Error("recurso_pdf_http_recusado"));
          return;
        }

        const partes: Buffer[] = [];
        let tamanho = 0;
        resposta.on("data", (chunk: Buffer) => {
          tamanho += chunk.length;
          if (tamanho > MAX_RESPOSTA_BYTES) {
            resposta.destroy(new Error("recurso_pdf_tamanho_recusado"));
          } else {
            partes.push(chunk);
          }
        });
        resposta.on("error", () => reject(new Error("recurso_pdf_falhou")));
        resposta.on("end", () => {
          try {
            const codificacao = String(resposta.headers["content-encoding"] ?? "identity").toLowerCase();
            const dados = Buffer.concat(partes, tamanho);
            const opcoes = { maxOutputLength: MAX_RESPOSTA_BYTES };
            const body =
              codificacao === "br"
                ? brotliDecompressSync(dados, opcoes)
                : codificacao === "gzip"
                  ? gunzipSync(dados, opcoes)
                  : codificacao === "deflate"
                    ? inflateSync(dados, opcoes)
                    : codificacao === "identity" || codificacao === ""
                      ? dados
                      : null;
            if (!body || body.length > MAX_RESPOSTA_BYTES)
              throw new Error("recurso_pdf_formato_recusado");

            // Resposta CORS/CSP preservada, sem cookies, redirects, URLs ou
            // cabeçalhos hop-by-hop. Content-Length será calculado pelo Playwright.
            const repassar = [
              "content-type",
              "access-control-allow-origin",
              "access-control-allow-methods",
              "access-control-allow-headers",
              "access-control-allow-credentials",
              "vary",
              "cache-control",
              "cross-origin-resource-policy",
              "content-security-policy",
            ];
            const saida: Record<string, string> = {};
            for (const nome of repassar) {
              const valor = resposta.headers[nome];
              if (typeof valor === "string") saida[nome] = valor;
            }
            resolve({ status, headers: saida, body });
          } catch {
            reject(new Error("recurso_pdf_validacao_falhou"));
          }
        });
      },
    );
    requisicao.on("timeout", () => requisicao.destroy(new Error("recurso_pdf_timeout")));
    requisicao.on("error", () => reject(new Error("recurso_pdf_falhou")));
    if (args.body?.length) requisicao.write(args.body);
    requisicao.end();
  });
}
