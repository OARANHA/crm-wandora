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
    obterInformacaoFiscalDaVendaErp: vi.fn(),
    obterNotaErp: vi.fn(),
  };
});

vi.mock("@/lib/integracoes-erp/resolucao-cliente-vendaerp", () => ({
  resolverClienteVendaErp: vi.fn(),
  resolverClienteVendaErpPorPedidos: vi.fn(),
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
const { blocosErpResidentes } = await import("@/lib/agent-engine/agent/inbound-turn");

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

  it("espera pedidos em voo, materializa o cliente e bloqueia resolução redundante no mesmo turno", async () => {
    let liberar!: (valor: unknown) => void;
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockImplementation(
      () =>
        new Promise((resolve) => {
          liberar = resolve;
        }) as never,
    );
    vi.mocked(customerResolution.resolverClienteVendaErpPorPedidos).mockResolvedValue({
      status: "resolved",
      contactId: "11111111-1111-4111-8111-111111111111",
      origem: "provider",
      materialized: true,
      externalLabel: "Eco Projetos",
    });
    vi.mocked(customerResolution.resolverClienteVendaErp).mockResolvedValue({
      status: "not_found",
    });

    const turno = { ...ctx, requestId: "req-erp-paralelo" };
    const pedidosPromise = crmErpSearchOrders.handler(
      {
        codigo: undefined,
        cliente: "Eco Projetos",
        cpf_cnpj: undefined,
        cliente_contact_id: undefined,
        status: undefined,
        numero_nfe: undefined,
        limite: 10,
        skip: 0,
      },
      turno,
    );

    await vi.waitFor(() =>
      expect(service.buscarPedidosErpComIdentidadeInterna).toHaveBeenCalledTimes(1),
    );

    const clientePromise = crmErpSearchCustomers.handler(
      {
        nome: "Eco Projetos",
        cpf_cnpj: undefined,
        email: undefined,
        cliente_contact_id: undefined,
        limite: 10,
        skip: 0,
      },
      turno,
    );

    expect(customerResolution.resolverClienteVendaErp).not.toHaveBeenCalled();

    liberar({
      ok: true,
      dados: [
        {
          pedido: {
            id: "pedido-eco-1",
            codigo: 101,
            cliente: "Eco Projetos",
            status: "Faturado",
            statusSistema: "faturado",
            total: 1234.56,
            data: "2026-10-01T12:00:00Z",
            finalizado: true,
            numeroNFe: "9001",
            dataFaturamento: "2026-10-01T13:00:00Z",
            chaveAcessoNFe: null,
            danfeUrl: null,
            urlSefaz: null,
          },
          identidadeCliente: {
            pessoaId: "erp-eco",
            cpfCnpj: "12345678000190",
            email: "financeiro@eco.test",
          },
        } as PedidoErpComIdentidadeInterna,
      ],
    });

    const [pedidos, cliente] = await Promise.all([pedidosPromise, clientePromise]);

    expect(pedidos).toMatchObject({
      resolucao_cliente: {
        status: "resolved",
        contact_id: "11111111-1111-4111-8111-111111111111",
        materializado: true,
      },
      pedidos: [expect.objectContaining({ numeroNFe: "9001" })],
    });
    expect(cliente).toMatchObject({
      erro: "resolucao_cliente_desnecessaria_apos_pedidos",
    });
    expect((cliente as { mensagem: string }).mensagem).toMatch(/use os pedidos já retornados/i);
    expect(customerResolution.resolverClienteVendaErp).not.toHaveBeenCalled();
  });

  it("coordena também quando a resolução de cliente começa antes da busca de pedidos", async () => {
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: true,
      dados: [
        {
          pedido: {
            id: "pedido-eco-inverso",
            codigo: 103,
            cliente: "Eco Projetos",
            status: "Faturado",
            statusSistema: "faturado",
            total: 321,
            data: "2026-10-03T12:00:00Z",
            finalizado: true,
            numeroNFe: "9003",
            dataFaturamento: "2026-10-03T13:00:00Z",
            chaveAcessoNFe: null,
            danfeUrl: null,
            urlSefaz: null,
          },
          identidadeCliente: {
            pessoaId: "erp-eco",
            cpfCnpj: "12345678000190",
            email: "financeiro@eco.test",
          },
        } as PedidoErpComIdentidadeInterna,
      ],
    });
    vi.mocked(customerResolution.resolverClienteVendaErpPorPedidos).mockResolvedValue({
      status: "resolved",
      contactId: "11111111-1111-4111-8111-111111111111",
      origem: "provider",
      materialized: false,
      externalLabel: "Eco Projetos",
    });
    vi.mocked(customerResolution.resolverClienteVendaErp).mockResolvedValue({
      status: "not_found",
    });

    const turno = { ...ctx, requestId: "req-erp-ordem-inversa" };
    const clientePromise = crmErpSearchCustomers.handler(
      {
        nome: "Eco Projetos",
        cpf_cnpj: undefined,
        email: undefined,
        cliente_contact_id: undefined,
        limite: 10,
        skip: 0,
      },
      turno,
    );
    const pedidosPromise = crmErpSearchOrders.handler(
      {
        codigo: undefined,
        cliente: "Eco Projetos",
        cpf_cnpj: undefined,
        cliente_contact_id: undefined,
        status: undefined,
        numero_nfe: undefined,
        limite: 10,
        skip: 0,
      },
      turno,
    );

    const [cliente, pedidos] = await Promise.all([clientePromise, pedidosPromise]);

    expect(pedidos).toMatchObject({
      resolucao_cliente: {
        status: "resolved",
        contact_id: "11111111-1111-4111-8111-111111111111",
      },
      pedidos: [expect.objectContaining({ numeroNFe: "9003" })],
    });
    expect(cliente).toMatchObject({
      erro: "resolucao_cliente_desnecessaria_apos_pedidos",
    });
    expect(customerResolution.resolverClienteVendaErp).not.toHaveBeenCalled();
  });

  it("não expõe pedidos quando a identidade encontrada não pode ser provada", async () => {
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: true,
      dados: [
        {
          pedido: {
            id: "pedido-sem-identidade",
            codigo: 104,
            cliente: "Eco Projetos",
            status: "Faturado",
            statusSistema: "faturado",
            total: 500,
            data: "2026-10-04T12:00:00Z",
            finalizado: true,
            numeroNFe: "9004",
            dataFaturamento: "2026-10-04T13:00:00Z",
            chaveAcessoNFe: null,
            danfeUrl: null,
            urlSefaz: null,
          },
          identidadeCliente: {
            pessoaId: null,
            cpfCnpj: "12345678000190",
            email: "financeiro@eco.test",
          },
        } as PedidoErpComIdentidadeInterna,
      ],
    });
    vi.mocked(customerResolution.resolverClienteVendaErpPorPedidos).mockResolvedValue({
      status: "unresolved",
      motivo: "identidade_pedido_incompleta",
    });

    const resultado = await crmErpSearchOrders.handler(
      {
        codigo: undefined,
        cliente: "Eco Projetos",
        cpf_cnpj: undefined,
        cliente_contact_id: undefined,
        status: undefined,
        numero_nfe: undefined,
        limite: 10,
        skip: 0,
      },
      { ...ctx, requestId: "req-erp-sem-identidade" },
    );

    expect(resultado).toMatchObject({
      erro: "identidade_pedido_nao_confirmada",
      resolucao_cliente: {
        status: "unresolved",
        motivo: "identidade_pedido_incompleta",
      },
    });
    expect(resultado).not.toHaveProperty("pedidos");
    expect(crmErpSearchOrders.motivoDoVazio?.(resultado)).toBe(
      "identidade_pedido_nao_confirmada:identidade_pedido_incompleta",
    );
  });

  it("busca de pedidos vazia libera resolução do mesmo cliente", async () => {
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: true,
      dados: [],
    });
    vi.mocked(customerResolution.resolverClienteVendaErp).mockResolvedValue({
      status: "not_found",
    });

    const turno = { ...ctx, requestId: "req-erp-vazio" };
    const pedidos = await crmErpSearchOrders.handler(
      {
        codigo: undefined,
        cliente: "Eco Projetos",
        cpf_cnpj: undefined,
        cliente_contact_id: undefined,
        status: undefined,
        numero_nfe: undefined,
        limite: 10,
        skip: 0,
      },
      turno,
    );
    const cliente = await crmErpSearchCustomers.handler(
      {
        nome: "Eco Projetos",
        cpf_cnpj: undefined,
        email: undefined,
        cliente_contact_id: undefined,
        limite: 10,
        skip: 0,
      },
      turno,
    );

    expect(pedidos).toEqual({ pedidos: [] });
    expect(customerResolution.resolverClienteVendaErp).toHaveBeenCalledTimes(1);
    expect(cliente).toEqual({ resolucao: { status: "not_found" }, clientes: [] });
  });

  it("pedidos materializados de um nome não bloqueiam resolução de outro cliente", async () => {
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: true,
      dados: [
        {
          pedido: {
            id: "pedido-eco-2",
            codigo: 102,
            cliente: "Eco Projetos",
            status: "Faturado",
            statusSistema: "faturado",
            total: 99,
            data: "2026-10-02T12:00:00Z",
            finalizado: true,
            numeroNFe: "9002",
            dataFaturamento: "2026-10-02T13:00:00Z",
            chaveAcessoNFe: null,
            danfeUrl: null,
            urlSefaz: null,
          },
          identidadeCliente: {
            pessoaId: "erp-eco",
            cpfCnpj: null,
            email: "financeiro@eco.test",
          },
        } as PedidoErpComIdentidadeInterna,
      ],
    });
    vi.mocked(customerResolution.resolverClienteVendaErpPorPedidos).mockResolvedValue({
      status: "resolved",
      contactId: "11111111-1111-4111-8111-111111111111",
      origem: "provider",
      materialized: false,
      externalLabel: "Eco Projetos",
    });
    vi.mocked(customerResolution.resolverClienteVendaErp).mockResolvedValue({
      status: "not_found",
    });

    const turno = { ...ctx, requestId: "req-erp-outro-cliente" };
    await crmErpSearchOrders.handler(
      {
        codigo: undefined,
        cliente: "Eco Projetos",
        cpf_cnpj: undefined,
        cliente_contact_id: undefined,
        status: undefined,
        numero_nfe: undefined,
        limite: 10,
        skip: 0,
      },
      turno,
    );
    await crmErpSearchCustomers.handler(
      {
        nome: "Outra Empresa",
        cpf_cnpj: undefined,
        email: undefined,
        cliente_contact_id: undefined,
        limite: 10,
        skip: 0,
      },
      turno,
    );

    expect(customerResolution.resolverClienteVendaErp).toHaveBeenCalledTimes(1);
  });

  it("últimas notas paginam, enriquecem data fiscal ausente e retornam ranking comprovado", async () => {
    const pedido = (
      codigo: number,
      numeroNFe: string | null,
      dataFaturamento: string | null,
    ): PedidoErpComIdentidadeInterna => ({
      pedido: {
        id: "pedido-" + codigo,
        codigo,
        cliente: "Eco Projetos",
        status: "Faturado",
        statusSistema: "faturado",
        total: codigo,
        data: "2026-09-01T10:00:00Z",
        finalizado: true,
        numeroNFe,
        dataFaturamento,
        chaveAcessoNFe: null,
        danfeUrl: numeroNFe ? "https://erp.example/danfe-" + numeroNFe : null,
        urlSefaz: null,
      },
      identidadeCliente: {
        pessoaId: "erp-eco",
        cpfCnpj: "12345678000190",
        email: "financeiro@eco.test",
      },
    });

    const primeiraPagina = Array.from({ length: 100 }, (_, i) =>
      pedido(1000 + i, String(8000 + i), "2026-10-01T10:00:00Z"),
    );
    primeiraPagina[10] = pedido(1010, "9010", null);
    primeiraPagina[11] = pedido(1011, null, "2026-10-08T12:00:00Z");
    const segundaPagina = [
      pedido(2001, "9998", "2026-10-06T09:00:00Z"),
      pedido(2002, "9999", "2026-10-07T09:00:00Z"),
    ];

    vi.mocked(service.buscarPedidosErpComIdentidadeInterna)
      .mockResolvedValueOnce({ ok: true, dados: primeiraPagina })
      .mockResolvedValueOnce({ ok: true, dados: segundaPagina });
    vi.mocked(service.obterInformacaoFiscalDaVendaErp).mockResolvedValue({
      ok: true,
      dados: {
        tipo: "NFe",
        numero: 9010,
        serie: "1",
        chave: null,
        dataEmissao: "07/10/2026 - 14:30",
        danfeUrl: "https://erp.example/danfe-9010",
      },
    });
    vi.mocked(customerResolution.resolverClienteVendaErpPorPedidos).mockResolvedValue({
      status: "resolved",
      contactId: "11111111-1111-4111-8111-111111111111",
      origem: "provider",
      materialized: false,
      externalLabel: "Eco Projetos",
    });

    const resultado = (await crmErpSearchOrders.handler(
      {
        codigo: undefined,
        cliente: "Eco Projetos",
        cpf_cnpj: undefined,
        cliente_contact_id: undefined,
        status: undefined,
        numero_nfe: undefined,
        ultimas_notas: 2,
        limite: 10,
        skip: 0,
      },
      { ...ctx, requestId: "req-ultimas-notas" },
    )) as {
      pedidos: Array<{ numeroNFe: string | null }>;
      resumo: {
        quantidadeEncontrada: number;
        quantidadeRetornada: number;
        resultadoCompleto: boolean;
      };
    };

    expect(resultado.pedidos.map((item) => item.numeroNFe)).toEqual(["9010", "9999"]);
    expect(resultado.resumo).toEqual({
      quantidadeEncontrada: 101,
      quantidadeRetornada: 2,
      resultadoCompleto: true,
    });
    expect(service.buscarPedidosErpComIdentidadeInterna).toHaveBeenNthCalledWith(
      1,
      ctx.supabase,
      ctx.organizationId,
      expect.objectContaining({
        cliente: "Eco Projetos",
        pageSize: 100,
        skip: 0,
      }),
    );
    expect(service.buscarPedidosErpComIdentidadeInterna).toHaveBeenNthCalledWith(
      2,
      ctx.supabase,
      ctx.organizationId,
      expect.objectContaining({ pageSize: 100, skip: 100 }),
    );
    expect(
      vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mock.calls[0]?.[2],
    ).not.toHaveProperty("possuiNotaFiscal");
    expect(
      vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mock.calls[1]?.[2],
    ).not.toHaveProperty("possuiNotaFiscal");
    expect(service.obterInformacaoFiscalDaVendaErp).toHaveBeenCalledWith(
      ctx.supabase,
      ctx.organizationId,
      1010,
    );
    expect(customerResolution.resolverClienteVendaErpPorPedidos).toHaveBeenCalledTimes(1);
  });

  it("últimas notas falham fechado se nem a visão fiscal provar a data ausente", async () => {
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: true,
      dados: [
        {
          pedido: {
            id: "pedido-sem-data",
            codigo: 500,
            cliente: "Eco Projetos",
            status: "Faturado",
            statusSistema: "faturado",
            total: 500,
            data: "2026-10-01T10:00:00Z",
            finalizado: true,
            numeroNFe: "9500",
            dataFaturamento: null,
            chaveAcessoNFe: null,
            danfeUrl: "https://erp.example/danfe-9500",
            urlSefaz: null,
          },
          identidadeCliente: {
            pessoaId: "erp-eco",
            cpfCnpj: "12345678000190",
            email: "financeiro@eco.test",
          },
        },
      ],
    });
    vi.mocked(customerResolution.resolverClienteVendaErpPorPedidos).mockResolvedValue({
      status: "resolved",
      contactId: "11111111-1111-4111-8111-111111111111",
      origem: "provider",
      materialized: false,
      externalLabel: "Eco Projetos",
    });
    vi.mocked(service.obterInformacaoFiscalDaVendaErp).mockResolvedValue({
      ok: true,
      dados: {
        tipo: "NFe",
        numero: 9500,
        serie: "1",
        chave: null,
        dataEmissao: null,
        danfeUrl: null,
      },
    });

    const resultado = await crmErpSearchOrders.handler(
      {
        codigo: undefined,
        cliente: "Eco Projetos",
        cpf_cnpj: undefined,
        cliente_contact_id: undefined,
        status: undefined,
        numero_nfe: undefined,
        ultimas_notas: 2,
        limite: 10,
        skip: 0,
      },
      { ...ctx, requestId: "req-ultimas-sem-data" },
    );

    expect(resultado).toMatchObject({
      erro: "data_faturamento_indisponivel",
    });
    expect(resultado).not.toHaveProperty("pedidos");
  });

  it("últimas notas com DANFE ensinam prepare e send sequenciais no próprio turno", () => {
    const [bloco] = blocosErpResidentes([
      "crm_erp_search_orders",
      "crm_erp_get_invoice",
      "crm_erp_prepare_admin_danfe",
    ]);
    if (bloco === undefined) throw new Error("bloco ERP ausente");

    expect(bloco).toContain("ultimas_notas=N");
    expect(bloco).toMatch(/última nota|últimas N notas/);
    expect(bloco).toContain("crm_erp_prepare_admin_danfe");
    expect(bloco).toContain("IMEDIATAMENTE depois send_message");
    expect(bloco).toMatch(/Não prepare duas DANFEs seguidas/i);
  });

  it("pedido ou nota por nome usa pedidos diretamente sem exigir resolução prévia do cliente", () => {
    const [bloco] = blocosErpResidentes([
      "crm_erp_search_customers",
      "crm_erp_search_orders",
      "crm_erp_get_invoice",
    ]);

    expect(bloco).toContain("crm_erp_search_orders");
    expect(bloco).toContain("DIRETAMENTE");
    expect(bloco).toContain("nome");
    expect(bloco).toContain("razão social");
    expect(bloco).toContain("crm_erp_search_customers");
    expect(bloco).toMatch(/não .*pré-requisito/i);
    expect(crmErpSearchOrders.description).toMatch(/DIRETAMENTE/);
    expect(crmErpSearchOrders.description).toMatch(/NÃO é pré-requisito/);
  });

  it("bloco ERP só nomeia ferramentas realmente presentes no turno", () => {
    expect(blocosErpResidentes(["crm_erp_search_customers", "crm_erp_get_invoice"])).toEqual([]);

    const [bloco] = blocosErpResidentes(["crm_erp_search_orders"]);
    if (bloco === undefined) throw new Error("bloco ERP ausente");
    const nomeadas = [...bloco.matchAll(/crm_erp_[a-z_]+/g)].map((m) => m[0]);
    expect(new Set(nomeadas)).toEqual(new Set(["crm_erp_search_orders"]));
  });

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
      {
        nome: "Eco Projetos",
        cpf_cnpj: undefined,
        email: undefined,
        cliente_contact_id: undefined,
        limite: 10,
        skip: 0,
      },
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
            id: "pedido-certo",
            codigo: 10,
            cliente: "Eco Projetos",
            status: "Faturado",
            statusSistema: null,
            total: 100,
            data: null,
            finalizado: true,
            numeroNFe: "55",
            dataFaturamento: null,
            chaveAcessoNFe: null,
            danfeUrl: null,
            urlSefaz: null,
          },
          identidadeCliente: { pessoaId: "erp-42", cpfCnpj: null, email: null },
        } as PedidoErpComIdentidadeInterna,
        {
          pedido: {
            id: "pedido-outro",
            codigo: 11,
            cliente: "Homônimo",
            status: "Faturado",
            statusSistema: null,
            total: 200,
            data: null,
            finalizado: true,
            numeroNFe: "56",
            dataFaturamento: null,
            chaveAcessoNFe: null,
            danfeUrl: null,
            urlSefaz: null,
          },
          identidadeCliente: { pessoaId: "erp-outro", cpfCnpj: null, email: null },
        } as PedidoErpComIdentidadeInterna,
      ],
    });

    const resultado = (await crmErpSearchOrders.handler(
      {
        codigo: undefined,
        cliente: undefined,
        cpf_cnpj: undefined,
        cliente_contact_id: "11111111-1111-4111-8111-111111111111",
        status: undefined,
        numero_nfe: undefined,
        limite: 10,
        skip: 0,
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
            id: "pedido-outro",
            codigo: 11,
            cliente: "Eco Projetos",
            status: "Faturado",
            statusSistema: null,
            total: 200,
            data: null,
            finalizado: true,
            numeroNFe: null,
            dataFaturamento: null,
            chaveAcessoNFe: null,
            danfeUrl: null,
            urlSefaz: null,
          },
          identidadeCliente: { pessoaId: "erp-outro", cpfCnpj: null, email: null },
        } as PedidoErpComIdentidadeInterna,
      ],
    });

    const resultado = (await crmErpSearchOrders.handler(
      {
        codigo: undefined,
        cliente: undefined,
        cpf_cnpj: undefined,
        cliente_contact_id: "11111111-1111-4111-8111-111111111111",
        status: undefined,
        numero_nfe: undefined,
        limite: 10,
        skip: 0,
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

  it("cadastros parecidos nunca viram resposta de que o cliente não existe", async () => {
    vi.mocked(customerResolution.resolverClienteVendaErp).mockResolvedValue({
      status: "unresolved",
      motivo: "sem_correspondencia_exata",
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

    const resultado = (await crmErpSearchCustomers.handler(
      {
        nome: "Eco Projetos",
        cpf_cnpj: undefined,
        email: undefined,
        cliente_contact_id: undefined,
        limite: 10,
        skip: 0,
      },
      ctx,
    )) as { erro: string; mensagem: string; candidatos: unknown[] };

    expect(resultado.erro).toBe("sem_correspondencia_exata");
    expect(resultado.mensagem).toMatch(/não diga que o cliente não existe/i);
    expect(resultado.mensagem).toMatch(/mostre os candidatos/i);
    expect(resultado.candidatos).toHaveLength(1);
  });

  it("ambiguidade, ausência e erro de provider permanecem estados diferentes", async () => {
    vi.mocked(customerResolution.resolverClienteVendaErp).mockResolvedValueOnce({
      status: "ambiguous",
      motivo: "mais_de_um_cliente_exato",
      candidatos: [
        {
          nome: "Eco Projetos",
          nomeFantasia: "Eco Projetos",
          razaoSocial: "ECO A LTDA",
          cidade: "POA",
          uf: "RS",
        },
        {
          nome: "Eco Projetos",
          nomeFantasia: "Eco Projetos",
          razaoSocial: "ECO B LTDA",
          cidade: "POA",
          uf: "RS",
        },
      ],
    });
    const ambiguo = (await crmErpSearchCustomers.handler(
      {
        nome: "Eco Projetos",
        cpf_cnpj: undefined,
        email: undefined,
        cliente_contact_id: undefined,
        limite: 10,
        skip: 0,
      },
      ctx,
    )) as { resolucao: { status: string }; candidatos: unknown[] };
    expect(ambiguo.resolucao.status).toBe("ambiguous");
    expect(ambiguo.candidatos).toHaveLength(2);

    vi.mocked(customerResolution.resolverClienteVendaErp).mockResolvedValueOnce({
      status: "not_found",
    });
    const ausente = (await crmErpSearchCustomers.handler(
      {
        nome: "Inexistente",
        cpf_cnpj: undefined,
        email: undefined,
        cliente_contact_id: undefined,
        limite: 10,
        skip: 0,
      },
      ctx,
    )) as { resolucao: { status: string }; clientes: unknown[] };
    expect(ausente.resolucao.status).toBe("not_found");
    expect(ausente.clientes).toEqual([]);

    vi.mocked(customerResolution.resolverClienteVendaErp).mockResolvedValueOnce({
      status: "unresolved",
      motivo: "provider_error",
      motivoProvider: "timeout",
    });
    const falhou = (await crmErpSearchCustomers.handler(
      {
        nome: "Eco Projetos",
        cpf_cnpj: undefined,
        email: undefined,
        cliente_contact_id: undefined,
        limite: 10,
        skip: 0,
      },
      ctx,
    )) as { erro: string; resolucao: { status: string; motivo: string } };
    expect(falhou.erro).toBe("timeout");
    expect(falhou.resolucao).toEqual({ status: "unresolved", motivo: "provider_error" });
  });
});
