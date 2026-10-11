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
  danfesEnviadas: 3,
  documentoPreparado: true,
  numeroDaNotaPreparada: "104",
  recenciaComprovada: true,
  numerosComprovados: notas,
} as const;

describe("orçamento estrito de envio DANFE para admin comprovado", () => {
  it("permite quarto e quinto documentos sem ampliar envio de texto", () => {
    expect(envioExtraDeDanfeAdminPermitido(base)).toBe(true);
    expect(envioExtraDeDanfeAdminPermitido({ ...base, enviosRealizados: 4, danfesEnviadas: 4 })).toBe(true);
    expect(envioExtraDeDanfeAdminPermitido({ ...base, enviosRealizados: 5, danfesEnviadas: 5 })).toBe(false);
    expect(MAX_DANFES_ADMIN_POR_TURNO).toBe(5);
  });

  it("uma mensagem de introdução não deve consumir uma das cinco cotas de PDF", () => {
    // Uma mensagem textual + quatro DANFEs: ainda pode enviar a quinta.
    expect(envioExtraDeDanfeAdminPermitido({ ...base, enviosRealizados: 5, danfesEnviadas: 4 })).toBe(true);
    // Três textos legítimos + quatro DANFEs: a quinta ainda é permitida.
    expect(envioExtraDeDanfeAdminPermitido({ ...base, enviosRealizados: 7, danfesEnviadas: 4 })).toBe(true);
    // Três textos + cinco documentos já consumiram integralmente os dois orçamentos.
    expect(envioExtraDeDanfeAdminPermitido({ ...base, enviosRealizados: 8, danfesEnviadas: 5 })).toBe(false);
  });

  it("três DANFEs são possíveis mesmo após uma introdução textual", () => {
    expect(envioExtraDeDanfeAdminPermitido({
      ...base,
      quantidade: 3,
      enviosRealizados: 3,
      danfesEnviadas: 2,
      numeroDaNotaPreparada: "103",
    })).toBe(true);
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
    ["quantidade de PDFs já concluída", { danfesEnviadas: 5 }],
    ["contador negativo", { danfesEnviadas: -1 }],
    ["contador maior que todas as mensagens", { danfesEnviadas: 4 }],
    ["mais de três textos já enviados", { enviosRealizados: 7, danfesEnviadas: 3 }],
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
