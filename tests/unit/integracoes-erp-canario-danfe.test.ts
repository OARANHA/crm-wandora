import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  executarCanarioDanfeReadonly,
  type DependenciasCanarioDanfe,
} from "@/lib/integracoes-erp/canario-danfe-readonly";

function adminFake() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: "11111111-1111-4111-8111-111111111111",
      organization_id: "22222222-2222-4222-8222-222222222222",
      contact_id: "33333333-3333-4333-8333-333333333333",
    },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });

  const upload = vi.fn().mockResolvedValue({ error: null });
  const createSignedUrl = vi.fn().mockResolvedValue({
    data: { signedUrl: "https://storage.example.invalid/signed" },
    error: null,
  });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const fromStorage = vi.fn().mockReturnValue({ upload, createSignedUrl, remove });

  return {
    client: {
      from: vi.fn().mockReturnValue({ select }),
      storage: { from: fromStorage },
    } as unknown as SupabaseClient,
    upload,
    createSignedUrl,
    remove,
  };
}

function depsFake(): DependenciasCanarioDanfe {
  return {
    buscarPedidos: vi.fn().mockResolvedValue({
      ok: true,
      dados: [
        {
          pedido: {
            id: "pedido-provider-id",
            codigo: 123,
            cliente: "Cliente",
            status: "faturado",
            statusSistema: "faturado",
            total: 10,
            data: "2026-10-03",
            finalizado: true,
            numeroNFe: "456",
            dataFaturamento: "2026-10-03",
            chaveAcessoNFe: null,
            danfeUrl: null,
            urlSefaz: null,
          },
          identidadeCliente: {
            pessoaId: "pessoa-provider-id",
            cpfCnpj: "redacted-in-test",
            email: "redacted-in-test",
          },
        },
      ],
    }),
    provarPedido: vi.fn().mockResolvedValue({
      ok: true,
      evidencias: ["cpf", "email"],
    }),
    obterNota: vi.fn().mockResolvedValue({
      ok: true,
      dados: {
        numero: 456,
        codigoStatus: 100,
        mensagemStatus: "Autorizado",
        chave: null,
        lote: 1,
        danfeUrl: "https://danfe.example.invalid/document.pdf",
      },
    }),
    materializarDanfe: vi.fn().mockResolvedValue({
      buffer: Buffer.from("%PDF-1.7\ncanary"),
      mime: "application/pdf",
      sizeBytes: 15,
      extensao: "pdf",
    }),
    fetchPreview: vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
    uuid: () => "44444444-4444-4444-8444-444444444444",
  };
}

describe("canário VendaERP → DANFE read-only", () => {
  it("faz uma única passagem Pedido → Pessoa → contato → NFe e para em preview", async () => {
    const admin = adminFake();
    const deps = depsFake();

    const resultado = await executarCanarioDanfeReadonly(
      admin.client,
      {
        conversationId: "11111111-1111-4111-8111-111111111111",
        pedidoCodigo: 123,
      },
      deps,
    );

    expect(resultado).toMatchObject({
      ok: true,
      pedido_codigo: 123,
      nfe_numero: 456,
      provider_calls: [
        "GET Pedidos/Pesquisar",
        "GET Pessoas/Pesquisar",
        "GET Fiscal/ConsultarNFE",
      ],
      preview: { ready: true, http_status: 200, expires_seconds: 600 },
      whatsapp_sent: false,
      vendaerp_writes: 0,
    });
    expect(deps.buscarPedidos).toHaveBeenCalledTimes(1);
    expect(deps.provarPedido).toHaveBeenCalledTimes(1);
    expect(deps.obterNota).toHaveBeenCalledTimes(1);
    expect(deps.materializarDanfe).toHaveBeenCalledTimes(1);
    expect(deps.fetchPreview).toHaveBeenCalledTimes(1);
    expect(admin.upload).toHaveBeenCalledTimes(1);
  });

  it("falha fechado antes da NFe quando o gate de identidade não confirma", async () => {
    const admin = adminFake();
    const deps = depsFake();
    deps.provarPedido = vi.fn().mockResolvedValue({
      ok: false,
      motivo: "identidade_nao_confere",
    });

    const resultado = await executarCanarioDanfeReadonly(
      admin.client,
      {
        conversationId: "11111111-1111-4111-8111-111111111111",
        pedidoCodigo: 123,
      },
      deps,
    );

    expect(resultado).toEqual({
      ok: false,
      code: "identity_unverified",
      detail: "identidade_nao_confere",
    });
    expect(deps.obterNota).not.toHaveBeenCalled();
    expect(deps.materializarDanfe).not.toHaveBeenCalled();
    expect(admin.upload).not.toHaveBeenCalled();
  });
});
