import { describe, expect, it } from "vitest";

import {
  ErroRenderizacaoDocumento,
  renderizarUrlParaPdf,
} from "@/lib/documentos/renderizar-url-pdf";

describe("capability document.render.url_to_pdf", () => {
  it("falha fechado antes de abrir Chromium quando a policy rejeita a URL", async () => {
    await expect(
      renderizarUrlParaPdf("https://example.invalid/documento", {
        nome: "teste",
        permiteUrl: () => false,
      }),
    ).rejects.toEqual(new ErroRenderizacaoDocumento("destino_inseguro"));
  });
});
