import { describe, expect, it } from "vitest";
import {
  AVISO_SEM_RECENCIA_FISCAL,
  pedidoDeNfeMaisRecente,
  recenciaFiscalComprovada,
} from "@/lib/agent-engine/agent/recencia-fiscal-gate";

describe("ISIS — gate de recência fiscal comprovada", () => {
  it.each([
    "ISIS, traga a última nota emitida para a Eco Projetos",
    "Me traga as últimas duas notas da Eco Projetos",
    "Qual a NF-e mais recente?",
    "Quero as notas fiscais mais recentes",
    "Envie a última DANFE e nota fiscal",
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
      { notas: [{ numeroNFe: "123", dataEmissao: "2026-10-08" }], resumo: { consultaCompleta: false } },
    ]) {
      expect(recenciaFiscalComprovada(r)).toBe(false);
    }
  });

  it("nunca inventa a última nota nem expõe identificador fiscal no fallback", () => {
    expect(AVISO_SEM_RECENCIA_FISCAL).toMatch(/não consegui comprovar/i);
    expect(AVISO_SEM_RECENCIA_FISCAL).not.toMatch(/[0-9]{8}/);
  });
});
