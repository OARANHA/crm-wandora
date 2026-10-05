import { describe, expect, it } from "vitest";

import {
  argumentosChromiumParaPdf,
  ErroRenderizacaoDocumento,
  renderizarUrlParaPdf,
} from "@/lib/documentos/renderizar-url-pdf";

describe("capability document.render.url_to_pdf", () => {
  it("inclui --no-sandbox no Chromium do runner em container", () => {
    const args = argumentosChromiumParaPdf("/tmp/entrada.html", "/tmp/documento.pdf");

    expect(args).toContain("--no-sandbox");
    expect(args).toContain("--print-to-pdf=/tmp/documento.pdf");
    expect(args).toContain("file:///tmp/entrada.html");
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
