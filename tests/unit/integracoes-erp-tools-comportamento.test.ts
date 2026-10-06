import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import type * as ErpService from "@/lib/integracoes-erp/service";
import type { McpContext } from "@/lib/mcp/types";

vi.mock("@/lib/integracoes-erp/service", async (original) => {
  const real = await original<typeof ErpService>();
  return {
    ...real,
    buscarProdutosErp: vi.fn(),
    buscarClientesErp: vi.fn(),
    buscarPedidosErp: vi.fn(),
    lerEstoqueErp: vi.fn(),
    obterNotaErp: vi.fn(),
  };
});

const service = await import("@/lib/integracoes-erp/service");
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
    expect(service.buscarClientesErp).not.toHaveBeenCalled();

    const pedido = (await crmErpSearchOrders.handler(
      {
        codigo: undefined,
        cliente: undefined,
        cpf_cnpj: undefined,
        status: undefined,
        numero_nfe: undefined,
        ultimas_notas: undefined,
        data_inicial: undefined,
        data_final: undefined,
        somente_com_nfe: false,
        somente_sem_nfe: false,
        somente_faturados: false,
        somente_finalizados: false,
        ordenar_por: undefined,
        limite: 10,
        skip: 0,
      },
      ctx,
    )) as { erro: string };
    expect(pedido.erro).toBe("filtro_obrigatorio");
    expect(service.buscarPedidosErp).not.toHaveBeenCalled();
  });

  it("o mesmo texto cru do PAR pode chamar a capability direto", async () => {
    const textoCru = "Quais as últimas 2 notas da Eco Projetos?";
    vi.mocked(service.buscarPedidosErp).mockResolvedValue({
      ok: true,
      dados: [
        {
          id: "p-1",
          codigo: 1,
          cliente: "Eco Projetos",
          status: "Faturado",
          statusSistema: null,
          total: 100,
          data: "2026-10-01T10:00:00Z",
          finalizado: true,
          numeroNFe: "9001",
          dataFaturamento: "2026-10-01T10:00:00Z",
          chaveAcessoNFe: null,
          danfeUrl: null,
          urlSefaz: null,
        },
        {
          id: "p-3",
          codigo: 3,
          cliente: "Eco Projetos",
          status: "Faturado",
          statusSistema: null,
          total: 300,
          data: "2026-10-03T10:00:00Z",
          finalizado: true,
          numeroNFe: "9003",
          dataFaturamento: "2026-10-03T10:00:00Z",
          chaveAcessoNFe: null,
          danfeUrl: null,
          urlSefaz: null,
        },
        {
          id: "p-2",
          codigo: 2,
          cliente: "Eco Projetos",
          status: "Faturado",
          statusSistema: null,
          total: 200,
          data: "2026-10-02T10:00:00Z",
          finalizado: true,
          numeroNFe: "9002",
          dataFaturamento: "2026-10-02T10:00:00Z",
          chaveAcessoNFe: null,
          danfeUrl: null,
          urlSefaz: null,
        },
      ],
    });

    const entrada = z.object(crmErpSearchOrders.inputSchema).parse({ consulta: textoCru });
    const resultado = (await crmErpSearchOrders.handler(entrada, ctx)) as {
      pedidos: Array<{ numeroNFe: string | null }>;
    };

    expect(resultado.pedidos.map((pedido) => pedido.numeroNFe)).toEqual(["9003", "9002"]);
    expect(service.buscarPedidosErp).toHaveBeenCalledWith(
      ctx.supabase,
      ctx.organizationId,
      expect.objectContaining({
        cliente: "Eco Projetos",
        possuiNotaFiscal: true,
        pageSize: 100,
        skip: 0,
      }),
    );
    expect(crmErpSearchOrders.redigirParaAuditoria?.({ consulta: textoCru })).toEqual({
      consulta: "[redigido]",
    });
    expect(crmErpSearchOrders.description).toMatch(/frase inteira/i);
  });

  it("texto cru fora do padrão coberto não vira filtro inventado", async () => {
    const entrada = z
      .object(crmErpSearchOrders.inputSchema)
      .parse({ consulta: "Me mostra os negócios que você achar interessantes" });

    const resultado = (await crmErpSearchOrders.handler(entrada, ctx)) as {
      erro: string;
    };

    expect(resultado.erro).toBe("filtro_obrigatorio");
    expect(service.buscarPedidosErp).not.toHaveBeenCalled();
  });

  it("últimas notas usam data de faturamento e paginam antes de ordenar", async () => {
    const antigos = Array.from({ length: 100 }, (_, indice) => ({
      id: `p-antigo-${indice}`,
      codigo: 1000 + indice,
      cliente: "Eco Projetos",
      status: "Faturado",
      statusSistema: null,
      total: 100,
      data: "2026-10-01T10:00:00Z",
      finalizado: true,
      numeroNFe: String(9000 + indice),
      dataFaturamento: "2026-10-01T10:00:00Z",
      chaveAcessoNFe: null,
      danfeUrl: null,
      urlSefaz: null,
    }));
    const recente = {
      id: "p-recente",
      codigo: 2000,
      cliente: "Eco Projetos",
      status: "Faturado",
      statusSistema: null,
      total: 300,
      data: "2026-10-02T10:00:00Z",
      finalizado: true,
      numeroNFe: "9999",
      dataFaturamento: "2026-10-30T10:00:00Z",
      chaveAcessoNFe: null,
      danfeUrl: "https://erp.example/danfe-9999",
      urlSefaz: null,
    };

    vi.mocked(service.buscarPedidosErp)
      .mockResolvedValueOnce({ ok: true, dados: antigos })
      .mockResolvedValueOnce({ ok: true, dados: [recente] });

    const resultado = (await crmErpSearchOrders.handler(
      {
        codigo: undefined,
        cliente: "Eco Projetos",
        cpf_cnpj: undefined,
        status: undefined,
        numero_nfe: undefined,
        ultimas_notas: 2,
        data_inicial: "2026-10-01",
        data_final: "2026-10-31",
        somente_com_nfe: false,
        somente_sem_nfe: false,
        somente_faturados: false,
        somente_finalizados: false,
        ordenar_por: undefined,
        limite: 10,
        skip: 0,
      },
      ctx,
    )) as {
      pedidos: Array<{ numeroNFe: string | null }>;
      resumo: {
        quantidadeEncontrada: number;
        quantidadeRetornada: number;
        resultadoCompleto: boolean;
      };
    };

    expect(resultado.pedidos[0]?.numeroNFe).toBe("9999");
    expect(resultado.resumo).toMatchObject({
      quantidadeEncontrada: 101,
      quantidadeRetornada: 2,
      resultadoCompleto: true,
    });
    expect(service.buscarPedidosErp).toHaveBeenNthCalledWith(
      1,
      ctx.supabase,
      ctx.organizationId,
      expect.objectContaining({
        cliente: "Eco Projetos",
        possuiNotaFiscal: true,
        dataInicial: "2026-10-01",
        dataFinal: "2026-10-31",
        dataReferencia: "faturamento",
        pageSize: 100,
        skip: 0,
      }),
    );
    expect(service.buscarPedidosErp).toHaveBeenNthCalledWith(
      2,
      ctx.supabase,
      ctx.organizationId,
      expect.objectContaining({ pageSize: 100, skip: 100 }),
    );
    expect(crmErpSearchOrders.description).toMatch(/mesmo turno/i);
    expect(crmErpSearchOrders.description).not.toMatch(/VendaERP/i);
  });

  it("período de pedido sem NFe usa data de cadastro e ordenação só depois da varredura", async () => {
    vi.mocked(service.buscarPedidosErp).mockResolvedValue({
      ok: true,