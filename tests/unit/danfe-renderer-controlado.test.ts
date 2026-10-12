import type * as BrowserEgress from "@/lib/documentos/egress-browser-pdf";
import type * as PdfExtractor from "@/lib/ai/rag/extractors/pdf";
import type * as RenderUrlPdf from "@/lib/documentos/renderizar-url-pdf";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolver: vi.fn(),
  launch: vi.fn(),
  redirect: vi.fn(),
  extractPdfText: vi.fn(),
  buscarPinado: vi.fn(),
}));

vi.mock("@/lib/documentos/egress-browser-pdf", async (importOriginal) => {
  const original = await importOriginal<typeof BrowserEgress>();
  return { ...original, resolverIpPublicoFixadoParaBrowser: mocks.resolver };
});
vi.mock("playwright-core", () => ({ chromium: { launch: mocks.launch } }));
vi.mock("@/lib/documentos/recurso-browser-pdf-pinado", () => ({
  buscarRecursoBrowserPdfPinado: mocks.buscarPinado,
}));
vi.mock("@/lib/ai/rag/extractors/pdf", async (importOriginal) => {
  const original = await importOriginal<typeof PdfExtractor>();
  return { ...original, extractPdfText: mocks.extractPdfText };
});
vi.mock("@/lib/documentos/renderizar-url-pdf", async (importOriginal) => {
  const original = await importOriginal<typeof RenderUrlPdf>();
  return { ...original, abrirRedirectLocalParaDocumento: mocks.redirect };
});

import { PdfExtractError } from "@/lib/ai/rag/extractors/pdf";
import { ErroRenderizacaoDocumento } from "@/lib/documentos/renderizar-url-pdf";
import {
  diagnosticarTextoPdfFiscal,
  renderizarUrlParaPdfControlado,
} from "@/lib/documentos/renderizar-url-pdf-controlado";

const danfe =
  "https://app.vendaerp.com.br/v3/public/NFe/Danfe?Cod=abcdef123456abcdef123456&g=12345678-1234-4123-8123-123456789abc";
const local = "http://127.0.0.1:42311/nonce-sintetico";

function ambientePdf() {
  const pdf = Buffer.from("%PDF-1.7\nPDF DE TESTE SINTETICO\n%%EOF\n");
  const page = {
    goto: vi.fn().mockResolvedValue({ ok: () => true }),
    url: vi.fn().mockReturnValue(danfe),
    waitForFunction: vi.fn().mockResolvedValue(true),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForResponse: vi.fn().mockResolvedValue({
      ok: () => true,
      finished: async () => null,
    }),
    evaluate: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(pdf),
    emulateMedia: vi.fn().mockResolvedValue(undefined),
  };
  const context = {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
    routeWebSocket: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
    process: vi.fn().mockReturnValue(null),
  };
  mocks.resolver.mockResolvedValue("8.8.8.8");
  mocks.launch.mockResolvedValue(browser);
  const fechar = vi.fn().mockResolvedValue(undefined);
  mocks.redirect.mockResolvedValue({
    url: local,
    fechar,
    houveRedirecionamento: () => true,
  });
  return { pdf, page, browser, context, fechar };
}

const policy = {
  nome: "erp.vendaerp.danfe_to_pdf",
  permiteUrl: (url: string) => url === danfe,
  maxBytes: 2_000_000,
  timeoutMs: 60_000,
};

