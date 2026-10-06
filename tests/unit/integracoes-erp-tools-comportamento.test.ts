import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type * as ErpService from "@/lib/integracoes-erp/service";
import type { PedidoErpComIdentidadeInterna } from "@/lib/integracoes-erp/service";
import type { McpContext } from "@/lib/mcp/types";

vi.mock("@/lib/integracoes-erp/service", async (original) => {
  const real = await original<typeof ErpService>();
  return {
    ...real,
    buscarProdutosErp: vi.fn(),
    buscarClientesErp: vi.fn(),
    buscarPedidosErp: vi.fn(),
    buscarPedidosErpComIdentidadeInterna: vi.fn(),
    lerEstoqueErp: vi.fn(),
    obterNotaErp: vi.fn(),
  };
});

vi.mock("@/lib/integracoes-erp/resolucao-cliente-vendaerp", () => ({
  resolverClienteVendaErp: vi.fn(),
}));
vi.mock("@/lib/integracoes-erp/identidade-externa-cliente", () => ({
  carregarVinculoClienteExterno: vi.fn(),
}));

const service = await import("@/lib/integracoes-erp/service");
const customerResolution = await import("@/lib/integracoes-erp/resolucao-cliente-vendaerp");
const identityLinks = await import("@/lib/integracoes-erp/identidade-externa-cliente");
const {
  crmErpGetInvoice,
  crmErpReadStock,
  crmErpSearchCustomers,
  crmErpSearchOrders,
  crmErpSearchProducts,
} = await import("@/lib/mcp/tools/integracoes-erp");

const ctx: McpContext = {
  organizationId: "org-erp",
  role: "agent",
  actor: { type: "ai_agent", id: "ag-erp", role: "ai_operator" },
  apiTokenId: "tok-erp",
  requestId: "req-erp",
  supabase: {} as unknown as SupabaseClient,
};

