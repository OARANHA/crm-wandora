import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type * as ErpService from "@/lib/integracoes-erp/service";
import type * as ExternalIdentity from "@/lib/integracoes-erp/identidade-externa-cliente";
import type * as LocalIdentity from "@/lib/integracoes-erp/identidade-cliente";
import type { ClienteErp } from "@/lib/integracoes-erp/tipos";

vi.mock("@/lib/integracoes-erp/service", async (original) => {
  const real = await original<typeof ErpService>();
  return { ...real, buscarClientesErp: vi.fn() };
});

vi.mock("@/lib/integracoes-erp/identidade-externa-cliente", async (original) => {
  const real = await original<typeof ExternalIdentity>();
  return {
    ...real,
    buscarVinculosClientePorRotulo: vi.fn(),
    carregarVinculoClienteExterno: vi.fn(),
    vincularIdentidadeClienteExterno: vi.fn(),
  };
});

vi.mock("@/lib/integracoes-erp/identidade-cliente", async (original) => {
  const real = await original<typeof LocalIdentity>();
  return { ...real, localizarContatosCandidatosClienteErp: vi.fn() };
});

const service = await import("@/lib/integracoes-erp/service");
const externalIdentity = await import("@/lib/integracoes-erp/identidade-externa-cliente");
const localIdentity = await import("@/lib/integracoes-erp/identidade-cliente");
const { resolverClienteVendaErp } =
  await import("@/lib/integracoes-erp/resolucao-cliente-vendaerp");

function cliente(overrides: Partial<ClienteErp> = {}): ClienteErp {
  return {
    id: "erp-eco",
    nome: "ECO PROJETOS LTDA",
    nomeFantasia: "OUTRO NOME",
    razaoSocial: "ECO PROJETOS",
    cpfCnpj: "12345678000190",
    email: "financeiro@eco.test",
    telefone: null,
    celular: null,
    cidade: "Porto Alegre",
    uf: "RS",
    ...overrides,
  };
}

describe("Customer Resolution VendaERP — descoberta por razão social", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalIdentity.buscarVinculosClientePorRotulo).mockResolvedValue({
      ok: true,
      vinculos: [],
    });
    vi.mocked(localIdentity.localizarContatosCandidatosClienteErp).mockResolvedValue({
      ok: true,
      contatos: [],
    });
    vi.mocked(externalIdentity.vincularIdentidadeClienteExterno).mockResolvedValue({
      ok: true,
      vinculo: {
        id: "link-eco",
        organizationId: "org-x",
        contactId: "11111111-1111-4111-8111-111111111111",
        provider: "vendaerp",
        externalId: "erp-eco",
        externalLabel: "Eco Projetos",
        externalLabelKey: "eco projetos",
        providerLookupLabel: "ECO PROJETOS",
        resolutionOrigin: "exact_name",
      },
      createdLink: true,
      createdContact: true,
    });
  });

  it("cai para varredura de clientes quando nomefantasia não acha a razão social", async () => {
    vi.mocked(service.buscarClientesErp)
      .mockResolvedValueOnce({ ok: true, dados: [] })
      .mockResolvedValueOnce({ ok: true, dados: [cliente()] });

    const resultado = await resolverClienteVendaErp({} as SupabaseClient, "org-x", {
      nome: "Eco Projetos",
    });

    expect(service.buscarClientesErp).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "org-x",
      expect.objectContaining({ nomefantasia: "Eco Projetos" }),
    );
    expect(service.buscarClientesErp).toHaveBeenNthCalledWith(2, expect.anything(), "org-x", {
      pageSize: 100,
      skip: 0,
    });
    expect(resultado).toMatchObject({
      status: "resolved",
      contactId: "11111111-1111-4111-8111-111111111111",
      origem: "provider",
      materialized: true,
    });
  });

  it("não declara not_found quando a varredura limitada termina sem provar exaustão", async () => {
    const paginaCheia = Array.from({ length: 100 }, (_, indice) =>
      cliente({
        id: `erp-${indice}`,
        nome: `Cliente ${indice}`,
        nomeFantasia: `Cliente ${indice}`,
        razaoSocial: `CLIENTE ${indice} LTDA`,
      }),
    );

    vi.mocked(service.buscarClientesErp)
      .mockResolvedValueOnce({ ok: true, dados: [] })
      .mockResolvedValue({ ok: true, dados: paginaCheia });

    const resultado = await resolverClienteVendaErp({} as SupabaseClient, "org-x", {
      nome: "Eco Projetos",
    });

    expect(resultado).toEqual({ status: "unresolved", motivo: "busca_nome_incompleta" });
    expect(service.buscarClientesErp).toHaveBeenCalledTimes(6);
  });

  it("timeout na varredura opcional falha fechado como busca incompleta e preserva candidatos seguros", async () => {
    const parecido = cliente({
      id: "erp-parecido",
      nome: "Eco Projetos Engenharia Ltda",
      nomeFantasia: "Eco Projetos Engenharia",
      razaoSocial: "ECO PROJETOS ENGENHARIA LTDA",
    });

    vi.mocked(service.buscarClientesErp)
      .mockResolvedValueOnce({ ok: true, dados: [parecido] })
      .mockResolvedValueOnce({ ok: false, motivo: "timeout" });

    const resultado = await resolverClienteVendaErp({} as SupabaseClient, "org-x", {
      nome: "Eco Projetos",
    });

    expect(resultado).toEqual({
      status: "unresolved",
      motivo: "busca_nome_incompleta",
      candidatos: [
        {
          nome: "Eco Projetos Engenharia Ltda",
          nomeFantasia: "Eco Projetos Engenharia",
          razaoSocial: "ECO PROJETOS ENGENHARIA LTDA",
          cidade: "Porto Alegre",
          uf: "RS",
        },
      ],
    });
  });

  it("mantém ambiguidade quando duas Pessoas têm a mesma razão social exata", async () => {
    vi.mocked(service.buscarClientesErp)
      .mockResolvedValueOnce({ ok: true, dados: [] })
      .mockResolvedValueOnce({
        ok: true,
        dados: [cliente({ id: "erp-a" }), cliente({ id: "erp-b" })],
      });

    const resultado = await resolverClienteVendaErp({} as SupabaseClient, "org-x", {
      nome: "Eco Projetos",
    });

    expect(resultado.status).toBe("ambiguous");
    if (resultado.status === "ambiguous") expect(resultado.candidatos).toHaveLength(2);
    expect(externalIdentity.vincularIdentidadeClienteExterno).not.toHaveBeenCalled();
  });
});
