import type * as BrowserEgress from "@/lib/documentos/egress-browser-pdf";
import type * as RenderUrlPdf from "@/lib/documentos/renderizar-url-pdf";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolver: vi.fn(),
  launch: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/documentos/egress-browser-pdf", async (importOriginal) => {
  const original = await importOriginal<typeof BrowserEgress>();
  return { ...original, resolverIpPublicoFixadoParaBrowser: mocks.resolver };
});
vi.mock("playwright-core", () => ({ chromium: { launch: mocks.launch } }));
vi.mock("@/lib/documentos/renderizar-url-pdf", async (importOriginal) => {
  const original = await importOriginal<typeof RenderUrlPdf>();
  return { ...original, abrirRedirectLocalParaDocumento: mocks.redirect };
});

import { ErroRenderizacaoDocumento } from "@/lib/documentos/renderizar-url-pdf";
import { renderizarUrlParaPdfControlado } from "@/lib/documentos/renderizar-url-pdf-controlado";

const danfe =
  "https://app.vendaerp.com.br/v3/public/NFe/Danfe?Cod=abcdef123456abcdef123456&g=12345678-1234-4123-8123-123456789abc";
const local = "http://127.0.0.1:42311/nonce-sintetico";

function ambientePdf() {
  const pdf = Buffer.from("%PDF-1.7\nPDF DE TESTE SINTETICO\n%%EOF\n");
  const page = {
    goto: vi.fn().mockResolvedValue({ ok: () => true }),
    url: vi.fn().mockReturnValue(danfe),
    waitForFunction: vi.fn().mockResolvedValue(true),
    pdf: vi.fn().mockResolvedValue(pdf),
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
    expect(falha).toMatchObject({ codigo: "render_falhou" });
    expect(String(falha)).not.toContain(danfe);
    expect(env.browser.close).toHaveBeenCalledTimes(1);
    expect(env.fechar).toHaveBeenCalledTimes(1);
  });

  it("encerra o navegador se page.pdf ficar pendente após o prazo", async () => {
    const env = ambientePdf();
    env.page.pdf.mockImplementationOnce(() => new Promise<Buffer>(() => undefined));
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, timeoutMs: 40 }),
    ).rejects.toMatchObject({ codigo: "timeout" });
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
    Reflect.deleteProperty(document.body, "innerText");
  });

  it("limita o DNS pendente sem iniciar navegador nem URL externa", async () => {
    mocks.resolver.mockImplementationOnce(() => new Promise<string | null>(() => undefined));
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, timeoutMs: 35 }),
    ).rejects.toMatchObject({ codigo: "timeout" });
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("limita inicialização do contexto, fecha browser e bootstrap", async () => {
    const env = ambientePdf();
    env.browser.newContext.mockImplementationOnce(() => new Promise(() => undefined));
    await expect(
      renderizarUrlParaPdfControlado(danfe, { ...policy, timeoutMs: 35 }),
    ).rejects.toMatchObject({ codigo: "timeout" });
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
});
