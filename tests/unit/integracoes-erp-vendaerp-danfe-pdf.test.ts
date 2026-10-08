import { describe, expect, it, vi } from "vitest";

import type { PoliticaRenderizacaoUrlPdf } from "@/lib/documentos/renderizar-url-pdf";
import {
  ehUrlDanfePublicoVendaErp,
  renderizarDanfeVendaErpParaPdf,
} from "@/lib/integracoes-erp/vendaerp-danfe-pdf";

const URL_DANFE =
  "https://app.vendaerp.com.br/v3/public/NFe/Danfe?print=true&Cod=6abe71151d133d5c8962c4e9&t=2d3d6ffdcd8352708eefd81413758ac8&trib=false&g=34b6208d-4d02-49bc-8a59-8823d1b10765";

describe("capability erp.vendaerp.danfe_to_pdf", () => {
  it("aceita somente a rota pública conhecida do VendaERP", () => {
    expect(ehUrlDanfePublicoVendaErp(URL_DANFE)).toBe(true);
    expect(
      ehUrlDanfePublicoVendaErp(
        "https://evil.invalid/v3/public/NFe/Danfe?Cod=6abe71151d133d5c8962c4e9&g=34b6208d-4d02-49bc-8a59-8823d1b10765",
      ),
    ).toBe(false);
  });

  it("chama o renderer genérico com policy fechada e sem credenciais ERP", async () => {
    const renderer = vi.fn(async (_url: string, _politica: PoliticaRenderizacaoUrlPdf) =>
      Buffer.from("%PDF-1.7\ncapability"),
    );

    const pdf = await renderizarDanfeVendaErpParaPdf(URL_DANFE, renderer);

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(renderer).toHaveBeenCalledTimes(1);

    const chamada = renderer.mock.calls[0];
    expect(chamada).toBeDefined();
    const [url, politica] = chamada!;
    expect(url).toBe(URL_DANFE);
    expect(politica.nome).toBe("erp.vendaerp.danfe_to_pdf");
    expect(politica.permiteUrl(URL_DANFE)).toBe(true);
    expect(politica.timeoutMs).toBe(60_000);
    expect(politica.observarNavegacao).toBe(true);

    const serializado = JSON.stringify(politica);
    expect(serializado).not.toContain("Authorization-Token");
    expect(serializado).not.toContain("User");
    expect(serializado).not.toContain("App");
  });
});
