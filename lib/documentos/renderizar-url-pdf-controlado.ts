import { chromium, type Browser } from "playwright-core";

import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";

import {
  abrirRedirectLocalParaDocumento,
  ErroRenderizacaoDocumento,
  type EtapaRenderizacaoDocumento,
  type EvidenciaEgressBrowserDocumento,
  type PoliticaRenderizacaoUrlPdf,
  type RenderizadorUrlPdf,
} from "./renderizar-url-pdf";
import {
  recursoPermitidoNoBrowserDeDocumento,
  resolverIpPublicoFixadoParaBrowser,
} from "./egress-browser-pdf";

const LIMITE_TOTAL_MS = 28_000;
const LIMITE_ETAPA_MS = 8_000;

/**
 * Limite por operação, inclusive nas chamadas Playwright que não oferecem
 * timeout nativo (ex.: PDF, context.newPage e encerramento).
 * Promise.race limita a espera do chamador, mas NÃO encerra sozinho uma
 * operação pendente. O finally fecha o Browser pela API oficial.
 */
async function executarDentroDoPrazo<T>(executar: () => Promise<T>, prazoMs: number): Promise<T> {
  if (prazoMs <= 0 || !Number.isFinite(prazoMs)) {
    throw new ErroRenderizacaoDocumento("timeout");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      executar(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ErroRenderizacaoDocumento("timeout")), prazoMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** page.pdf() não aceita 'timeout' nas opções de Playwright-core 1.63. */
export async function imprimirPdfComPrazo(
  imprimir: () => Promise<Buffer>,
  prazoMs: number,
): Promise<Buffer> {
  return executarDentroDoPrazo(imprimir, prazoMs);
}

/**
 * Renderização controlada: reutiliza o Chromium e o bootstrap 302 efêmero
 * existentes; não cria fila, sender ou cliente ERP.
 *
 * A URL externa só é entregue ao browser em memória, nunca no argv, logs,
 * conteúdo de exceção ou WebSocket de depuração público (Playwright usa pipe).
 */
export const renderizarUrlParaPdfControlado: RenderizadorUrlPdf = async (
  url,
  politica: PoliticaRenderizacaoUrlPdf,
) => {
  if (!politica.permiteUrl(url)) {
    throw new ErroRenderizacaoDocumento("destino_inseguro");
  }

  const origem = new URL(url);
  // Este renderer só aceita HTTPS público, sem credenciais e sem porta explícita.
  if (
    origem.protocol !== "https:" ||
    origem.port !== "" ||
    origem.username !== "" ||
    origem.password !== "" ||
    !origem.hostname
  ) {
    throw new ErroRenderizacaoDocumento("destino_inseguro");
  }

  // O prazo total inclui o DNS: anteriormente o relógio só começava
  // DEPOIS da resolução, deixando o pedido travar sem deadline.
  const maxBytes = politica.maxBytes ?? MAX_MEDIA_BYTES;
  const limiteMs = Math.min(politica.timeoutMs ?? LIMITE_TOTAL_MS, LIMITE_TOTAL_MS);
  const deadline = Date.now() + limiteMs;
  const restante = () => {
    const ms = Math.min(LIMITE_ETAPA_MS, deadline - Date.now());
    if (ms <= 0) throw new ErroRenderizacaoDocumento("timeout");
    return ms;
  };

  // DNS: confirmar todos os IPs e piná-los no Chromium antes de navegar.
  // A consulta DNS subjacente pode terminar tardiamente, porém a resposta
  // atrasada jamais será usada depois de expirar o prazo.
  const ipv4 = await executarDentroDoPrazo(
    () => resolverIpPublicoFixadoParaBrowser(origem.hostname),
    Math.min(3_000, restante()),
  );
  if (!ipv4) throw new ErroRenderizacaoDocumento("destino_inseguro");

  // Identidade fiscal só pode vir da leitura estruturada ERP.
  if (
    politica.chaveFiscalEsperada !== undefined &&
    !/^\d{44}$/.test(politica.chaveFiscalEsperada)
  ) {
    throw new ErroRenderizacaoDocumento("render_falhou");
  }

  let browser: Browser | null = null;
  let redirect: Awaited<ReturnType<typeof abrirRedirectLocalParaDocumento>> | null = null;
  let etapa: EtapaRenderizacaoDocumento = "loopback_inicializacao";
  let metodoBloqueado = false;
  let destinoBloqueado = false;
  // Resumo finito de eventos interceptados; nao registra metodos, destinos ou URLs.
  const evidenciaEgress = (): EvidenciaEgressBrowserDocumento => {
    if (metodoBloqueado && destinoBloqueado) return "ambas_classes_bloqueadas";
    if (metodoBloqueado) return "metodo_nao_permitido";
    if (destinoBloqueado) return "destino_fora_origem";
    return "nenhum_bloqueio_interceptado";
  };
  try {
    redirect = await abrirRedirectLocalParaDocumento(url);
    etapa = "chromium_lancamento";

    // Não propagar process.env inteiro: contêiner tem tokens ERP e chaves privadas.
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH?.trim() || "/usr/bin/chromium-browser",
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--no-proxy-server",
        `--host-resolver-rules=MAP ${origem.hostname} ${ipv4}`,
      ],
      timeout: restante(),
      env: {
        HOME: "/tmp",
        XDG_CONFIG_HOME: "/tmp",
        XDG_CACHE_HOME: "/tmp",
        NODE_ENV: process.env.NODE_ENV ?? "production",
        PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      },
    });

    etapa = "chromium_contexto";
    const context = await executarDentroDoPrazo(
      () =>
        browser!.newContext({
          serviceWorkers: "block",
          acceptDownloads: false,
          javaScriptEnabled: true,
          bypassCSP: false,
        }),
      restante(),
    );

    etapa = "chromium_politicas";
    // WebRTC não atravessa context.route("**/*"). A DANFE não necessita
    // PeerConnection; desabilitar antes de executar qualquer script da SPA.
    await executarDentroDoPrazo(
      () =>
        context.addInitScript(() => {
          Object.defineProperty(window, "RTCPeerConnection", {
            value: undefined,
            configurable: false,
            writable: false,
          });
          Object.defineProperty(window, "webkitRTCPeerConnection", {
            value: undefined,
            configurable: false,
            writable: false,
          });
        }),
      restante(),
    );

    // Playwright intercepta requests antes do socket; nenhuma URL de rede
    // interna, segundo host ou POST pode ser consumida pelo Chrome.
    await executarDentroDoPrazo(
      () =>
        context.route("**/*", async (route) => {
          const requisicao = route.request();
          const metodo = requisicao.method();
          const permitido = recursoPermitidoNoBrowserDeDocumento(
            requisicao.url(),
            origem.origin,
            redirect!.url,
            metodo,
          );
          if (!permitido) {
            if (metodo !== "GET" && metodo !== "HEAD") metodoBloqueado = true;
            else destinoBloqueado = true;
            return route.abort("blockedbyclient");
          }
          return route.continue();
        }),
      restante(),
    );

    // A API de routeWebSocket não depende do route HTTP e bloqueia egress
    // paralelo criado por JavaScript da SPA para destinos de rede internos.
    await executarDentroDoPrazo(
      () => context.routeWebSocket("**/*", (socket) => socket.close()),
      restante(),
    );
    etapa = "chromium_pagina";
    const page = await executarDentroDoPrazo(() => context.newPage(), restante());
    etapa = "chromium_navegacao";
    const resposta = await page.goto(redirect.url, {
      waitUntil: "domcontentloaded",
      timeout: restante(),
    });
    etapa = "chromium_apos_redirect";

    if (
      !redirect.houveRedirecionamento() ||
      !resposta?.ok() ||
      new URL(page.url()).origin !== origem.origin
    ) {
      throw new ErroRenderizacaoDocumento("render_falhou");
    }

    // Não imprimir uma SPA vazia, "Carregando..." ou tela de autenticação.
    // A prontidão é medida no browser; nunca exportar texto fiscal para logs.
    etapa = "chromium_validacao_conteudo";
    await page.waitForFunction(
      (chaveEsperada) => {
        const texto = document.body?.innerText ?? "";
        const normalizado = texto
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toUpperCase();
        // Nota Fiscal isolada e a chave repetida por uma tela de erro nao
        // comprovam que a DANFE esta pronta para impressao.
        if (
          normalizado.trim().length < 80 ||
          !/\bDANFE\b/.test(normalizado) ||
          !/\bCHAVE\s+DE\s+ACESSO\b/.test(normalizado) ||
          /\b(?:DANFE|NOTA\s+FISCAL)\s+(?:INDISPONIVEL|NAO\s+ENCONTRAD[AO])\b/.test(normalizado) ||
          /\bERRO\s+AO\s+(?:CARREGAR|CONSULTAR)\b/.test(normalizado)
        ) {
          return false;
        }
        // Mesmo com marcadores de DANFE, exige a chave exata de 44 digitos
        // comprovada na leitura estruturada ERP antes de gerar o PDF.
        // Nenhum texto fiscal é devolvido ao Node, logs, auditoria ou modelo.
        return !chaveEsperada || texto.replace(/\D/g, "").includes(chaveEsperada);
      },
      politica.chaveFiscalEsperada ?? null,
      { timeout: restante() },
    );

    etapa = "chromium_impressao_pdf";
    const pdf = await imprimirPdfComPrazo(
      () =>
        page.pdf({
          format: "A4",
          printBackground: true,
          displayHeaderFooter: false,
        }),
      restante(),
    );
    etapa = "pdf_validacao";

    if (!pdf.length) throw new ErroRenderizacaoDocumento("render_falhou");
    if (pdf.length > maxBytes) throw new ErroRenderizacaoDocumento("arquivo_grande");
    if (
      !pdf.subarray(0, Math.min(pdf.length, 1024)).includes(Buffer.from("%PDF-")) ||
      !pdf.subarray(-2048).includes(Buffer.from("%%EOF"))
    ) {
      throw new ErroRenderizacaoDocumento("tipo_nao_pdf");
    }
    return pdf;
  } catch (erro) {
    if (erro instanceof ErroRenderizacaoDocumento) {
      const fase = erro.etapa ?? etapa;
      throw new ErroRenderizacaoDocumento(
        erro.codigo,
        fase,
        erro.evidenciaPdf,
        erro.codigo === "timeout" && fase === "chromium_validacao_conteudo"
          ? evidenciaEgress()
          : undefined,
      );
    }
    const timeout =
      erro instanceof Error && (erro.name === "TimeoutError" || Date.now() >= deadline);
    // Nunca repassar a mensagem original: Playwright inclui endereço visitado,
    // detalhes da navegação e argv (possível token na query).
    throw new ErroRenderizacaoDocumento(
      timeout ? "timeout" : "render_falhou",
      etapa,
      undefined,
      timeout && etapa === "chromium_validacao_conteudo" ? evidenciaEgress() : undefined,
    );
  } finally {
    if (browser) {
      try {
        // Limita a espera do chamador sem usar API privada de processo.
        // browser.close() continua em andamento caso o prazo expire; um
        // timeout aqui NÃO comprova que o subprocesso terminou.
        await executarDentroDoPrazo(() => browser!.close(), 2_000);
      } catch {
        // Cleanup best-effort; nunca expor logs/argumentos do navegador.
      }
    }
    if (redirect) {
      try {
        await executarDentroDoPrazo(() => redirect!.fechar(), 2_000);
      } catch {
        // Não manter o turno preso em conexões HTTP remanescentes.
      }
    }
  }
};
