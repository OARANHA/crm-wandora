import { beforeEach, describe, expect, it, vi } from "vitest";

import { examinarEnvelopeFiscalDaRespostaPrivada } from "@/lib/integracoes-erp/prova-fiscal-privada";

const m = vi.hoisted(() => ({
  carregarConexaoVendaErp: vi.fn(),
  consultarNfeVendaErp: vi.fn(),
}));

vi.mock("@/lib/integracoes-erp/credenciais", () => ({
  carregarConexaoVendaErp: m.carregarConexaoVendaErp,
  dadosCifradosVendaErp: vi.fn(),
}));

vi.mock("@/lib/integracoes-erp/vendaerp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integracoes-erp/vendaerp")>()),
  consultarNfeVendaErp: m.consultarNfeVendaErp,
}));

import { examinarProvaFiscalDeNfeInterna } from "@/lib/integracoes-erp/service";

const CHAVE = "51240412345678000195550010000000011017478094";
const XML_SINTETICO =
  "<nfeProc><NFe><infNFe>DOCUMENTO FICTICIO " + "X".repeat(100) +
  "</infNFe></NFe><protNFe><cStat>100</cStat></protNFe></nfeProc>";
const PII_SINTETICA = "nome-pessoal-que-nunca-deve-sair";

function resposta(override: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Numero: 1,
    ChaveNFe: CHAVE,
    CodigoStatus: 100,
    Xml: XML_SINTETICO + PII_SINTETICA,
    UrlImpressaoDanfe: "https://provider.invalid/?token=segredo",
    ...override,
  };
}

describe("pré-gate privado Fiscal/ConsultarNFE (fail-closed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.carregarConexaoVendaErp.mockResolvedValue({
      ok: true,
      credenciais: {
        baseUrl: "https://api.invalid",
        authorizationToken: "fake-private-token",
        user: "fake",
        app: "fake",
      },
    });
  });

  it("não confunde Xml + CodigoStatus=100 com integridade ou autorização SEFAZ", () => {
    const r = examinarEnvelopeFiscalDaRespostaPrivada(resposta(), 1);
    expect(r).toEqual({
      estado: "nao_comprovado",
      integridadeCriptografica: "nao_verificada",
      autorizacaoSefaz: "nao_verificada",
      motivo: "assinatura_e_autorizacao_externa_pendentes",
    });
    expect(JSON.stringify(r)).not.toContain(PII_SINTETICA);
    expect(JSON.stringify(r)).not.toContain(CHAVE);
    expect(JSON.stringify(r)).not.toContain("segredo");
    expect(JSON.stringify(r)).not.toContain("nfeProc");
  });

  it.each([
    ["id errado", resposta({ Numero: 2 }), "identidade_divergente"],
    ["número oculto", resposta({ Numero: null }), "identidade_ausente"],
    ["chave errada", resposta({ ChaveNFe: "1".repeat(44) }), "identidade_divergente"],
    ["chave inválida", resposta({ ChaveNFe: "ABC" }), "identidade_ausente"],
    ["sem XML", resposta({ Xml: null }), "xml_ausente"],
    ["tipo XML indevido", resposta({ Xml: { dados: PII_SINTETICA } }), "xml_tipo_invalido"],
    ["XML excessivo", resposta({ Xml: "A".repeat(262145) }), "xml_limite"],
    ["DOCTYPE", resposta({ Xml: "<!DOCTYPE nfeProc SYSTEM 'file:///etc/passwd'>" + XML_SINTETICO }), "xml_proibido"],
    ["entidade", resposta({ Xml: "<!ENTITY x SYSTEM 'http://fake.invalid'>" + XML_SINTETICO }), "xml_proibido"],
    ["CDATA", resposta({ Xml: "<![CDATA[suspeito]]>" + XML_SINTETICO }), "xml_proibido"],
  ] as const)("%s falha fechado sem retornar XML", (_nome, body, motivo) => {
    const r = examinarEnvelopeFiscalDaRespostaPrivada(body, 1);
    expect(r.estado).toBe("nao_comprovado");
    expect(r.motivo).toBe(motivo);
    expect(JSON.stringify(r)).not.toContain(CHAVE);
    expect(JSON.stringify(r)).not.toContain(PII_SINTETICA);
  });

  it("recusa número NFe inválido antes de buscar credenciais", async () => {
    const r = await examinarProvaFiscalDeNfeInterna({} as never, "org_fake", 0);
    expect(r).toEqual({ ok: false, motivo: "invalid_request" });
    expect(m.carregarConexaoVendaErp).not.toHaveBeenCalled();
    expect(m.consultarNfeVendaErp).not.toHaveBeenCalled();
  });

  it("executa uma única consulta oficial e descarta o XML no resultado", async () => {
    m.consultarNfeVendaErp.mockResolvedValue(resposta());
    const r = await examinarProvaFiscalDeNfeInterna({} as never, "org_fake", 1);
    expect(r.ok).toBe(true);
    expect(m.carregarConexaoVendaErp).toHaveBeenCalledOnce();
    expect(m.consultarNfeVendaErp).toHaveBeenCalledOnce();
    expect(m.consultarNfeVendaErp).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://api.invalid" }),
      1,
    );
    const serializado = JSON.stringify(r);
    expect(serializado).not.toContain(CHAVE);
    expect(serializado).not.toContain(PII_SINTETICA);
    expect(serializado).not.toContain("UrlImpressaoDanfe");
    expect(serializado).not.toContain("segredo");
    expect(serializado).not.toContain("fake-private-token");
  });

  it("falha fechado sem consultar o ERP quando conexão interna nega leitura", async () => {
    m.carregarConexaoVendaErp.mockResolvedValue({ ok: false, motivo: "modulo_desabilitado" });
    const r = await examinarProvaFiscalDeNfeInterna({} as never, "org_fake", 1);
    expect(r).toEqual({ ok: false, motivo: "modulo_desabilitado" });
    expect(m.consultarNfeVendaErp).not.toHaveBeenCalled();
  });

  it("não retorna erros crus com dados do provider", async () => {
    m.consultarNfeVendaErp.mockRejectedValue(new Error(PII_SINTETICA + " erro secreto"));
    const r = await examinarProvaFiscalDeNfeInterna({} as never, "org_fake", 1);
    expect(r).toEqual({ ok: false, motivo: "provider_error" });
  });
});
