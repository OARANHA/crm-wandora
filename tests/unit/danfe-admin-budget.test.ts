import { describe, expect, it } from "vitest";

import {
  MAX_DANFES_ADMIN_POR_TURNO,
  envioExtraDeDanfeAdminPermitido,
  orcamentoDeStepsDanfeAdmin,
} from "@/lib/agent-engine/agent/danfe-admin-budget";

const notas = new Set(["101", "102", "103", "104", "105"]);
const base = {
  ferramentaAdminMontada: true,
  pedidoRecente: true,
  quantidade: 5,
  limiteEnviosGeral: 3,
  enviosRealizados: 3,
  documentoPreparado: true,
  numeroDaNotaPreparada: "104",
  recenciaComprovada: true,
  numerosComprovados: notas,
} as const;

describe("orçamento estrito de envio DANFE para admin comprovado", () => {
  it("permite quarto e quinto documentos sem ampliar envio de texto", () => {
    expect(envioExtraDeDanfeAdminPermitido(base)).toBe(true);
    expect(envioExtraDeDanfeAdminPermitido({ ...base, enviosRealizados: 4 })).toBe(true);
    expect(envioExtraDeDanfeAdminPermitido({ ...base, enviosRealizados: 5 })).toBe(false);
    expect(MAX_DANFES_ADMIN_POR_TURNO).toBe(5);
  });

  it.each([
    ["sem ferramenta administrativa", { ferramentaAdminMontada: false }],
    ["pedido que não é de recência", { pedidoRecente: false }],
    ["sem prova de recência", { recenciaComprovada: false }],
    ["sem PDF privado preparado", { documentoPreparado: false }],
    ["sem vínculo do número preparado", { numeroDaNotaPreparada: null }],
    ["NFe fora da lista certificada", { numeroDaNotaPreparada: "999" }],
    ["nenhuma nota comprovada", { numerosComprovados: new Set<string>() }],
    ["quantidade maior que o teto", { quantidade: 6 }],
    ["pedido sem quantidade válida", { quantidade: 0 }],
    ["limite geral deliberadamente menor", { limiteEnviosGeral: 1 }],
  ] as const)("%s bloqueia a exceção", (_descricao, alteracao) => {
    expect(envioExtraDeDanfeAdminPermitido({ ...base, ...alteracao })).toBe(false);
  });

  it("não altera o orçamento padrão sem autoridade e mantém teto finito para cinco", () => {
    const padrao = {
      ferramentaAdminMontada: true,
      pedidoRecente: true,
      quantidade: 5,
      limiteEnviosGeral: 3,
      maxSteps: 8,
    };
    expect(orcamentoDeStepsDanfeAdmin(padrao)).toBe(14);
    expect(orcamentoDeStepsDanfeAdmin({ ...padrao, maxSteps: 20 })).toBe(20);
    expect(orcamentoDeStepsDanfeAdmin({ ...padrao, ferramentaAdminMontada: false })).toBe(8);
    expect(orcamentoDeStepsDanfeAdmin({ ...padrao, quantidade: 20 })).toBe(8);
    expect(orcamentoDeStepsDanfeAdmin({ ...padrao, pedidoRecente: false })).toBe(8);
    expect(orcamentoDeStepsDanfeAdmin({ ...padrao, limiteEnviosGeral: 1 })).toBe(8);
  });
});
