import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type * as ErpService from "@/lib/integracoes-erp/service";
import type { PedidoErpComIdentidadeInterna } from "@/lib/integracoes-erp/service";
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
    carregarVinculoClienteExternoPorIdExterno: vi.fn(),
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
const { resolverClienteVendaErp, resolverClienteVendaErpPorPedidos } =
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
    vi.mocked(externalIdentity.carregarVinculoClienteExternoPorIdExterno).mockResolvedValue({
      ok: true,
      vinculo: null,
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

describe("Customer Resolution VendaERP — identidade vinda dos pedidos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalIdentity.carregarVinculoClienteExternoPorIdExterno).mockResolvedValue({
      ok: true,
      vinculo: null,
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
        providerLookupLabel: "Eco Projetos",
        resolutionOrigin: "exact_name",
      },
      createdLink: true,
      createdContact: true,
    });
  });

  function pedido(
    pessoaId: string | null,
    overrides: Partial<PedidoErpComIdentidadeInterna["identidadeCliente"]> = {},
  ): PedidoErpComIdentidadeInterna {
    return {
      pedido: {
        id: "pedido-1",
        codigo: 101,
        cliente: "Eco Projetos",
        status: "Faturado",
        statusSistema: "faturado",
        total: 100,
        data: "2026-10-01T12:00:00Z",
        finalizado: true,
        numeroNFe: "9001",
        dataFaturamento: "2026-10-01T13:00:00Z",
        chaveAcessoNFe: null,
        danfeUrl: null,
        urlSefaz: null,
      },
      identidadeCliente: {
        pessoaId,
        cpfCnpj: "12345678000190",
        email: "financeiro@eco.test",
        ...overrides,
      },
    };
  }

  it("materializa contact e vínculo por pessoaID única sem chamar Pessoas/Pesquisar", async () => {
    const resultado = await resolverClienteVendaErpPorPedidos(
      {} as SupabaseClient,
      "org-x",
      "Eco Projetos",
      [pedido("erp-eco"), pedido("erp-eco")],
      { actorApiTokenId: "tok-1", requestId: "req-1" },
    );

    expect(service.buscarClientesErp).not.toHaveBeenCalled();
    expect(externalIdentity.vincularIdentidadeClienteExterno).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-x",
        contactId: null,
        provider: "vendaerp",
        externalId: "erp-eco",
        externalLabel: "Eco Projetos",
        providerLookupLabel: "Eco Projetos",
        resolutionOrigin: "exact_name",
        evidence: expect.objectContaining({
          source: "orders_search",
          identity_field: "pessoaID",
          matched_orders: 2,
        }),
      }),
    );
    expect(resultado).toMatchObject({
      status: "resolved",
      contactId: "11111111-1111-4111-8111-111111111111",
      origem: "provider",
      materialized: true,
    });
  });

  it("reutiliza contact local compatível por e-mail em vez de criar duplicado", async () => {
    vi.mocked(localIdentity.localizarContatosCandidatosClienteErp).mockResolvedValue({
      ok: true,
      contatos: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          phone_number: null,
          email_normalized: "financeiro@eco.test",
          cpf_hash: null,
          is_anonymized: false,
        },
      ],
    });
    vi.mocked(externalIdentity.vincularIdentidadeClienteExterno).mockResolvedValue({
      ok: true,
      vinculo: {
        id: "link-local",
        organizationId: "org-x",
        contactId: "33333333-3333-4333-8333-333333333333",
        provider: "vendaerp",
        externalId: "erp-eco",
        externalLabel: "Eco Projetos",
        externalLabelKey: "eco projetos",
        providerLookupLabel: "Eco Projetos",
        resolutionOrigin: "existing_contact",
      },
      createdLink: true,
      createdContact: false,
    });

    const resultado = await resolverClienteVendaErpPorPedidos(
      {} as SupabaseClient,
      "org-x",
      "Eco Projetos",
      [pedido("erp-eco")],
    );

    expect(externalIdentity.vincularIdentidadeClienteExterno).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contactId: "33333333-3333-4333-8333-333333333333",
        externalId: "erp-eco",
        resolutionOrigin: "existing_contact",
      }),
    );
    expect(resultado).toMatchObject({
      status: "resolved",
      contactId: "33333333-3333-4333-8333-333333333333",
      materialized: false,
    });
  });

  it("reutiliza vínculo existente pela pessoaID e não procura candidato local", async () => {
    vi.mocked(externalIdentity.carregarVinculoClienteExternoPorIdExterno).mockResolvedValue({
      ok: true,
      vinculo: {
        id: "link-existente",
        organizationId: "org-x",
        contactId: "22222222-2222-4222-8222-222222222222",
        provider: "vendaerp",
        externalId: "erp-eco",
        externalLabel: "Eco Projetos",
        externalLabelKey: "eco projetos",
        providerLookupLabel: "Eco Projetos",
        resolutionOrigin: "exact_name",
      },
    });
    vi.mocked(externalIdentity.vincularIdentidadeClienteExterno).mockResolvedValue({
      ok: true,
      vinculo: {
        id: "link-existente",
        organizationId: "org-x",
        contactId: "22222222-2222-4222-8222-222222222222",
        provider: "vendaerp",
        externalId: "erp-eco",
        externalLabel: "Eco Projetos",
        externalLabelKey: "eco projetos",
        providerLookupLabel: "Eco Projetos",
        resolutionOrigin: "exact_name",
      },
      createdLink: false,
      createdContact: false,
    });

    const resultado = await resolverClienteVendaErpPorPedidos(
      {} as SupabaseClient,
      "org-x",
      "Eco Projetos",
      [pedido("erp-eco")],
    );

    expect(localIdentity.localizarContatosCandidatosClienteErp).not.toHaveBeenCalled();
    expect(externalIdentity.vincularIdentidadeClienteExterno).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contactId: "22222222-2222-4222-8222-222222222222",
        externalId: "erp-eco",
        resolutionOrigin: "existing_contact",
      }),
    );
    expect(resultado).toMatchObject({
      status: "resolved",
      contactId: "22222222-2222-4222-8222-222222222222",
      origem: "existing_link",
      materialized: false,
    });
  });

  it("múltiplas pessoaID no mesmo resultado são ambíguas e nunca criam vínculo", async () => {
    const resultado = await resolverClienteVendaErpPorPedidos(
      {} as SupabaseClient,
      "org-x",
      "Eco Projetos",
      [pedido("erp-a"), pedido("erp-b")],
    );

    expect(resultado).toMatchObject({
      status: "ambiguous",
      motivo: "mais_de_um_cliente_nos_pedidos",
    });
    expect(externalIdentity.vincularIdentidadeClienteExterno).not.toHaveBeenCalled();
    expect(service.buscarClientesErp).not.toHaveBeenCalled();
  });

  it("pessoaID ausente usa CNPJ do próprio pedido em uma consulta direta e materializa", async () => {
    vi.mocked(service.buscarClientesErp).mockResolvedValue({
      ok: true,
      dados: [cliente()],
    });

    const resultado = await resolverClienteVendaErpPorPedidos(
      {} as SupabaseClient,
      "org-x",
      "Eco Projetos",
      [pedido(null), pedido(null)],
      { actorApiTokenId: "tok-1", requestId: "req-fallback-cnpj" },
    );

    expect(service.buscarClientesErp).toHaveBeenCalledTimes(1);
    expect(service.buscarClientesErp).toHaveBeenCalledWith(expect.anything(), "org-x", {
      cpfcnpj: "12345678000190",
      pageSize: 20,
      skip: 0,
    });
    expect(externalIdentity.vincularIdentidadeClienteExterno).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        externalId: "erp-eco",
        resolutionOrigin: "exact_document",
        evidence: expect.objectContaining({
          source: "orders_search",
          identity_field: "clienteCNPJ",
          pessoa_id_present_count: 0,
        }),
      }),
    );
    expect(resultado).toMatchObject({
      status: "resolved",
      contactId: "11111111-1111-4111-8111-111111111111",
      materialized: true,
    });
  });

  it("pessoaID parcial só aceita o cliente encontrado por CNPJ quando os ids concordam", async () => {
    vi.mocked(service.buscarClientesErp).mockResolvedValue({
      ok: true,
      dados: [cliente({ id: "erp-outro" })],
    });

    const resultado = await resolverClienteVendaErpPorPedidos(
      {} as SupabaseClient,
      "org-x",
      "Eco Projetos",
      [pedido("erp-eco"), pedido(null)],
    );

    expect(resultado).toEqual({
      status: "unresolved",
      motivo: "identidade_pedido_inconsistente",
    });
    expect(externalIdentity.vincularIdentidadeClienteExterno).not.toHaveBeenCalled();
  });

  it("sem pessoaID e sem CNPJ/e-mail continua fail-closed sem consultar Pessoas", async () => {
    const resultado = await resolverClienteVendaErpPorPedidos(
      {} as SupabaseClient,
      "org-x",
      "Eco Projetos",
      [pedido(null, { cpfCnpj: null, email: null })],
    );

    expect(resultado).toEqual({
      status: "unresolved",
      motivo: "identidade_pedido_incompleta",
    });
    expect(service.buscarClientesErp).not.toHaveBeenCalled();
    expect(externalIdentity.vincularIdentidadeClienteExterno).not.toHaveBeenCalled();
  });

  it("pessoaID completa e única continua autoridade mesmo se e-mail histórico variar", async () => {
    const resultado = await resolverClienteVendaErpPorPedidos(
      {} as SupabaseClient,
      "org-x",
      "Eco Projetos",
      [
        pedido("erp-eco", { email: "antigo@eco.test" }),
        pedido("erp-eco", { email: "financeiro@eco.test" }),
      ],
    );

    expect(service.buscarClientesErp).not.toHaveBeenCalled();
    expect(externalIdentity.vincularIdentidadeClienteExterno).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        externalId: "erp-eco",
        evidence: expect.objectContaining({
          identity_field: "pessoaID",
          has_email: false,
        }),
      }),
    );
    expect(resultado.status).toBe("resolved");
  });
});
