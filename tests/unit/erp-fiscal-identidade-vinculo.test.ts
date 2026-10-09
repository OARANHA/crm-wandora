import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/integracoes-erp/service", () => ({
  buscarClientesErp: vi.fn(),
  buscarPedidosErpComIdentidadeInterna: vi.fn(),
}));

const service = await import("@/lib/integracoes-erp/service");
const { comprovarDocumentoFiscalDoVinculo, documentoFiscalValido } =
  await import("@/lib/integracoes-erp/identidade-fiscal-vinculo");
const db = {} as SupabaseClient;
const org = "org-ficticia";
const vinculo = { externalId: "erp-id-42", providerLookupLabel: "EMPRESA EXEMPLO LTDA" };
const documento = "12345678000195";

function pedido(pessoaId = vinculo.externalId, cpfCnpj: string | null = documento) {
  return {
    pedido: { id: null, codigo: 1, cliente: "Empresa Exemplo", status: null,
      statusSistema: null, total: null, data: null, finalizado: null,
      numeroNFe: null, dataFaturamento: null, chaveAcessoNFe: null,
      danfeUrl: null, urlSefaz: null },
    identidadeCliente: { pessoaId, cpfCnpj, email: null },
  };
}

describe("identidade fiscal dos vínculos VendaERP antigos", () => {
  it("exige dígitos verificadores válidos no CNPJ antes de aceitar filtro fiscal", () => {
    expect(documentoFiscalValido("12.345.678/0001-95")).toBe(documento);
    expect(documentoFiscalValido("12.345.678/0001-90")).toBeNull();
    expect(documentoFiscalValido("00.000.000/0000-00")).toBeNull();
  });

  it("rejeita CNPJ inválido mesmo quando o ID da Pessoa coincide", async () => {
    vi.mocked(service.buscarClientesErp).mockResolvedValue({
      ok: true,
      dados: [{ id: vinculo.externalId, cpfCnpj: "12345678000190", nome: null,
        nomeFantasia: null, razaoSocial: null, email: null,
        telefone: null, celular: null, cidade: null, uf: null }],
    });
    expect(await comprovarDocumentoFiscalDoVinculo(db, org, vinculo))
      .toEqual({ ok: false, motivo: "identidade_fiscal_nao_confirmada" });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service.buscarClientesErp).mockResolvedValue({ ok: true, dados: [] });
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna)
      .mockResolvedValue({ ok: true, dados: [pedido()] });
  });

  it("aceita Pessoa com ID externo exato sem ler pedidos", async () => {
    vi.mocked(service.buscarClientesErp).mockResolvedValue({
      ok: true,
      dados: [{ id: vinculo.externalId, cpfCnpj: documento, nome: null,
        nomeFantasia: null, razaoSocial: null, email: null,
        telefone: null, celular: null, cidade: null, uf: null }],
    });
    expect(await comprovarDocumentoFiscalDoVinculo(db, org, vinculo))
      .toEqual({ ok: true, documento, fonte: "pessoa_id" });
    expect(service.buscarPedidosErpComIdentidadeInterna).not.toHaveBeenCalled();
  });

  it("recupera documento de pedidos somente quando pessoaID coincide", async () => {
    expect(await comprovarDocumentoFiscalDoVinculo(db, org, vinculo))
      .toEqual({ ok: true, documento, fonte: "pedido_pessoa_id" });
    expect(service.buscarPedidosErpComIdentidadeInterna).toHaveBeenCalledWith(
      db, org, { cliente: vinculo.providerLookupLabel, pageSize: 100, skip: 0 },
    );
  });

  it("não aceita nome igual sem identidade externa", async () => {
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: true, dados: [pedido("outro-id")],
    });
    expect(await comprovarDocumentoFiscalDoVinculo(db, org, vinculo))
      .toEqual({ ok: false, motivo: "identidade_fiscal_nao_confirmada" });
  });

  it("falha fechado diante de CPF/CNPJ divergentes no mesmo ID", async () => {
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: true, dados: [pedido(), pedido(vinculo.externalId, "11222333000181")],
    });
    expect(await comprovarDocumentoFiscalDoVinculo(db, org, vinculo))
      .toEqual({ ok: false, motivo: "identidade_fiscal_conflitante" });
  });

  it("documento ausente ou inválido não vira identidade fiscal", async () => {
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: true, dados: [pedido(vinculo.externalId, null), pedido(vinculo.externalId, "00000000000")],
    });
    expect(await comprovarDocumentoFiscalDoVinculo(db, org, vinculo))
      .toEqual({ ok: false, motivo: "identidade_fiscal_nao_confirmada" });
  });

  it("não confia em documento inválido numa Pessoa com ID confirmado", async () => {
    vi.mocked(service.buscarClientesErp).mockResolvedValue({
      ok: true,
      dados: [{ id: vinculo.externalId, cpfCnpj: "00000000000", nome: null,
        nomeFantasia: null, razaoSocial: null, email: null,
        telefone: null, celular: null, cidade: null, uf: null }],
    });
    expect(await comprovarDocumentoFiscalDoVinculo(db, org, vinculo))
      .toEqual({ ok: false, motivo: "identidade_fiscal_nao_confirmada" });
    expect(service.buscarPedidosErpComIdentidadeInterna).not.toHaveBeenCalled();
  });

  it("rejeita documento inválido mesmo junto de outro válido nos pedidos", async () => {
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: true, dados: [pedido(), pedido(vinculo.externalId, "00000000000")],
    });
    expect(await comprovarDocumentoFiscalDoVinculo(db, org, vinculo))
      .toEqual({ ok: false, motivo: "identidade_fiscal_nao_confirmada" });
  });

  it("página cheia exige paginação e não valida conjunto incompleto", async () => {
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: true, dados: Array.from({ length: 100 }, () => pedido()),
    });
    expect(await comprovarDocumentoFiscalDoVinculo(db, org, vinculo))
      .toEqual({ ok: false, motivo: "consulta_parcial" });
    expect(service.buscarPedidosErpComIdentidadeInterna).toHaveBeenCalledTimes(5);
  });

  it("falha no provider não é ausência de documento", async () => {
    vi.mocked(service.buscarPedidosErpComIdentidadeInterna).mockResolvedValue({
      ok: false, motivo: "timeout",
    });
    expect(await comprovarDocumentoFiscalDoVinculo(db, org, vinculo))
      .toEqual({ ok: false, motivo: "erp_read_failed" });
  });

  it("mantém org do ator na leitura, sem usar org do ERP", async () => {
    await comprovarDocumentoFiscalDoVinculo(db, "org-a", vinculo);
    expect(service.buscarClientesErp).toHaveBeenCalledWith(
      db, "org-a", expect.anything(),
    );
    expect(service.buscarPedidosErpComIdentidadeInterna).toHaveBeenCalledWith(
      db, "org-a", expect.anything(),
    );
  });
});
