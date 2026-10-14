import { describe, expect, it } from "vitest";
import {
  AVISO_SEM_RECENCIA_FISCAL,
  pedidoDeNfeMaisRecente,
  recenciaFiscalComprovada,
  numerosDaBuscaFiscalComprovada,
  quantidadeDeNotasMaisRecentesPedida,
  mencionaNfeNaoComprovada,
  pedidoDeNotaFiscalVaga,
  periodoDeBuscaFiscalVazia,
  posicaoOrdinalDeNfePedida,
  numerosFiscaisPermitidosParaPedido,
} from "@/lib/agent-engine/agent/recencia-fiscal-gate";

describe("ISIS — gate de recência fiscal comprovada", () => {
  it("distingue nota singular vaga de última, de nota numerada e de dia específico", () => {
    expect(pedidoDeNotaFiscalVaga("ISIS, me traga a nota do cliente Eco Projetos")).toBe(true);
    expect(pedidoDeNotaFiscalVaga("ISIS, me traga a última nota da Eco Projetos")).toBe(false);
    expect(pedidoDeNotaFiscalVaga("ISIS, me traga a penúltima nota do Cliente Exemplo")).toBe(false);
    expect(pedidoDeNotaFiscalVaga("ISIS, me traga a antepenúltima nota do Cliente Exemplo")).toBe(false);
    expect(pedidoDeNotaFiscalVaga("Traga a nota de 08/10/2026")).toBe(false);
    expect(pedidoDeNotaFiscalVaga("Traga a nota nº 1234567")).toBe(false);
  });

  it("só comprova ausência com consulta fiscal completa e período explícito", () => {
    const base = {
      notas: [],
      resumo: {
        consultaCompleta: true,
        quantidadeRetornada: 0,
        periodoConsultado: { dataInicio: "2026-09-09", dataFim: "2026-10-08" },
      },
    };
    expect(periodoDeBuscaFiscalVazia(base)).toEqual(base.resumo.periodoConsultado);
    expect(periodoDeBuscaFiscalVazia({ ...base, erro: "consulta_parcial" })).toBeNull();
    expect(
      periodoDeBuscaFiscalVazia({ ...base, resumo: { ...base.resumo, consultaCompleta: false } }),
    ).toBeNull();
    expect(periodoDeBuscaFiscalVazia({ ...base, notas: [{ numeroNFe: "1" }] })).toBeNull();
    expect(periodoDeBuscaFiscalVazia({ notas: [], resumo: { consultaCompleta: true } })).toBeNull();
  });

  it.each([
    "ISIS, traga a última nota emitida para a Eco Projetos",
    "Me traga as últimas duas notas da Eco Projetos",
    "Qual a NF-e mais recente?",
    "Quero as notas fiscais mais recentes",
    "Envie a última DANFE e nota fiscal",
    "Isis me traga a antepenúltima nota da Cliente Exemplo",
    "Isis me traga a penúltima NFe",
    "Mostre a segunda nota mais recente",
    "Mostre a terceira mais recente nota fiscal",
  ])("reconhece pedido real de recência: %s", (texto) => {
    expect(pedidoDeNfeMaisRecente(texto)).toBe(true);
  });

  it.each([
    "Consulte a NFe 123456",
    "Quero os pedidos desse cliente",
    "Envie a DANFE da nota 123456",
    "Qual é a data dessa nota fiscal?",
  ])("não arma para uma consulta fiscal específica: %s", (texto) => {
    expect(pedidoDeNfeMaisRecente(texto)).toBe(false);
  });

  it("só comprova nota com data fiscal e ranking completo da capability", () => {
    expect(
      recenciaFiscalComprovada({
        notas: [{ numeroNFe: "123", dataEmissao: "2026-10-08T10:00:00" }],
        resumo: { consultaCompleta: true, quantidadeRetornada: 1 },
      }),
    ).toBe(true);
    for (const r of [
      null,
      { erro: "janela_fiscal_insuficiente" },
      { erro: "nenhum_resultado" },
      { notas: [], resumo: { consultaCompleta: true } },
      { notas: [{ numeroNFe: "123" }], resumo: { consultaCompleta: true } },
      { notas: [{ numeroNFe: "123", dataEmissao: "2026-10-08" }] },
      {
        notas: [{ numeroNFe: "123", dataEmissao: "2026-10-08" }],
        resumo: { consultaCompleta: false },
      },
    ]) {
      expect(recenciaFiscalComprovada(r)).toBe(false);
    }
  });

  it.each([
    ["ISIS, traga a última nota emitida para a Eco Projetos", 1],
    ["Me traga as últimas duas notas da Eco Projetos", 2],
    ["Mostre as duas últimas notas", 2],
    ["Traga as últimas 3 notas fiscais", 3],
    ["Quais são as notas fiscais mais recentes?", 3],
    ["Qual a NF-e mais recente?", 1],
    ["As últimas cinco notas fiscais", 5],
    ["A penúltima nota fiscal", 2],
    ["A antepenúltima nota fiscal", 3],
    ["A segunda nota mais recente", 2],
    ["A terceira mais recente NFe", 3],
  ])("limita ranking fiscal ao pedido: %s", (texto, quantidade) => {
    expect(quantidadeDeNotasMaisRecentesPedida(texto)).toBe(quantidade);
  });


  it.each([
    ["a penúltima NFe", 2],
    ["a antepenúltima nota fiscal", 3],
    ["a segunda mais recente nota", 2],
    ["a terceira nota fiscal mais recente", 3],
    ["a 2ª nota mais recente", 2],
    ["a 3ª nota mais recente", 3],
  ] as const)("resgata somente a posição ordinal em %s", (texto, posicao) => {
    expect(posicaoOrdinalDeNfePedida(texto)).toBe(posicao);
  });

  it("não classifica qualquer terceira menção como ordinal de nota", () => {
    expect(posicaoOrdinalDeNfePedida("A terceira entrega é amanhã")).toBeNull();
    expect(pedidoDeNfeMaisRecente("A terceira entrega é amanhã")).toBe(false);
    expect(posicaoOrdinalDeNfePedida("Compare a penúltima e a antepenúltima nota")).toBeNull();
  });

  it("autoriza exclusivamente a NFe ranqueada na posição pedida", () => {
    const completo = {
      notas: [
        { numeroNFe: "990", dataEmissao: "2026-10-08T12:00:00" },
        { numeroNFe: "888", dataEmissao: "2026-10-07T12:00:00" },
        { numeroNFe: "777", dataEmissao: "2026-10-06T12:00:00" },
      ],
      resumo: { consultaCompleta: true },
    };
    const segunda = numerosFiscaisPermitidosParaPedido(completo, "a penúltima nota");
    const terceira = numerosFiscaisPermitidosParaPedido(completo, "a antepenúltima nota");
    expect(segunda).toEqual(["888"]);
    expect(terceira).toEqual(["777"]);
    expect(numerosFiscaisPermitidosParaPedido(completo, "as últimas duas notas")).toEqual([
      "990",
      "888",
    ]);
    expect(mencionaNfeNaoComprovada("Segue a NFe 990", new Set(terceira))).toBe(true);
    expect(mencionaNfeNaoComprovada("Segue a NFe 777", new Set(terceira))).toBe(false);
    expect(numerosFiscaisPermitidosParaPedido({
      ...completo,
      notas: completo.notas.slice(0, 2),
    }, "a antepenúltima nota")).toEqual([]);
    expect(numerosFiscaisPermitidosParaPedido({
      ...completo,
      resumo: { consultaCompleta: false },
    }, "a penúltima nota")).toEqual([]);
    expect(numerosFiscaisPermitidosParaPedido({
      ...completo,
      notas: [
        completo.notas[0],
        { ...completo.notas[1], dataEmissao: completo.notas[2].dataEmissao },
        completo.notas[2],
      ],
    }, "a antepenúltima nota")).toEqual([]);
  });

  it("não permite a segunda NFe como 'última' nem reusar número do histórico", () => {
    const fiscais = {
      notas: [
        { numeroNFe: "990", dataEmissao: "2026-10-08T12:00:00" },
        { numeroNFe: "888", dataEmissao: "2026-10-07T12:00:00" },
        { numeroNFe: "777", dataEmissao: "2026-10-06T12:00:00" },
      ],
      resumo: { consultaCompleta: true },
    };
    const primeira = new Set(
      numerosDaBuscaFiscalComprovada(fiscais).slice(
        0,
        quantidadeDeNotasMaisRecentesPedida("A última nota fiscal"),
      ),
    );
    expect([...primeira]).toEqual(["990"]);
    expect(mencionaNfeNaoComprovada("A última NF-e 888 foi emitida", primeira)).toBe(true);
    expect(mencionaNfeNaoComprovada("Segue a NF-e 990", primeira)).toBe(false);
    expect(mencionaNfeNaoComprovada("NF-e nº 00000777", primeira)).toBe(true);
    expect(mencionaNfeNaoComprovada("Segue sua DANFE em PDF", primeira)).toBe(false);
  });

  it("nunca inventa a última nota nem expõe identificador fiscal no fallback", () => {
    expect(AVISO_SEM_RECENCIA_FISCAL).toMatch(/não consegui comprovar/i);
    expect(AVISO_SEM_RECENCIA_FISCAL).not.toMatch(/[0-9]{8}/);
  });
});