describe("renderer controlado DANFE — fronteiras seguras", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractPdfText.mockResolvedValue(
      "DANFE CHAVE DE ACESSO 35261012345678000190550010649963971123456780 " +
        "PRODUTO TESTE ".repeat(12),
    );
  });

  it("imprime página após load sem avaliar DOM ou texto fiscal", async () => {
    const env = ambientePdf();
    env.page.waitForFunction.mockRejectedValue(new Error("conteúdo fiscal ausente"));
    mocks.extractPdfText.mockRejectedValue(new Error("nenhum texto extraído"));
    const result = await renderizarUrlParaPdfControlado(danfe, {
      ...policy,
      impressaoDireta: true,
      chaveFiscalEsperada: "35261012345678000190550010649963971123456780",
    });
    expect(result).toEqual(env.pdf);
    expect(env.page.waitForLoadState).toHaveBeenCalledWith("load", {
      timeout: expect.any(Number),
    });
    expect(env.page.emulateMedia).toHaveBeenCalledWith({ media: "screen" });
    expect(env.page.waitForFunction).not.toHaveBeenCalled();
    expect(mocks.extractPdfText).not.toHaveBeenCalled();
    expect(env.page.pdf).toHaveBeenCalledTimes(1);
    expect(env.browser.close).toHaveBeenCalledOnce();
    expect(env.fechar).toHaveBeenCalledOnce();
  });

  it("impressão direta aguarda a resposta pública e networkidle antes de imprimir", async () => {
    const env = ambientePdf();
    let resolverResposta!: (resposta: {
      ok: () => boolean;
      finished: () => Promise<null>;
    }) => void;
    env.page.waitForResponse.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolverResposta = resolve;
        }),
    );
    const pedido = renderizarUrlParaPdfControlado(danfe, {
      ...policy,
      impressaoDireta: true,
      aguardarRecursoDeMontagem: (url, metodo) =>
        url === "https://api.invalid/public" && metodo === "POST",
    });
    await vi.waitFor(() => expect(env.page.waitForResponse).toHaveBeenCalledOnce());
    const predicado = env.page.waitForResponse.mock.calls[0]?.[0];
    expect(predicado({
      url: () => "https://api.invalid/public",
      request: () => ({ method: () => "POST" }),
    })).toBe(true);
    expect(predicado({
      url: () => "http://127.0.0.1/private",
      request: () => ({ method: () => "POST" }),
    })).toBe(false);
    expect(env.page.pdf).not.toHaveBeenCalled();
    resolverResposta({ ok: () => true, finished: async () => null });
    const pdf = await pedido;
    expect(pdf).toEqual(env.pdf);
    expect(env.page.waitForLoadState).toHaveBeenCalledWith("networkidle", {
      timeout: expect.any(Number),
    });
    expect(env.page.evaluate).toHaveBeenCalledOnce();
    expect(env.page.pdf).toHaveBeenCalledOnce();
    expect(mocks.extractPdfText).not.toHaveBeenCalled();
  });

  it("não imprime página sem resposta bem-sucedida da API pública", async () => {
    const env = ambientePdf();
    env.page.waitForResponse.mockResolvedValueOnce({
      ok: () => false,
      finished: async () => null,
    });
    await expect(
      renderizarUrlParaPdfControlado(danfe, {
        ...policy,
        impressaoDireta: true,
        aguardarRecursoDeMontagem: () => true,
      }),
    ).rejects.toMatchObject({ codigo: "render_falhou", etapa: "chromium_navegacao" });
    expect(env.page.pdf).not.toHaveBeenCalled();
    expect(env.browser.close).toHaveBeenCalledOnce();
    expect(env.fechar).toHaveBeenCalledOnce();
  });

  it("não imprime se a SPA não alcançar networkidle", async () => {
    const env = ambientePdf();
    env.page.waitForLoadState.mockRejectedValueOnce(
      Object.assign(new Error("rede ocupada"), { name: "TimeoutError" }),
    );
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, impressaoDireta: true }),
    ).rejects.toMatchObject({ codigo: "timeout", etapa: "chromium_navegacao" });
    expect(env.page.pdf).not.toHaveBeenCalled();
  });

  it("não imprime quando o carregamento load falha", async () => {
    const env = ambientePdf();
    env.page.waitForLoadState.mockRejectedValue(new Error("falha na carga"));
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, impressaoDireta: true }),
    ).rejects.toMatchObject({ codigo: "render_falhou", etapa: "chromium_navegacao" });
    expect(env.page.pdf).not.toHaveBeenCalled();
    expect(env.browser.close).toHaveBeenCalledOnce();
    expect(env.fechar).toHaveBeenCalledOnce();
  });

  it("não abre navegador nem resolve DNS se a policy recusa o endereço", async () => {
    await expect(
      renderizarUrlParaPdfControlado("https://privado.invalid/", policy),
    ).rejects.toMatchObject({ codigo: "destino_inseguro" });
    expect(mocks.resolver).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("barra DNS privado ou misto antes da primeira navegação", async () => {
    mocks.resolver.mockResolvedValue(null);
    await expect(renderizarUrlParaPdfControlado(danfe, policy)).rejects.toMatchObject({
      codigo: "destino_inseguro",
    });
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("usa Playwright sem URL fiscal nem segredos em argv/env e fecha browser + loopback", async () => {
    const env = ambientePdf();
    const anterior = process.env.CHAVE_ERP_TESTE;
    process.env.CHAVE_ERP_TESTE = "segredo-que-nao-pode-ser-passado";
    try {
      const resultado = await renderizarUrlParaPdfControlado(danfe, policy);
      expect(resultado).toEqual(env.pdf);
      const options = mocks.launch.mock.calls[0]?.[0];
      expect(options).toBeDefined();
      expect(JSON.stringify(options.args)).not.toContain(danfe);
      expect(JSON.stringify(options.env)).not.toContain("segredo-que-nao-pode-ser-passado");
      expect(options.env.HOME).toBe("/tmp");
      expect(options.args.some((x: string) => x.includes("MAP app.vendaerp.com.br 8.8.8.8"))).toBe(
        true,
      );
      expect(env.page.goto).toHaveBeenCalledWith(
        local,
        expect.objectContaining({
          waitUntil: "domcontentloaded",
        }),
      );
      expect(env.context.addInitScript).toHaveBeenCalledTimes(1);
      expect(env.context.routeWebSocket).toHaveBeenCalled();
      expect(env.browser.close).toHaveBeenCalledTimes(1);
      expect(env.fechar).toHaveBeenCalledTimes(1);
    } finally {
      if (anterior === undefined) delete process.env.CHAVE_ERP_TESTE;
      else process.env.CHAVE_ERP_TESTE = anterior;
    }
  });

  it("DANFE: bootstrap validado inicia navegação JS interceptável, sem 302 no Chromium", async () => {
    const env = ambientePdf();
    await renderizarUrlParaPdfControlado(danfe, {
      ...policy,
      recursosBrowser: { hostsAutorizados: [], permiteRecurso: () => false },
    });
    const handler = env.context.route.mock.calls[0]?.[1];
    const resposta = {
      status: () => 302,
      headers: () => ({ location: danfe }),
    };
    const fetch = vi.fn().mockResolvedValue(resposta);
    const fulfill = vi.fn().mockResolvedValue(undefined);
    const continuar = vi.fn();
    const abort = vi.fn();
    await handler({
      request: () => ({ url: () => local, method: () => "GET" }),
      fetch,
      fulfill,
      continue: continuar,
      abort,
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ maxRedirects: 0, timeout: expect.any(Number) }),
    );
    expect(fulfill).toHaveBeenCalledWith({
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
      body:
        '<!doctype html><meta charset="utf-8"><script>location.replace(' +
        JSON.stringify(danfe) +
        ")</script>",
    });
    expect(continuar).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it.each([
    { status: 200, location: danfe, consumido: true },
    { status: 302, location: "https://outro.invalid/", consumido: true },
    { status: 302, location: danfe, consumido: false },
  ])("recusa bootstrap inconsistente: %j", async ({ status, location, consumido }) => {
    const env = ambientePdf();
    mocks.redirect.mockResolvedValue({
      url: local,
      fechar: vi.fn(),
      houveRedirecionamento: () => consumido,
    });
    // O mock de navegação não dispara route; exercitar a guarda real abaixo.
    if (consumido) {
      await renderizarUrlParaPdfControlado(danfe, {
        ...policy,
        recursosBrowser: { hostsAutorizados: [], permiteRecurso: () => false },
      });
    } else {
      await expect(
        renderizarUrlParaPdfControlado(danfe, {
          ...policy,
          recursosBrowser: { hostsAutorizados: [], permiteRecurso: () => false },
        }),
      ).rejects.toMatchObject({ codigo: "render_falhou" });
    }
    const abort = vi.fn();
    const fulfill = vi.fn();
    await env.context.route.mock.calls[0]?.[1]({
      request: () => ({ url: () => local, method: () => "GET" }),
      fetch: vi.fn().mockResolvedValue({ status: () => status, headers: () => ({ location }) }),
      abort,
      fulfill,
    });
    expect(abort).toHaveBeenCalledWith("blockedbyclient");
    expect(fulfill).not.toHaveBeenCalled();
    expect(mocks.buscarPinado).not.toHaveBeenCalled();
  });

  it("escapa delimitadores HTML da URL no bootstrap JS", async () => {
    const env = ambientePdf();
    const destino = danfe + "&extra=</script><script>alert(1)</script>";
    await renderizarUrlParaPdfControlado(destino, {
      ...policy,
      permiteUrl: () => true,
      recursosBrowser: { hostsAutorizados: [], permiteRecurso: () => false },
    });
    const fulfill = vi.fn();
    await env.context.route.mock.calls[0]?.[1]({
      request: () => ({ url: () => local, method: () => "GET" }),
      fetch: vi
        .fn()
        .mockResolvedValue({ status: () => 302, headers: () => ({ location: destino }) }),
      abort: vi.fn(),
      fulfill,
    });
    const body = fulfill.mock.calls[0]?.[0].body;
    expect(body).toContain("\\u003c/script>");
    expect(body).not.toContain("</script><script>");
  });

  it("route intercepta e nega URL de intranet e POST mesmo depois do redirect", async () => {
    const env = ambientePdf();
    await renderizarUrlParaPdfControlado(danfe, policy);
    const handler = env.context.route.mock.calls[0]?.[1];
    expect(typeof handler).toBe("function");
    const abort = vi.fn();
    const next = vi.fn();
    await handler({
      request: () => ({ url: () => "http://169.254.169.254/latest", method: () => "GET" }),
      abort,
      continue: next,
    });
    expect(abort).toHaveBeenCalledWith("blockedbyclient");
    expect(next).not.toHaveBeenCalled();

    const abortPost = vi.fn();
    await handler({
      request: () => ({ url: () => "https://app.vendaerp.com.br/api", method: () => "POST" }),
      abort: abortPost,
      continue: vi.fn(),
    });
    expect(abortPost).toHaveBeenCalledWith("blockedbyclient");
  });

  it("não propaga erro com URL sensível quando a impressão falha", async () => {
    const env = ambientePdf();
    env.page.pdf.mockRejectedValueOnce(new Error("browser fatal em " + danfe));
    let falha: unknown;
    try {
      await renderizarUrlParaPdfControlado(danfe, policy);
    } catch (err) {
      falha = err;
    }
    expect(falha).toBeInstanceOf(ErroRenderizacaoDocumento);
    expect(falha).toMatchObject({
      codigo: "render_falhou",
      etapa: "chromium_impressao_pdf",
    });
    expect(String(falha)).not.toContain(danfe);
    expect(env.browser.close).toHaveBeenCalledTimes(1);
    expect(env.fechar).toHaveBeenCalledTimes(1);
  });

  it("encerra o navegador se page.pdf ficar pendente após o prazo", async () => {
    const env = ambientePdf();
    env.page.pdf.mockImplementationOnce(() => new Promise<Buffer>(() => undefined));
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, timeoutMs: 40 }),
    ).rejects.toMatchObject({ codigo: "timeout", etapa: "chromium_impressao_pdf" });
    expect(env.browser.close).toHaveBeenCalledTimes(1);
    expect(env.fechar).toHaveBeenCalledTimes(1);
  });

  it("exige a chave fiscal exata da NFe no DOM, não apenas a palavra Nota Fiscal", async () => {
    const env = ambientePdf();
    const chave = [
      "35",
      "2610",
      "12345678000190",
      "55",
      "001",
      "064996397",
      "1",
      "12345678",
      "0",
    ].join("");
    await renderizarUrlParaPdfControlado(danfe, {
      ...policy,
      chaveFiscalEsperada: chave,
    });
    const [predicado, argumento] = env.page.waitForFunction.mock.calls[0] ?? [];
    expect(argumento).toBe(chave);
    const checar = predicado as (esperada: string) => boolean;

    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      value: "Nota Fiscal indisponível para consulta. " + "erro ".repeat(40),
    });
    expect(checar(chave)).toBe(false);
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      value: "DANFE NOTA FISCAL CHAVE DE ACESSO " + "9".repeat(44) + " " + "teste ".repeat(20),
    });
    expect(checar(chave)).toBe(false);
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      value:
        "DANFE NOTA FISCAL CHAVE DE ACESSO " +
        chave.match(/.{1,4}/g)?.join(" ") +
        " " +
        "teste ".repeat(20),
    });
    expect(checar(chave)).toBe(true);
    // Uma página de erro pode ecoar a chave de acesso solicitada.
    // Não é DANFE renderizada, mesmo com 44 dígitos corretos e texto longo.
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      value:
        "Nota Fiscal indisponível para consulta. " +
        "Chave informada: " +
        chave +
        ". Este documento não pôde ser carregado. " +
        "Tente novamente. ".repeat(12),
    });
    expect(checar(chave)).toBe(false);
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      value:
        "DANFE não encontrada. CHAVE DE ACESSO: " +
        chave.match(/.{1,4}/g)?.join(" ") +
        ". Tente novamente. ".repeat(12),
    });
    expect(checar(chave)).toBe(false);
    Reflect.deleteProperty(document.body, "innerText");
  });

  it("imprime uma DANFE com chave comprovada quando o DOM não termina a espera", async () => {
    const env = ambientePdf();
    const chave = "35261012345678000190550010649963971123456780";
    env.page.waitForFunction.mockRejectedValueOnce(
      Object.assign(new Error("timeout de DOM"), { name: "TimeoutError" }),
    );
    const resultado = await renderizarUrlParaPdfControlado(danfe, {
      ...policy,
      chaveFiscalEsperada: chave,
    });
    expect(resultado).toEqual(env.pdf);
    expect(env.page.pdf).toHaveBeenCalledOnce();
    expect(mocks.extractPdfText).toHaveBeenCalledOnce();
    expect(env.browser.close).toHaveBeenCalledOnce();
    expect(env.fechar).toHaveBeenCalledOnce();
  });

  it("não envia como DANFE um PDF de erro que apenas ecoa a chave fiscal", async () => {
    const env = ambientePdf();
    const chave = "35261012345678000190550010649963971123456780";
    env.page.waitForFunction.mockRejectedValueOnce(
      Object.assign(new Error("timeout de DOM"), { name: "TimeoutError" }),
    );
    mocks.extractPdfText.mockResolvedValueOnce(
      "DANFE não encontrada. CHAVE DE ACESSO: " + chave + " " + "Tente novamente. ".repeat(15),
    );
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, chaveFiscalEsperada: chave }),
    ).rejects.toMatchObject({ codigo: "render_falhou", etapa: "pdf_validacao" });
    expect(env.browser.close).toHaveBeenCalledOnce();
    expect(env.fechar).toHaveBeenCalledOnce();
  });

  it("rejeita PDF com chave diferente mesmo se o DOM aprovado foi burlado", async () => {
    const env = ambientePdf();
    const chave = "35261012345678000190550010649963971123456780";
    mocks.extractPdfText.mockResolvedValueOnce(
      "DANFE CHAVE DE ACESSO " + "9".repeat(44) + " " + "PRODUTO TESTE ".repeat(12),
    );
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, chaveFiscalEsperada: chave }),
    ).rejects.toMatchObject({ codigo: "render_falhou", etapa: "pdf_validacao" });
    expect(env.page.pdf).toHaveBeenCalledOnce();
  });

  it("distingue falha de extrator da rejeição fiscal, sem copiar conteúdo sensível", async () => {
    const env = ambientePdf();
    const chave = "35261012345678000190550010649963971123456780";
    mocks.extractPdfText.mockRejectedValueOnce(new Error("segredo da empresa " + chave));
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, chaveFiscalEsperada: chave }),
    ).rejects.toMatchObject({
      codigo: "render_falhou",
      etapa: "pdf_validacao",
      evidenciaValidacaoPdf: "extracao_falhou",
    });
    expect(env.browser.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["sem_texto", "extracao_sem_texto_apos_screen_dom_confirmado"],
    ["timeout", "extracao_timeout"],
    ["memoria", "extracao_memoria"],
    ["processo", "extracao_processo_falhou"],
    ["dependencia", "extracao_dependencia"],
    ["motor", "extracao_falhou"],
  ] as const)(
    "audita causa finita do extrator %s sem revelar conteúdo fiscal",
    async (causa, evidencia) => {
      ambientePdf();
      const chave = "35261012345678000190550010649963971123456780";
      const erroSintetico = new PdfExtractError(
        "conteúdo confidencial " + chave,
        undefined,
        "falha",
        causa,
      );
      mocks.extractPdfText.mockRejectedValueOnce(erroSintetico);
      if (causa === "sem_texto") mocks.extractPdfText.mockRejectedValueOnce(erroSintetico);
      let falha: unknown;
      try {
        await renderizarUrlParaPdfControlado(danfe, { ...policy, chaveFiscalEsperada: chave });
      } catch (erro) {
        falha = erro;
      }
      expect(falha).toMatchObject({
        codigo: "render_falhou",
        etapa: "pdf_validacao",
        evidenciaValidacaoPdf: evidencia,
      });
      expect(String(falha)).not.toContain(chave);
    },
  );

  it("recupera PDF sem texto da CSS de impressão com media=screen e chave exata", async () => {
    const env = ambientePdf();
    const chave = "35261012345678000190550010649963971123456780";
    const erro = new PdfExtractError("somente imagem", undefined, "sem_texto", "sem_texto");
    mocks.extractPdfText.mockRejectedValueOnce(erro);
    mocks.extractPdfText.mockResolvedValueOnce(
      "DANFE CHAVE DE ACESSO " + chave + " " + "PRODUTO TESTE ".repeat(12),
    );

    const saida = await renderizarUrlParaPdfControlado(danfe, {
      ...policy,
      chaveFiscalEsperada: chave,
    });
    expect(saida).toEqual(env.pdf);
    expect(env.page.pdf).toHaveBeenCalledTimes(2);
    expect(env.page.emulateMedia).toHaveBeenCalledOnce();
    expect(env.page.emulateMedia).toHaveBeenCalledWith({ media: "screen" });
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(2);
    expect(env.browser.close).toHaveBeenCalledOnce();
    expect(env.fechar).toHaveBeenCalledOnce();
  });

  it("falha fechado se screen imprime PDF sem texto pela segunda vez", async () => {
    const env = ambientePdf();
    const chave = "35261012345678000190550010649963971123456780";
    mocks.extractPdfText.mockRejectedValue(
      new PdfExtractError("conteudo reservado", undefined, "sem_texto", "sem_texto"),
    );
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, chaveFiscalEsperada: chave }),
    ).rejects.toMatchObject({
      codigo: "render_falhou",
      etapa: "pdf_validacao",
      evidenciaValidacaoPdf: "extracao_sem_texto_apos_screen_dom_confirmado",
    });
    expect(env.page.pdf).toHaveBeenCalledTimes(2);
    expect(env.browser.close).toHaveBeenCalledOnce();
  });

  it("distingue DOM não confirmado após timeout sem registrar texto ou chave", async () => {
    const env = ambientePdf();
    const chave = "35261012345678000190550010649963971123456780";
    env.page.waitForFunction.mockRejectedValueOnce(
      Object.assign(new Error("timeout sintético com segredo " + chave), { name: "TimeoutError" }),
    );
    mocks.extractPdfText.mockRejectedValue(
      new PdfExtractError("sem texto", undefined, "sem_texto", "sem_texto"),
    );
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, chaveFiscalEsperada: chave }),
    ).rejects.toMatchObject({
      codigo: "render_falhou",
      etapa: "pdf_validacao",
      evidenciaValidacaoPdf: "extracao_sem_texto_apos_screen_dom_nao_confirmado",
      evidenciaEgress: "nenhum_bloqueio_interceptado",
    });
    expect(env.page.pdf).toHaveBeenCalledTimes(2);
  });

  it("audita categoria de método bloqueado após duas impressões sem texto", async () => {
    const env = ambientePdf();
    const chave = "35261012345678000190550010649963971123456780";
    env.context.route.mockImplementationOnce(async (_pattern, handler) => {
      const abort = vi.fn();
      await handler({
        request: () => ({ method: () => "POST", url: () => danfe }),
        abort,
        continue: vi.fn(),
      });
      expect(abort).toHaveBeenCalledWith("blockedbyclient");
    });
    mocks.extractPdfText.mockRejectedValue(
      new PdfExtractError("sem texto", undefined, "sem_texto", "sem_texto"),
    );
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, chaveFiscalEsperada: chave }),
    ).rejects.toMatchObject({
      evidenciaValidacaoPdf: "extracao_sem_texto_apos_screen_dom_confirmado",
      evidenciaEgress: "metodo_nao_permitido",
    });
    expect(env.context.route).toHaveBeenCalledTimes(1);
    expect(env.page.pdf).toHaveBeenCalledTimes(2);
  });

  it("nunca aceita outro documento no fallback mesmo com chave referenciada", async () => {
    const env = ambientePdf();
    const chave = "35261012345678000190550010649963971123456780";
    mocks.extractPdfText.mockRejectedValueOnce(
      new PdfExtractError("sem texto", undefined, "sem_texto", "sem_texto"),
    );
    mocks.extractPdfText.mockResolvedValueOnce(
      "DANFE CHAVE DE ACESSO " +
        "9".repeat(44) +
        " REFERENCIADA " +
        chave +
        " " +
        "PRODUTO TESTE ".repeat(12),
    );
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, chaveFiscalEsperada: chave }),
    ).rejects.toMatchObject({
      codigo: "render_falhou",
      evidenciaValidacaoPdf: "chave_divergente",
    });
    expect(env.page.pdf).toHaveBeenCalledTimes(2);
  });

  it("não reimprime em screen por timeout ou falha de memória", async () => {
    const env = ambientePdf();
    const chave = "35261012345678000190550010649963971123456780";
    mocks.extractPdfText.mockRejectedValueOnce(
      new PdfExtractError("heap reduzido", undefined, "falha", "memoria"),
    );
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, chaveFiscalEsperada: chave }),
    ).rejects.toMatchObject({ evidenciaValidacaoPdf: "extracao_memoria" });
    expect(env.page.pdf).toHaveBeenCalledOnce();
    expect(env.page.emulateMedia).not.toHaveBeenCalled();
  });

  it("classifica chave divergente e pagina de erro separadamente sem expor texto", () => {
    const chave = "35261012345678000190550010649963971123456780";
    const errado = "9".repeat(44);
    expect(
      diagnosticarTextoPdfFiscal(
        "DANFE CHAVE DE ACESSO " + errado + " " + "PRODUTO TESTE ".repeat(12),
        chave,
      ),
    ).toBe("chave_divergente");
    expect(
      diagnosticarTextoPdfFiscal(
        "DANFE não encontrada. CHAVE DE ACESSO " + chave + " " + "PRODUTO ".repeat(20),
        chave,
      ),
    ).toBe("pagina_de_erro");
  });

  it("tolera espaços tipográficos fragmentados no título fiscal mantendo chave exata", () => {
    const chave = "35261012345678000190550010649963971123456780";
    expect(
      diagnosticarTextoPdfFiscal(
        "D A N F E CHAVEDEACESSO " +
          chave.match(/.{1,4}/g)?.join(" ") +
          " " +
          "PRODUTO TESTE ".repeat(12),
        chave,
      ),
    ).toBeNull();
  });

  it("não aceita 44 dígitos montados ao concatenar trechos separados por palavras", () => {
    const chave = "35261012345678000190550010649963971123456780";
    const prefixo = chave.slice(0, 22);
    const sufixo = chave.slice(22);
    const texto = `DANFE CHAVE DE ACESSO ${prefixo} DADOS DO DESTINATARIO ${sufixo}`;
    const resultado = diagnosticarTextoPdfFiscal(texto + " PRODUTO TESTE ".repeat(12), chave);
    expect(resultado).toBe("chave_divergente");
  });

  it("aceita DANFE cuja chave principal aparece antes do rótulo na extração do PDF", () => {
    const chave = "35261012345678000190550010649963971123456780";
    const texto =
      "DANFE " +
      chave +
      " DADOS DO EMITENTE ".repeat(8) +
      " CHAVE DE ACESSO INFORMAÇÕES DA NOTA ".repeat(8);
    expect(diagnosticarTextoPdfFiscal(texto, chave)).toBeNull();
  });

  it("não confunde a chave de uma NFe referenciada com a chave principal", () => {
    const chave = "35261012345678000190550010649963971123456780";
    const texto =
      "DANFE " +
      " DADOS DO EMITENTE ".repeat(10) +
      " CHAVE DE ACESSO DOCUMENTOS FISCAIS REFERENCIADOS " +
      chave;
    expect(diagnosticarTextoPdfFiscal(texto, chave)).toBe("chave_divergente");
  });

  it("rejeita chave referenciada antes do rótulo da DANFE principal", () => {
    const chave = "35261012345678000190550010649963971123456780";
    const texto =
      "DANFE DOCUMENTOS FISCAIS REFERENCIADOS " +
      chave +
      " DADOS DO EMITENTE ".repeat(8) +
      " CHAVE DE ACESSO ";
    expect(diagnosticarTextoPdfFiscal(texto, chave)).toBe("chave_divergente");
  });

  it("rejeita principal divergente ainda que a chave esperada siga o rótulo", () => {
    const chave = "35261012345678000190550010649963971123456780";
    const texto =
      "DANFE " + "9".repeat(44) + " DADOS DA NOTA ".repeat(8) + " CHAVE DE ACESSO " + chave;
    expect(diagnosticarTextoPdfFiscal(texto, chave)).toBe("chave_divergente");
  });

  it("rejeita documento de outra NFe mesmo quando referencia a chave esperada", () => {
    const chave = "35261012345678000190550010649963971123456780";
    const cabecalho = `DANFE CHAVE DE ACESSO ${"9".repeat(44)}`;
    const referencias = ` DOCUMENTOS FISCAIS REFERENCIADOS ${chave}`;
    const texto = cabecalho + referencias + " PRODUTO TESTE ".repeat(12);
    expect(diagnosticarTextoPdfFiscal(texto, chave)).toBe("chave_divergente");
  });

  it("não aceita chave de 44 dígitos como prefixo de sequência maior", () => {
    const chave = "35261012345678000190550010649963971123456780";
    const texto = "DANFE CHAVE DE ACESSO " + chave + "1 " + "PRODUTO TESTE ".repeat(12);
    expect(diagnosticarTextoPdfFiscal(texto, chave)).toBe("chave_divergente");
  });

  it("permite chave correta agrupada por pontos e hífens junto ao rótulo", () => {
    const chave = "35261012345678000190550010649963971123456780";
    const grupos = chave.match(/.{1,4}/g) ?? [];
    const texto = `D A N F E CHAVE DE ACESSO: ${grupos.join(".")}`;
    expect(diagnosticarTextoPdfFiscal(texto + " PRODUTO TESTE ".repeat(12), chave)).toBeNull();
  });

  it("não imprime após timeout de DOM sem chave fiscal comprovada", async () => {
    const env = ambientePdf();
    env.page.waitForFunction.mockRejectedValueOnce(
      Object.assign(new Error("timeout de DOM"), { name: "TimeoutError" }),
    );
    await expect(renderizarUrlParaPdfControlado(danfe, policy)).rejects.toMatchObject({
      codigo: "timeout",
      etapa: "chromium_validacao_conteudo",
    });
    expect(env.page.pdf).not.toHaveBeenCalled();
    expect(mocks.extractPdfText).not.toHaveBeenCalled();
  });

  it("fecha o browser se a extração fiscal falha, sem expor dados do PDF", async () => {
    const env = ambientePdf();
    const chave = "35261012345678000190550010649963971123456780";
    mocks.extractPdfText.mockRejectedValueOnce(new Error("PDF confidencial " + chave));
    let erro: unknown;
    try {
      await renderizarUrlParaPdfControlado(danfe, { ...policy, chaveFiscalEsperada: chave });
    } catch (e) {
      erro = e;
    }
    expect(erro).toMatchObject({ codigo: "render_falhou", etapa: "pdf_validacao" });
    expect(String(erro)).not.toContain(chave);
    expect(env.browser.close).toHaveBeenCalledOnce();
    expect(env.fechar).toHaveBeenCalledOnce();
  });

  it("limita o DNS pendente sem iniciar navegador nem URL externa", async () => {
    mocks.resolver.mockImplementationOnce(() => new Promise<string | null>(() => undefined));
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, timeoutMs: 35 }),
    ).rejects.toMatchObject({ codigo: "timeout" });
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("distingue timeout de lançamento sem redirect", async () => {
    const env = ambientePdf();
    // O Playwright aplica o timeout nativamente em chromium.launch().
    // Uma Promise eternamente pendente no mock não reproduz esse contrato.
    const timeout = Object.assign(new Error("Timeout sintético no lançamento"), {
      name: "TimeoutError",
    });
    mocks.launch.mockRejectedValueOnce(timeout);
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, timeoutMs: 35 }),
    ).rejects.toMatchObject({ codigo: "timeout", etapa: "chromium_lancamento" });
    expect(env.fechar).toHaveBeenCalledTimes(1);
  });

  it("limita inicialização do contexto, fecha browser e bootstrap", async () => {
    const env = ambientePdf();
    env.browser.newContext.mockImplementationOnce(() => new Promise(() => undefined));
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, timeoutMs: 35 }),
    ).rejects.toMatchObject({ codigo: "timeout", etapa: "chromium_contexto" });
    expect(env.browser.close).toHaveBeenCalledTimes(1);
    expect(env.fechar).toHaveBeenCalledTimes(1);
  });

  it("distingue timeout na navegação antes do redirect", async () => {
    const env = ambientePdf();
    // page.goto({ timeout }) rejeita com TimeoutError; não pendura para sempre.
    const timeout = Object.assign(new Error("Timeout sintético na navegação"), {
      name: "TimeoutError",
    });
    env.page.goto.mockRejectedValueOnce(timeout);
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, timeoutMs: 35 }),
    ).rejects.toMatchObject({ codigo: "timeout", etapa: "chromium_navegacao" });
    expect(env.browser.close).toHaveBeenCalledTimes(1);
    expect(env.fechar).toHaveBeenCalledTimes(1);
  });

  it("não mantém o turno preso se browser.close não resolve", async () => {
    const env = ambientePdf();
    env.browser.close.mockImplementationOnce(() => new Promise<void>(() => undefined));
    const inicio = Date.now();
    await expect(renderizarUrlParaPdfControlado(danfe, policy)).resolves.toEqual(env.pdf);
    expect(Date.now() - inicio).toBeLessThan(3_500);
    expect(env.fechar).toHaveBeenCalledTimes(1);
  });

  it("recusa PDF sem assinatura completa", async () => {
    const env = ambientePdf();
    env.page.pdf.mockResolvedValueOnce(Buffer.from("%PDF-1.7\nsem fim"));
    await expect(renderizarUrlParaPdfControlado(danfe, policy)).rejects.toMatchObject({
      codigo: "tipo_nao_pdf",
    });
  });

  it("distingue timeout na validação fiscal sem imprimir PDF nem vazar URL", async () => {
    const env = ambientePdf();
    const timeout = Object.assign(new Error("falha em " + danfe), {
      name: "TimeoutError",
    });
    env.page.waitForFunction.mockRejectedValueOnce(timeout);

    let falha: unknown;
    try {
      await renderizarUrlParaPdfControlado(danfe, policy);
    } catch (erro) {
      falha = erro;
    }
    expect(falha).toBeInstanceOf(ErroRenderizacaoDocumento);
    expect(falha).toMatchObject({
      codigo: "timeout",
      etapa: "chromium_validacao_conteudo",
    });
    expect(String(falha)).not.toContain(danfe);
    expect(env.page.pdf).not.toHaveBeenCalled();
    expect(env.browser.close).toHaveBeenCalledTimes(1);
    expect(env.fechar).toHaveBeenCalledTimes(1);
  });

  it("distingue timeout nativo na impressão depois de validar o conteúdo", async () => {
    const env = ambientePdf();
    const timeout = Object.assign(new Error("falha em " + danfe), {
      name: "TimeoutError",
    });
    env.page.pdf.mockRejectedValueOnce(timeout);

    await expect(renderizarUrlParaPdfControlado(danfe, policy)).rejects.toMatchObject({
      codigo: "timeout",
      etapa: "chromium_impressao_pdf",
    });
    expect(env.page.waitForFunction).toHaveBeenCalledOnce();
    expect(env.browser.close).toHaveBeenCalledOnce();
    expect(env.fechar).toHaveBeenCalledOnce();
  });

  it.each([
    ["nenhum_bloqueio_interceptado", []],
    ["metodo_nao_permitido", [{ url: "https://app.vendaerp.com.br/api/dados", method: "POST" }]],
    ["destino_fora_origem", [{ url: "https://externo.example.test/assets.js", method: "GET" }]],
    [
      "ambas_classes_bloqueadas",
      [
        { url: "https://app.vendaerp.com.br/api/dados", method: "POST" },
        { url: "https://externo.example.test/assets.js", method: "GET" },
      ],
    ],
  ])("timeout de DOM registra classe finita de bloqueio: %s", async (esperado, requisições) => {
    const env = ambientePdf();
    const timeout = Object.assign(new Error("URL confidencial: " + danfe), {
      name: "TimeoutError",
    });
    env.page.waitForFunction.mockImplementationOnce(async () => {
      const handler = env.context.route.mock.calls[0]?.[1];
      expect(typeof handler).toBe("function");
      for (const requisicao of requisições) {
        const abort = vi.fn();
        const next = vi.fn();
        await handler({
          request: () => ({
            url: () => requisicao.url,
            method: () => requisicao.method,
          }),
          abort,
          continue: next,
        });
        expect(abort).toHaveBeenCalledWith("blockedbyclient");
        expect(next).not.toHaveBeenCalled();
      }
      throw timeout;
    });

    let falha: unknown;
    try {
      await renderizarUrlParaPdfControlado(danfe, policy);
    } catch (erro) {
      falha = erro;
    }
    expect(falha).toBeInstanceOf(ErroRenderizacaoDocumento);
    expect(falha).toMatchObject({
      codigo: "timeout",
      etapa: "chromium_validacao_conteudo",
      evidenciaEgress: esperado,
    });
    expect(String(falha)).not.toContain(danfe);
    expect(JSON.stringify(falha)).not.toContain("externo.example.test");
    expect(env.page.pdf).not.toHaveBeenCalled();
    expect(env.browser.close).toHaveBeenCalledOnce();
    expect(env.fechar).toHaveBeenCalledOnce();
  });

  it("mantém o motivo sanitizado de falha HTTPS do POST sem esconder bloqueio externo", async () => {
    const env = ambientePdf();
    const chave = "35261012345678000190550010649963971123456780";
    const urlApi =
      "https://novaapi.vendaerp.com.br/v3/CriaDANFE/GetDanfeInfoPublic?g=12345678-1234-4123-8123-123456789abc";
    mocks.buscarPinado.mockRejectedValueOnce(new Error("recurso_pdf_http_recusado"));
    env.page.waitForFunction.mockImplementationOnce(async () => {
      const handler = env.context.route.mock.calls[0]?.[1];
      const abort = vi.fn();
      await handler({
        request: () => ({
          url: () => urlApi,
          method: () => "POST",
          allHeaders: async () => ({ origin: "https://app.vendaerp.com.br" }),
          postDataBuffer: () => Buffer.from("{}"),
        }),
        abort,
      });
      expect(abort).toHaveBeenCalledWith("blockedbyclient");
      await handler({
        request: () => ({
          url: () => "https://fonts.googleapis.com/css?family=X",
          method: () => "GET",
        }),
        abort: vi.fn(),
      });
      throw Object.assign(new Error("conteudo reservado"), { name: "TimeoutError" });
    });
    mocks.extractPdfText.mockRejectedValue(
      new PdfExtractError("sem texto", undefined, "sem_texto", "sem_texto"),
    );
    let falha: unknown;
    try {
      await renderizarUrlParaPdfControlado(danfe, {
        ...policy,
        chaveFiscalEsperada: chave,
        recursosBrowser: {
          hostsAutorizados: ["novaapi.vendaerp.com.br"],
          permiteRecurso: (url, method) => url === urlApi && method === "POST",
        },
      });
    } catch (erro) {
      falha = erro;
    }
    expect(falha).toMatchObject({
      codigo: "render_falhou",
      etapa: "pdf_validacao",
      evidenciaValidacaoPdf: "extracao_sem_texto_apos_screen_dom_nao_confirmado",
      evidenciaEgress: "destino_fora_origem",
      evidenciaTransporte: "recurso_post_http_recusado",
    });
    expect(JSON.stringify(falha)).not.toContain(urlApi);
  });

  it("DANFE: permite recursos comprovados através de proxy HTTPS pinado, sem continue externo", async () => {
    const env = ambientePdf();
    const extras = {
      hostsAutorizados: ["novaapi.vendaerp.com.br", "d1fkuoqvag3bur.cloudfront.net"],
      permiteRecurso: (url: string, method: string) =>
        url ===
          "https://novaapi.vendaerp.com.br/v3/CriaDANFE/GetDanfeInfoPublic?g=12345678-1234-4123-8123-123456789abc" &&
        method === "POST",
    };
    mocks.buscarPinado.mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from("{}"),
    });
    await renderizarUrlParaPdfControlado(danfe, { ...policy, recursosBrowser: extras });
    expect(mocks.resolver).toHaveBeenCalledTimes(3);

    const handler = env.context.route.mock.calls[0]?.[1];
    const fulfill = vi.fn().mockResolvedValue(undefined);
    const continuar = vi.fn();
    const abort = vi.fn();
    await handler({
      request: () => ({
        url: () =>
          "https://novaapi.vendaerp.com.br/v3/CriaDANFE/GetDanfeInfoPublic?g=12345678-1234-4123-8123-123456789abc",
        method: () => "POST",
        allHeaders: () => Promise.resolve({ origin: "https://app.vendaerp.com.br" }),
        postDataBuffer: () => Buffer.from("{}"),
      }),
      fulfill,
      continue: continuar,
      abort,
    });
    expect(mocks.buscarPinado).toHaveBeenCalledWith(
      expect.objectContaining({
        metodo: "POST",
        ip: "8.8.8.8",
        body: Buffer.from("{}"),
      }),
    );
    expect(fulfill).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    expect(continuar).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it("DANFE: falha fechado em recurso não permitido ou falha de proxy pinado", async () => {
    const env = ambientePdf();
    const extras = {
      hostsAutorizados: ["novaapi.vendaerp.com.br"],
      permiteRecurso: (url: string, method: string) =>
        url.startsWith("https://novaapi.vendaerp.com.br/v3/CriaDANFE/") && method === "POST",
    };
    await renderizarUrlParaPdfControlado(danfe, { ...policy, recursosBrowser: extras });
    const handler = env.context.route.mock.calls[0]?.[1];
    const bloqueado = vi.fn();
    await handler({
      request: () => ({
        url: () => "http://169.254.169.254/latest/meta-data",
        method: () => "GET",
      }),
      abort: bloqueado,
      continue: vi.fn(),
    });
    expect(bloqueado).toHaveBeenCalledWith("blockedbyclient");
    mocks.buscarPinado.mockRejectedValueOnce(new Error("redirecionamento_sanitizado"));
    const abort = vi.fn();
    const continuar = vi.fn();
    await handler({
      request: () => ({
        url: () => "https://novaapi.vendaerp.com.br/v3/CriaDANFE/info",
        method: () => "POST",
        allHeaders: () => Promise.resolve({}),
        postDataBuffer: () => Buffer.from("{}"),
      }),
      abort,
      continue: continuar,
    });
    expect(abort).toHaveBeenCalledWith("blockedbyclient");
    expect(continuar).not.toHaveBeenCalled();
  });

  it("não associa bloqueio de rede ao erro da impressão do PDF", async () => {
    const env = ambientePdf();
    env.page.pdf.mockRejectedValueOnce(
      Object.assign(new Error("PDF indisponível"), { name: "TimeoutError" }),
    );
    await expect(renderizarUrlParaPdfControlado(danfe, policy)).rejects.toMatchObject({
      codigo: "timeout",
      etapa: "chromium_impressao_pdf",
      evidenciaEgress: undefined,
    });
  });
});
