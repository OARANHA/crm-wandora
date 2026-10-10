import { describe, expect, it, vi } from "vitest";

import { ErroRenderizacaoDocumento } from "@/lib/documentos/renderizar-url-pdf";
import { materializarDanfeExterno } from "@/lib/integracoes-erp/danfe";
import { ehUrlDanfePublicoVendaErp } from "@/lib/integracoes-erp/vendaerp-danfe-pdf";

describe("materialização segura do DANFE", () => {
  it("aceita PDF provado pelos bytes sem confiar no sufixo da URL", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("%PDF-1.7\nconteudo", {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
    ) as unknown as typeof fetch;

    const r = await materializarDanfeExterno("https://erp.example.test/imprimir?id=1", fetcher);

    expect(r.mime).toBe("application/pdf");
    expect(r.extensao).toBe("pdf");
    expect(r.sizeBytes).toBeGreaterThan(0);
  });

  it("encaminha headers de download fornecidos pelo chamador", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("%PDF-1.7\nconteudo", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
    ) as unknown as typeof fetch;

    await materializarDanfeExterno("https://erp.example.test/danfe", fetcher, {
      headers: {
        "Authorization-Token": "segredo",
        User: "usuario",
        App: "app",
      },
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://erp.example.test/danfe",
      expect.objectContaining({
        headers: {
          "Authorization-Token": "segredo",
          User: "usuario",
          App: "app",
        },
      }),
    );
  });

  it("reconhece somente a rota pública esperada do DANFE VendaERP", () => {
    expect(
      ehUrlDanfePublicoVendaErp(
        "https://app.vendaerp.com.br/v3/public/NFe/Danfe?print=true&Cod=6abe71151d133d5c8962c4e9&t=2d3d6ffdcd8352708eefd81413758ac8&trib=false&g=34b6208d-4d02-49bc-8a59-8823d1b10765",
      ),
    ).toBe(true);
    expect(
      ehUrlDanfePublicoVendaErp(
        "https://evil.invalid/v3/public/NFe/Danfe?Cod=6abe71151d133d5c8962c4e9&g=34b6208d-4d02-49bc-8a59-8823d1b10765",
      ),
    ).toBe(false);
    expect(
      ehUrlDanfePublicoVendaErp(
        "https://app.vendaerp.com.br/v3/public/NFe/Danfe?Cod=6abe71151d133d5c8962c4e9&g=34b6208d-4d02-49bc-8a59-8823d1b10765&next=https://evil.invalid",
      ),
    ).toBe(false);
  });

  it("renderiza a rota pública VendaERP direto no Chromium, sem fazer fetch intermediário", async () => {
    const url =
      "https://app.vendaerp.com.br/v3/public/NFe/Danfe?print=true&Cod=6abe71151d133d5c8962c4e9&t=2d3d6ffdcd8352708eefd81413758ac8&trib=false&g=34b6208d-4d02-49bc-8a59-8823d1b10765";
    const fetcher = vi.fn(async () => {
      throw new Error("fetch não deveria ser chamado para DANFE VendaERP");
    }) as unknown as typeof fetch;
    const renderizadorVendaErp = vi.fn(async () => Buffer.from("%PDF-1.7\nrenderizado"));

    const r = await materializarDanfeExterno(url, fetcher, {
      renderizadorVendaErp,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(renderizadorVendaErp).toHaveBeenCalledWith(url);
    expect(r.mime).toBe("application/pdf");
    expect(r.extensao).toBe("pdf");
    expect(r.buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("não faz fallback para Chromium em timeout de URL fora da allowlist VendaERP", async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException("DANFE fetch timeout", "TimeoutError");
    }) as unknown as typeof fetch;
    const renderizadorVendaErp = vi.fn(async () => Buffer.from("%PDF-1.7\nrenderizado"));

    await expect(
      materializarDanfeExterno("https://erp.example.test/danfe", fetcher, {
        renderizadorVendaErp,
      }),
    ).rejects.toMatchObject({ codigo: "timeout" });

    expect(renderizadorVendaErp).not.toHaveBeenCalled();
  });

  it("mapeia timeout da capability de documento para o contrato técnico do DANFE", async () => {
    const url =
      "https://app.vendaerp.com.br/v3/public/NFe/Danfe?print=true&Cod=6abe71151d133d5c8962c4e9&t=2d3d6ffdcd8352708eefd81413758ac8&trib=false&g=34b6208d-4d02-49bc-8a59-8823d1b10765";
    const fetcher = vi.fn(async () => {
      throw new Error("fetch não deveria ser chamado para DANFE VendaERP");
    }) as unknown as typeof fetch;
    const renderizadorVendaErp = vi.fn(async () => {
      throw new ErroRenderizacaoDocumento(
        "timeout",
        "chromium_apos_redirect",
        "sem_marcador_final",
      );
    });

    await expect(
      materializarDanfeExterno(url, fetcher, { renderizadorVendaErp }),
    ).rejects.toMatchObject({
      codigo: "timeout",
      etapa: "chromium_apos_redirect",
      evidenciaPdf: "sem_marcador_final",
      message: "timeout",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("propaga evidência sanitizada de bloqueio sem expor o destino", async () => {
    const url =
      "https://app.vendaerp.com.br/v3/public/NFe/Danfe?Cod=6abe71151d133d5c8962c4e9&g=34b6208d-4d02-49bc-8a59-8823d1b10765";
    const renderizadorVendaErp = vi.fn(async () => {
      throw new ErroRenderizacaoDocumento(
        "timeout",
        "chromium_validacao_conteudo",
        undefined,
        "destino_fora_origem",
      );
    });
    await expect(
      materializarDanfeExterno(url, undefined, { renderizadorVendaErp }),
    ).rejects.toMatchObject({
      codigo: "timeout",
      etapa: "chromium_validacao_conteudo",
      evidenciaEgress: "destino_fora_origem",
    });
    expect(renderizadorVendaErp).toHaveBeenCalledOnce();
  });

  it("propaga somente a classe de validação, sem chave fiscal ou texto", async () => {
    const url =
      "https://app.vendaerp.com.br/v3/public/NFe/Danfe?Cod=6abe71151d133d5c8962c4e9&g=34b6208d-4d02-49bc-8a59-8823d1b10765";
    const renderizadorVendaErp = vi.fn(async () => {
      throw new ErroRenderizacaoDocumento(
        "render_falhou",
        "pdf_validacao",
        undefined,
        undefined,
        "chave_divergente",
      );
    });
    await expect(
      materializarDanfeExterno(url, undefined, { renderizadorVendaErp }),
    ).rejects.toMatchObject({
      codigo: "download_falhou",
      etapa: "pdf_validacao",
      evidenciaValidacaoPdf: "chave_divergente",
    });
  });

  it("continua recusando HTML para qualquer outra URL", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("<html>login</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as unknown as typeof fetch;

    await expect(
      materializarDanfeExterno("https://erp.example.test/danfe", fetcher),
    ).rejects.toMatchObject({ codigo: "tipo_nao_documento" });
  });

  it("recusa redirect mesmo quando o fetcher injetado não usa o wrapper canônico", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
    ) as unknown as typeof fetch;

    await expect(
      materializarDanfeExterno("https://erp.example.test/danfe", fetcher),
    ).rejects.toMatchObject({ codigo: "destino_inseguro" });
  });

  it("recusa tamanho declarado acima do teto antes de ler o corpo", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("%PDF-1.7", {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-length": String(52_428_801),
          },
        }),
    ) as unknown as typeof fetch;

    await expect(
      materializarDanfeExterno("https://erp.example.test/danfe", fetcher),
    ).rejects.toMatchObject({ codigo: "arquivo_grande" });
  });

  it("não propaga detalhe de erro de rede/credencial para cima", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("token=segredo-nao-deve-vazar");
    }) as unknown as typeof fetch;

    await expect(
      materializarDanfeExterno("https://erp.example.test/danfe", fetcher),
    ).rejects.toMatchObject({
      codigo: "download_falhou",
      message: "download_falhou",
    });
  });
});