describe("tools ERP READ — comportamento do agente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("produto localiza código/preço e preserva a fronteira com a consulta de estoque", async () => {
    vi.mocked(service.buscarProdutosErp).mockResolvedValue({
      ok: true,
      dados: [
        {
          id: "p1",
          codigo: "316",
          nome: "Tinta",
          preco: 199.9,
          estoque: -37,
          unidade: "UN",
          ean: null,
          marca: "Marca",
          categoria: "Tintas",
        },
      ],
    });

    const resultado = (await crmErpSearchProducts.handler(
      {
        nome: "Tinta",
        codigo: undefined,
        ean: undefined,
        marca: undefined,
        categoria: undefined,
        deposito: undefined,
        limite: 10,
        skip: 0,
      },
      ctx,
    )) as { produtos: Array<{ codigo: string | null; preco: number | null }> };

    expect(resultado.produtos).toEqual([expect.objectContaining({ codigo: "316", preco: 199.9 })]);
    expect(crmErpSearchProducts.description).toContain("crm_erp_read_stock");
    expect(service.buscarProdutosErp).toHaveBeenCalledWith(
      ctx.supabase,
      ctx.organizationId,
      expect.objectContaining({ nome: "Tinta", pageSize: 10, skip: 0 }),
    );
  });

  it("estoque preserva negativo e reservado sem inventar disponibilidade", async () => {
    vi.mocked(service.lerEstoqueErp).mockResolvedValue({
      ok: true,
      dados: {
        deposito: "PADRÃO",
        itens: [
          { codigo: "316", estoqueAtual: -37, saldoReservado: 0 },
          { codigo: "316-1", estoqueAtual: -7, saldoReservado: 0 },
        ],
      },
    });

    const resultado = (await crmErpReadStock.handler(
      {
        codigo: "316",
        deposito: "PADRÃO",
        somente_visiveis_catalogo: false,
        limite: 50,
      },
      ctx,
    )) as {
      deposito: string;
      estoque: Array<{
        codigo: string | null;
        estoque_atual: number | null;
        saldo_reservado: number | null;
      }>;
    };

    expect(resultado).toEqual({
      deposito: "PADRÃO",
      estoque: [
        { codigo: "316", estoque_atual: -37, saldo_reservado: 0 },
        { codigo: "316-1", estoque_atual: -7, saldo_reservado: 0 },
      ],
    });
    expect(resultado.estoque[0]).not.toHaveProperty("disponivel");
    expect(service.lerEstoqueErp).toHaveBeenCalledWith(ctx.supabase, ctx.organizationId, {
      codigo: "316",
      deposito: "PADRÃO",
      visivelCatalogo: false,
    });
  });

  it("mais de um depósito vira escolha, não consulta silenciosa inventada", async () => {
    vi.mocked(service.lerEstoqueErp).mockResolvedValue({
      ok: false,
      motivo: "deposito_ambiguo",
      detalhes: {
        depositos: [
          { id: "d1", nome: "PADRÃO", empresaId: "e1", empresa: "Empresa" },
          { id: "d2", nome: "FILIAL", empresaId: "e1", empresa: "Empresa" },
        ],
      },
    });

    const resultado = (await crmErpReadStock.handler(
      {
        codigo: "316",
        deposito: undefined,
        somente_visiveis_catalogo: false,
        limite: 50,
      },
      ctx,
    )) as { erro: string; mensagem: string; detalhes: { depositos: unknown[] } };

    expect(resultado.erro).toBe("deposito_ambiguo");
    expect(resultado.mensagem).toMatch(/mais de um depósito/i);
    expect(resultado.detalhes.depositos).toHaveLength(2);
  });

  it("consulta NFe entrega status/chave e disponibilidade de DANFE sem expor URL/XML", async () => {
    vi.mocked(service.obterNotaErp).mockResolvedValue({
      ok: true,
      dados: {
        numero: 64996396,
        codigoStatus: 100,
        mensagemStatus: "Autorizado o uso da NF-e",
        chave: "43261046793999000174550020649963961404794580",
        lote: 89,
        danfeUrl: "https://app.vendaerp.com.br/danfe",
      },
    });

    const resultado = (await crmErpGetInvoice.handler({ codigo_nfe: 64996396 }, ctx)) as {
      nota: Record<string, unknown>;
    };

    expect(resultado.nota).toMatchObject({
      numero: 64996396,
      codigoStatus: 100,
      mensagemStatus: "Autorizado o uso da NF-e",
      lote: 89,
      danfeDisponivel: true,
    });
    expect(resultado.nota).not.toHaveProperty("danfeUrl");
    expect(resultado.nota).not.toHaveProperty("Xml");
    expect(resultado.nota).not.toHaveProperty("xml");
    expect(service.obterNotaErp).toHaveBeenCalledWith(ctx.supabase, ctx.organizationId, 64996396);
  });

  it("cliente sem filtro e pedido sem filtro recusam antes de consultar o ERP", async () => {
    const cliente = (await crmErpSearchCustomers.handler(
      { nome: undefined, cpf_cnpj: undefined, email: undefined, limite: 10, skip: 0 },
      ctx,
    )) as { erro: string };
    expect(cliente.erro).toBe("filtro_obrigatorio");
    expect(customerResolution.resolverClienteVendaErp).not.toHaveBeenCalled();

    const pedido = (await crmErpSearchOrders.handler(
      {
        codigo: undefined,
        cliente: undefined,
        cpf_cnpj: undefined,
        status: undefined,
        numero_nfe: undefined,
        limite: 10,
        skip: 0,
      },
      ctx,
    )) as { erro: string };
    expect(pedido.erro).toBe("filtro_obrigatorio");
    expect(service.buscarPedidosErp).not.toHaveBeenCalled();
  });

  it("429 do provider vira orientação ao agente em vez de exceção crua", async () => {
    vi.mocked(service.obterNotaErp).mockResolvedValue({
      ok: false,
      motivo: "rate_limited",
      status: 429,
    });

    const resultado = (await crmErpGetInvoice.handler({ codigo_nfe: 64996396 }, ctx)) as {
      erro: string;
      mensagem: string;
    };

    expect(resultado.erro).toBe("rate_limited");
    expect(resultado.mensagem).toMatch(/limite de consultas/i);
  });
  it("cliente resolvido devolve contact_id estável sem expor identificadores do provider", async () => {
    vi.mocked(customerResolution.resolverClienteVendaErp).mockResolvedValue({
      status: "resolved",
      contactId: "11111111-1111-4111-8111-111111111111",
      origem: "provider",
      materialized: true,
      externalLabel: "Eco Projetos",
      cliente: {
        id: "erp-42",
        nome: "Eco Projetos",
        nomeFantasia: "Eco Projetos",
        razaoSocial: "ECO PROJETOS LTDA",
        cpfCnpj: "12345678000190",
        email: "financeiro@eco.test",
        telefone: "51999999999",
        celular: null,
        cidade: "Porto Alegre",
        uf: "RS",
      },
    });

    const resultado = (await crmErpSearchCustomers.handler(
      { nome: "Eco Projetos", cpf_cnpj: undefined, email: undefined, cliente_contact_id: undefined, limite: 10, skip: 0 },
      ctx,
    )) as {
      resolucao: { status: string; contact_id: string };
      clientes: Array<Record<string, unknown>>;
    };

    expect(resultado.resolucao).toMatchObject({
      status: "resolved",
      contact_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(resultado.clientes[0]).not.toHaveProperty("id");
    expect(resultado.clientes[0]).not.toHaveProperty("cpfCnpj");
    expect(resultado.clientes[0]).not.toHaveProperty("email");
    expect(resultado.clientes[0]).not.toHaveProperty("telefone");
  });

  it("pedido por contact_id usa rótulo só para transporte e pessoaID como autoridade", async () => {
    vi.mocked(identityLinks.carregarVinculoClienteExterno).mockResolvedValue({
      ok: true,
      vinculo: {
        id: "link-1",
        organizationId: ctx.organizationId,
        contactId: "11111111-1111-4111-8111-111111111111",
        provider: "vendaerp",
        externalId: "erp-42",
        externalLabel: "Eco Projetos",
        externalLabelKey: "eco projetos",
        providerLookupLabel: "ECO PROJETOS LTDA",
        resolutionOrigin: "exact_name",
      },
    });
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: true,
      dados: [
        {
          pedido: {
            id: "pedido-certo", codigo: 10, cliente: "Eco Projetos", status: "Faturado",
            statusSistema: null, total: 100, data: null, finalizado: true, numeroNFe: "55",
            dataFaturamento: null, chaveAcessoNFe: null, danfeUrl: null,
          },
          identidadeCliente: { pessoaId: "erp-42", cpfCnpj: null, email: null },
        } as PedidoErpComIdentidadeInterna,
        {
          pedido: {
            id: "pedido-outro", codigo: 11, cliente: "Homônimo", status: "Faturado",
            statusSistema: null, total: 200, data: null, finalizado: true, numeroNFe: "56",
            dataFaturamento: null, chaveAcessoNFe: null, danfeUrl: null,
          },
          identidadeCliente: { pessoaId: "erp-outro", cpfCnpj: null, email: null },
        } as PedidoErpComIdentidadeInterna,
      ],
    });

    const resultado = (await crmErpSearchOrders.handler(
      {
        codigo: undefined, cliente: undefined, cpf_cnpj: undefined,
        cliente_contact_id: "11111111-1111-4111-8111-111111111111",
        status: undefined, numero_nfe: undefined, limite: 10, skip: 0,
      },
      ctx,
    )) as { pedidos: Array<{ id: string }>; resolucao_cliente: { status: string } };

    expect(service.buscarPedidosErpComIdentidadeInterna).toHaveBeenCalledWith(
      ctx.supabase,
      ctx.organizationId,
      expect.objectContaining({ cliente: "ECO PROJETOS LTDA" }),
    );
    expect(resultado.resolucao_cliente.status).toBe("resolved");
    expect(resultado.pedidos.map((p) => p.id)).toEqual(["pedido-certo"]);
  });

  it("pedido com retorno sem pessoaID correspondente falha fechado", async () => {
    vi.mocked(identityLinks.carregarVinculoClienteExterno).mockResolvedValue({
      ok: true,
      vinculo: {
        id: "link-1", organizationId: ctx.organizationId,
        contactId: "11111111-1111-4111-8111-111111111111", provider: "vendaerp",
        externalId: "erp-42", externalLabel: "Eco Projetos", externalLabelKey: "eco projetos",
        providerLookupLabel: "ECO PROJETOS LTDA", resolutionOrigin: "exact_name",
      },
    });
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: true,
      dados: [{
        pedido: {
          id: "pedido-outro", codigo: 11, cliente: "Eco Projetos", status: "Faturado",
          statusSistema: null, total: 200, data: null, finalizado: true, numeroNFe: null,
          dataFaturamento: null, chaveAcessoNFe: null, danfeUrl: null,
        },
        identidadeCliente: { pessoaId: "erp-outro", cpfCnpj: null, email: null },
      } as PedidoErpComIdentidadeInterna],
    });

    const resultado = (await crmErpSearchOrders.handler(
      {
        codigo: undefined, cliente: undefined, cpf_cnpj: undefined,
        cliente_contact_id: "11111111-1111-4111-8111-111111111111",
        status: undefined, numero_nfe: undefined, limite: 10, skip: 0,
      },
      ctx,
    )) as { erro: string };
    expect(resultado.erro).toBe("identidade_pedido_nao_confirmada");
  });

  it("cliente_contact_id não pode ser misturado com novos sinais de identidade", async () => {
    const resultado = (await crmErpSearchCustomers.handler(
      {
        nome: "Outro cliente",
        cpf_cnpj: undefined,
        email: undefined,
        cliente_contact_id: "11111111-1111-4111-8111-111111111111",
        limite: 10,
        skip: 0,
      },
      ctx,
    )) as { erro: string };

    expect(resultado.erro).toBe("sinais_cliente_conflitantes");
    expect(customerResolution.resolverClienteVendaErp).not.toHaveBeenCalled();
  });

});
