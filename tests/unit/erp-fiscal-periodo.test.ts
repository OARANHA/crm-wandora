import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { McpContext } from "@/lib/mcp/types";

vi.mock("@/lib/integracoes-erp/service", () => ({
  buscarNfesPeriodoErp: vi.fn(),
  buscarClientesErp: vi.fn(),
}));
vi.mock("@/lib/integracoes-erp/resolucao-cliente-vendaerp", () => ({
  resolverClienteVendaErp: vi.fn(),
}));
vi.mock("@/lib/integracoes-erp/identidade-externa-cliente", () => ({
  carregarVinculoClienteExterno: vi.fn(),
}));

const service = await import("@/lib/integracoes-erp/service");
const resolver = await import("@/lib/integracoes-erp/resolucao-cliente-vendaerp");
const { normalizarNfesPeriodoVendaErp, selecionarNotasRecentes } =
  await import("@/lib/integracoes-erp/notas-fiscais-periodo");
const { buscarUltimasNfesFiscais } =
  await import("@/lib/integracoes-erp/busca-notas-recentes-fiscais");
const { crmErpSearchRecentInvoices } = await import("@/lib/mcp/tools/notas-recentes-fiscais");

const db = {} as SupabaseClient;
const org = "org-test";
const target = "12345678000195";
const other = "11222333000181";
function entrada(numero: number, data: string, doc = target) {
  return {
    Tipo: "NFe",
    Numero: numero,
    Serie: "02",
    ChaveAcesso: String(numero).padStart(44, "0"),
    DataEmissao: data,
    UrlImpressaoUrl: "https://app.example.test/documento",
    XML:
      "<nfeProc><NFe><infNFe><dest><CNPJ>" +
      doc +
      "</CNPJ><xNome>Empresa de teste</xNome></dest></infNFe></NFe>" +
      "<protNFe><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>",
  };
}
const ctx: McpContext = {
  organizationId: org,
  role: "agent",
  actor: { type: "ai_agent", id: "agent-test", role: "ai_operator" },
  apiTokenId: "token-test",
  requestId: "request-test",
  supabase: db,
};

