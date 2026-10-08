import { lookup } from "node:dns/promises";

import { chromium, type Browser } from "playwright-core";

import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";

import {
  abrirRedirectLocalParaDocumento,
  ErroRenderizacaoDocumento,
  type EtapaRenderizacaoDocumento,
  type PoliticaRenderizacaoUrlPdf,
  type RenderizadorUrlPdf,
} from "./renderizar-url-pdf";
import {
  recursoPermitidoNoBrowserDeDocumento,
  selecionarIpPublicoFixadoParaBrowser,
} from "./egress-browser-pdf";

const LIMITE_TOTAL_MS = 28_000;
const LIMITE_ETAPA_MS = 8_000;

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

  // DNS: confirmar todos os IPs e piná-los no Chromium antes de qualquer
  // navegação para fechar a janela de DNS rebinding.
  let enderecos: string[];
  try {
    enderecos = (await lookup(origem.hostname, { all: true })).map((item) => item.address);
  } catch {
    throw new ErroRenderizacaoDocumento("destino_inseguro");
  }
  const ipv4 = selecionarIpPublicoFixadoParaBrowser(enderecos);
  if (!ipv4) throw new ErroRenderizacaoDocumento("destino_inseguro");

  const maxBytes = politica.maxBytes ?? MAX_MEDIA_BYTES;
  const limiteMs = Math.min(politica.timeoutMs ?? LIMITE_TOTAL_MS, LIMITE_TOTAL_MS);
  const deadline = Date.now() + limiteMs;
  const restante = () => {
    const ms = Math.min(LIMITE_ETAPA_MS, deadline - Date.now());
    if (ms <= 0) throw new ErroRenderizacaoDocumento("timeout");
    return ms;
  };

  let browser: Browser | null = null;
  let redirect: Awaited<ReturnType<typeof abrirRedirectLocalParaDocumento>> | null = null;
  let etapa: EtapaRenderizacaoDocumento = "loopback_inicializacao";
  try {
    redirect = await abrirRedirectLocalParaDocumento(url);
    etapa = "chromium_antes_redirect";

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

    const context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
      javaScriptEnabled: true,
      bypassCSP: false,
    });

    // Playwright intercepta requests antes do socket; nenhuma URL de rede
    // interna, segundo host ou POST pode ser consumida pelo Chrome.
    await context.route("**/*", async (route) => {
      const permitido = recursoPermitidoNoBrowserDeDocumento(
        route.request().url(),
        origem.origin,
        redirect!.url,
        route.request().method(),
      );
      if (!permitido) return route.abort("blockedbyclient");
      return route.continue();
    });

    // A API de routeWebSocket não depende do route HTTP e bloqueia egress
    // paralelo criado por JavaScript da SPA para destinos de rede internos.
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
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
    await page.waitForFunction(
      () => {
        const texto = document.body?.innerText ?? "";
        return texto.trim().length >= 80 && /DANFE|NOTA FISCAL|CHAVE DE ACESSO/i.test(texto);
      },
      undefined,
      { timeout: restante() },
    );

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: false,
      timeout: restante(),
    });
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
      throw new ErroRenderizacaoDocumento(erro.codigo, erro.etapa ?? etapa);
    }
    const timeout =
      erro instanceof Error && (erro.name === "TimeoutError" || Date.now() >= deadline);
    // Nunca repassar a mensagem original: Playwright inclui endereço visitado,
    // detalhes da navegação e argv (possível token na query).
    throw new ErroRenderizacaoDocumento(timeout ? "timeout" : "render_falhou", etapa);
  } finally {
    if (browser) {
      const instancia = browser;
      const killer = setTimeout(() => {
        try {
          instancia.process()?.kill("SIGKILL");
        } catch {
          // Encerramento defensivo, sem propagar erro de cleanup.
        }
      }, 2_000);
      try {
        await instancia.close();
      } catch {
        // Falha de teardown não mascara erro de renderização já classificado.
      } finally {
        clearTimeout(killer);
      }
    }
    await redirect?.fechar().catch(() => undefined);
  }
};
