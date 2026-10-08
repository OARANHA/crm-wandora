import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  abrirRedirectLocalParaDocumento,
  argumentosChromiumParaPdf,
  argumentosChromiumParaPdfDestino,
  ErroRenderizacaoDocumento,
  evidenciarPdfNoTimeout,
  renderizarUrlParaPdf,
} from "@/lib/documentos/renderizar-url-pdf";

describe("capability document.render.url_to_pdf", () => {
  it("inclui --no-sandbox no Chromium do runner em container", () => {
    const args = argumentosChromiumParaPdf("/tmp/entrada.html", "/tmp/documento.pdf");

    expect(args).toContain("--no-sandbox");
    expect(args).toContain("--print-to-pdf=/tmp/documento.pdf");
    expect(args).toContain("file:///tmp/entrada.html");
  });

  it("protege a URL externa atrás de redirect HTTP loopback com nonce", async () => {
    const destino =
      "https://app.vendaerp.com.br/v3/public/NFe/Danfe?Cod=segredo-provider&g=segredo";
    const redirect = await abrirRedirectLocalParaDocumento(destino);

    try {
      expect(redirect.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+$/i);
      expect(redirect.url).not.toContain("segredo-provider");
      expect(redirect.houveRedirecionamento()).toBe(false);

      const resposta = await fetch(redirect.url, { redirect: "manual" });
      expect(resposta.status).toBe(302);
      expect(resposta.headers.get("location")).toBe(destino);
      expect(redirect.houveRedirecionamento()).toBe(true);

      const args = argumentosChromiumParaPdfDestino(redirect.url, "/tmp/documento.pdf");
      expect(args).toContain(redirect.url);
      expect(args.join(" ")).not.toContain(destino);
    } finally {
      await redirect.fechar();
    }
  });

  it("classifica falha ao iniciar Chromium antes do redirect sem registrar URL ou token", async () => {
    const anterior = process.env.CHROMIUM_PATH;
    process.env.CHROMIUM_PATH = "/nao-existe-binario-chromium-para-teste";

    try {
      const token = "segredo-que-nao-pode-vazar";
      let erro: unknown;
      try {
        await renderizarUrlParaPdf("https://provider.example.test/documento?token=" + token, {
          nome: "fixture",
          permiteUrl: () => true,
        });
      } catch (falha) {
        erro = falha;
      }

      expect(erro).toBeInstanceOf(ErroRenderizacaoDocumento);
      expect(erro).toMatchObject({
        codigo: "render_falhou",
        etapa: "chromium_antes_redirect",
        message: "render_falhou",
      });
      expect(JSON.stringify(erro)).not.toContain(token);
      expect(String(erro)).not.toContain(token);
    } finally {
      if (anterior === undefined) delete process.env.CHROMIUM_PATH;
      else process.env.CHROMIUM_PATH = anterior;
    }
  });

  it("classifica apenas marcadores do PDF temporário, sem ler ou registrar conteúdo fiscal", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "elus-evidencia-pdf-"));
    const caminho = join(pasta, "documento.pdf");
    try {
      expect(await evidenciarPdfNoTimeout(caminho)).toBe("arquivo_ausente");
      await writeFile(caminho, "");
      expect(await evidenciarPdfNoTimeout(caminho)).toBe("arquivo_vazio");
      await writeFile(caminho, "conteudo sem formato pdf");
      expect(await evidenciarPdfNoTimeout(caminho)).toBe("sem_assinatura_pdf");
      await writeFile(caminho, "%PDF-1.7\\nconteudo sintético em gravação");
      expect(await evidenciarPdfNoTimeout(caminho)).toBe("sem_marcador_final");
      await writeFile(caminho, "%PDF-1.7\\nconteudo sintético\\n%%EOF\\n");
      expect(await evidenciarPdfNoTimeout(caminho)).toBe("marcadores_pdf_presentes");
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  });

  it("falha fechado antes de abrir Chromium quando a policy rejeita a URL", async () => {
    await expect(
      renderizarUrlParaPdf("https://example.invalid/documento", {
        nome: "teste",
        permiteUrl: () => false,
      }),
    ).rejects.toEqual(new ErroRenderizacaoDocumento("destino_inseguro"));
  });
});