describe("VendaERP — busca fiscal regressiva READ-ONLY", () => {
  beforeEach(() => vi.clearAllMocks());

  it("projeta NFe sem XML, sem URL, e classifica por emissão real, não por número", () => {
    const notas = normalizarNfesPeriodoVendaErp([
      entrada(99, "03/08/2026 - 17:40"),
      entrada(10, "04/08/2026 - 13:45"),
      entrada(12, "04/08/2026 - 13:35"),
      entrada(101, "04/08/2026 - 13:50", other),
    ]);
    const duas = selecionarNotasRecentes(notas, 2, target);
    expect(duas.map((n) => n.numero)).toEqual([10, 12]);
    expect(JSON.stringify(duas)).not.toMatch(/XML|UrlImpressaoUrl|Empresa de teste/);
    expect(duas[0]?.documentoDestinatario).toBe(target);
  });

  it("falha fechado quando a resposta omite documento ou data fiscal válida", () => {
    expect(() => normalizarNfesPeriodoVendaErp([{ ...entrada(1, "31/02/2026 - 12:00") }])).toThrow(
      "invalid_response",
    );
    expect(() =>
      normalizarNfesPeriodoVendaErp([{ ...entrada(1, "03/08/2026 - 12:00"), XML: "" }]),
    ).toThrow("invalid_response");
  });

  it("últimas cinco sem mês: percorre período, ordena e retorna cinco NFes distintas", async () => {
    vi.mocked(service.buscarNfesPeriodoErp).mockResolvedValueOnce({
      ok: true,
      dados: {
        notas: normalizarNfesPeriodoVendaErp([
          entrada(10, "08/10/2026 - 08:00"),
          entrada(11, "08/10/2026 - 09:00"),
          entrada(12, "08/10/2026 - 11:00"),
          entrada(13, "08/10/2026 - 10:00"),
          entrada(14, "08/10/2026 - 13:00"),
        ]),
        retornados: 5,
      },
    }).mockResolvedValueOnce({ ok: true, dados: { notas: [], retornados: 0 } });
    const r = await buscarUltimasNfesFiscais(db, org, {
      quantidade: 5,
      documento: target,
      agora: new Date("2026-10-08T15:00:00Z"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dados.notas.map((n) => n.numero)).toEqual([14, 12, 13, 11, 10]);
      expect(r.dados.quantidadeSolicitada).toBe(5);
      expect(r.dados.mesesConsultados).toEqual(["2026-10", "2026-09"]);
      expect(r.dados.periodoConsultado).toEqual({ dataInicio: "2026-09-09", dataFim: "2026-10-08" });
      expect(r.dados.consultaCompleta).toBe(true);
    }
    expect(service.buscarNfesPeriodoErp).toHaveBeenCalledTimes(2);
    expect(vi.mocked(service.buscarNfesPeriodoErp).mock.calls[0]?.[2]).toMatchObject({
      dataInicial: "10-01-2026",
      dataFinal: "10-08-2026",
      pageSize: 50,
      skip: 0,
    });
    expect(vi.mocked(service.buscarNfesPeriodoErp).mock.calls[1]?.[2]).toMatchObject({
      dataInicial: "09-09-2026", dataFinal: "09-30-2026", pageSize: 50, skip: 0,
    });
  });

  it("a tool da ISIS aceita cinco sem mes_ano e nunca devolve XML ou URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T15:00:00Z"));
    try {
      vi.mocked(service.buscarNfesPeriodoErp).mockResolvedValueOnce({
        ok: true,
        dados: {
          notas: normalizarNfesPeriodoVendaErp([
            entrada(1, "08/10/2026 - 09:00"),
            entrada(2, "08/10/2026 - 09:10"),
            entrada(3, "08/10/2026 - 09:20"),
            entrada(4, "08/10/2026 - 09:30"),
            entrada(5, "08/10/2026 - 09:40"),
          ]),
          retornados: 5,
        },
      }).mockResolvedValueOnce({ ok: true, dados: { notas: [], retornados: 0 } });
      const r = await crmErpSearchRecentInvoices.handler(
        {
          quantidade: 5,
          cliente: undefined,
          cpf_cnpj: undefined,
          cliente_contact_id: undefined,
          mes_ano: undefined,
        },
        ctx,
      );
      expect(r).toMatchObject({
        resumo: { quantidadeSolicitada: 5, quantidadeRetornada: 5, consultaCompleta: true },
      });
      expect((r as { notas: Array<{ numeroNFe: string }> }).notas.map((n) => n.numeroNFe)).toEqual([
        "5",
        "4",
        "3",
        "2",
        "1",
      ]);
      expect(JSON.stringify(r)).not.toMatch(/<nfeProc|UrlImpressaoUrl|app\.example\.test/);
      expect(service.buscarNfesPeriodoErp).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cinco NFes sem mês falham fechado quando a paginação mensal excede o teto", async () => {
    vi.mocked(service.buscarNfesPeriodoErp).mockResolvedValue({
      ok: true,
      dados: { notas: [], retornados: 50 },
    });
    const r = await buscarUltimasNfesFiscais(db, org, {
      quantidade: 5,
      agora: new Date("2026-10-08T15:00:00Z"),
    });
    expect(r).toMatchObject({ ok: false, motivo: "consulta_parcial" });
    expect(service.buscarNfesPeriodoErp).toHaveBeenCalledTimes(12);
  });

  it("30 dias vazios não retrocedem para agosto: consulta vazia comprovada", async () => {
    vi.mocked(service.buscarNfesPeriodoErp).mockResolvedValue({
      ok: true, dados: { notas: [], retornados: 0 },
    });
    const r = await buscarUltimasNfesFiscais(db, org, {
      quantidade: 2, documento: target, agora: new Date("2026-10-08T14:00:00Z"),
    });
    expect(r).toMatchObject({
      ok: true,
      dados: {
        notas: [], consultaCompleta: true,
        mesesConsultados: ["2026-10", "2026-09"],
        periodoConsultado: { dataInicio: "2026-09-09", dataFim: "2026-10-08" },
      },
    });
    expect(vi.mocked(service.buscarNfesPeriodoErp).mock.calls.map(([, , filtros]) => [
      filtros.dataInicial, filtros.dataFinal,
    ])).toEqual([
      ["10-01-2026", "10-08-2026"],
      ["09-09-2026", "09-30-2026"],
    ]);
  });

  it("recusa período explícito de 31 dias sem chamar ERP; mês com 31 dias é repartido", async () => {
    const recusado = await buscarUltimasNfesFiscais(db, org, {
      quantidade: 1, dataInicio: "2026-09-01", dataFim: "2026-10-01",
      agora: new Date("2026-10-08T14:00:00Z"),
    });
    expect(recusado).toMatchObject({ ok: false, motivo: "periodo_excede_limite" });
    expect(service.buscarNfesPeriodoErp).not.toHaveBeenCalled();
    vi.mocked(service.buscarNfesPeriodoErp).mockResolvedValue({
      ok: true, dados: { notas: [], retornados: 0 },
    });
    const mes = await buscarUltimasNfesFiscais(db, org, {
      quantidade: 1, mesAno: "2026-08", agora: new Date("2026-10-08T14:00:00Z"),
    });
    expect(mes.ok).toBe(true);
    expect(vi.mocked(service.buscarNfesPeriodoErp).mock.calls.map(([, , filtros]) => [
      filtros.dataInicial, filtros.dataFinal,
    ])).toEqual([
      ["08-02-2026", "08-31-2026"],
      ["08-01-2026", "08-01-2026"],
    ]);
  });

  it("consulta NFe de dia exato sem ampliar, mantendo seleção fiscal", async () => {
    vi.mocked(service.buscarNfesPeriodoErp).mockResolvedValueOnce({
      ok: true, dados: {
        notas: normalizarNfesPeriodoVendaErp([entrada(41, "08/10/2026 - 11:00")]),
        retornados: 1,
      },
    });
    const r = await buscarUltimasNfesFiscais(db, org, {
      quantidade: 1, dataInicio: "2026-10-08", dataFim: "2026-10-08",
      agora: new Date("2026-10-08T15:00:00Z"),
    });
    expect(r).toMatchObject({
      ok: true,
      dados: { notas: [expect.objectContaining({ numero: 41 })] },
    });
    expect(vi.mocked(service.buscarNfesPeriodoErp).mock.calls.map(([, , f]) => [
      f.dataInicial, f.dataFinal,
    ])).toEqual([["10-08-2026", "10-08-2026"]]);
  });

  it("GET incompleto ou retorno fora da data pesquisada nunca comprova ausência", async () => {
    vi.mocked(service.buscarNfesPeriodoErp).mockResolvedValue({ ok: true, dados: { notas: [], retornados: 50 } });
    const incompleto = await buscarUltimasNfesFiscais(db, org, {
      quantidade: 1, dataInicio: "2026-10-08", dataFim: "2026-10-08",
      agora: new Date("2026-10-08T15:00:00Z"),
    });
    expect(incompleto).toMatchObject({ ok: false, motivo: "consulta_parcial" });
    vi.mocked(service.buscarNfesPeriodoErp).mockReset();
    vi.mocked(service.buscarNfesPeriodoErp).mockResolvedValue({
      ok: true, dados: {
        notas: normalizarNfesPeriodoVendaErp([entrada(41, "07/10/2026 - 11:00")]),
        retornados: 1,
      },
    });
    const inconsistente = await buscarUltimasNfesFiscais(db, org, {
      quantidade: 1, dataInicio: "2026-10-08", dataFim: "2026-10-08",
      agora: new Date("2026-10-08T15:00:00Z"),
    });
    expect(inconsistente).toMatchObject({ ok: false, motivo: "consulta_inconsistente" });
  });

  it("página cheia não prova fim: percorre o restante do mês antes de selecionar", async () => {
    const lote = normalizarNfesPeriodoVendaErp([entrada(11, "04/08/2026 - 13:35")]);
    vi.mocked(service.buscarNfesPeriodoErp)
      .mockResolvedValueOnce({ ok: true, dados: { notas: lote, retornados: 50 } })
      .mockResolvedValueOnce({ ok: true, dados: { notas: [], retornados: 0 } });
    const r = await buscarUltimasNfesFiscais(db, org, {
      quantidade: 1,
      mesAno: "2026-08",
      agora: new Date("2026-10-08T14:00:00Z"),
    });
    expect(r.ok).toBe(true);
    expect(vi.mocked(service.buscarNfesPeriodoErp).mock.calls.map(([, , f]) => f.skip)).toEqual([
      0, 50,
    ]);
  });

  it("ISIS resolve pelo cadastro ERP e envia somente metadados fiscais", async () => {
    vi.mocked(resolver.resolverClienteVendaErp).mockResolvedValue({
      status: "resolved",
      contactId: "11111111-1111-4111-8111-111111111111",
      origem: "provider",
      materialized: false,
      externalLabel: "Empresa de teste",
      cliente: {
        id: "erp-01",
        nome: "Empresa de teste",
        nomeFantasia: "Empresa de teste",
        razaoSocial: "Empresa de teste",
        cpfCnpj: target,
        email: null,
        telefone: null,
        celular: null,
        cidade: null,
        uf: null,
      },
    });
    vi.mocked(service.buscarNfesPeriodoErp).mockResolvedValue({
      ok: true,
      dados: {
        notas: normalizarNfesPeriodoVendaErp([entrada(21, "04/08/2026 - 13:45")]),
        retornados: 1,
      },
    });
    const resposta = await crmErpSearchRecentInvoices.handler(
      {
        quantidade: 1,
        cliente: "Empresa de teste",
        cpf_cnpj: undefined,
        cliente_contact_id: undefined,
        mes_ano: undefined,
        data_inicio: "2026-08-04",
        data_fim: "2026-08-04",
      },
      ctx,
    );
    expect(resposta).toMatchObject({
      resolucao_cliente: { status: "resolved" },
      notas: [expect.objectContaining({ numeroNFe: "21", dataEmissao: "04/08/2026 - 13:45" })],
    });
    expect(JSON.stringify(resposta)).not.toMatch(/12345678000195|XML|UrlImpressaoUrl/);
  });
});
