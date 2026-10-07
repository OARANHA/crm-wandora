import { describe, expect, it } from "vitest";

import { recuperarCheckpointNoFechamento } from "@/lib/agent-engine/agent/abertura/checkpoint";

const checkpointValido = JSON.stringify({
  commitments: [],
  objections: [],
  next_action: null,
  rolling_summary: "resumo fiel da conversa",
  declaracao: { intencoes: [], promessas: [], nada_a_declarar: true },
});

describe("recuperação local do checkpoint — sem replay de ferramentas", () => {
  it("não repete o fechamento quando o primeiro JSON já é válido", async () => {
    const tentativas: number[] = [];
    const content = await recuperarCheckpointNoFechamento(async (tentativa) => {
      tentativas.push(tentativa);
      return checkpointValido;
    });
    expect(tentativas).toEqual([1]);
    expect(content.rolling_summary).toBe("resumo fiel da conversa");
    expect(content.declaracao?.nada_a_declarar).toBe(true);
  });

  it("recupera dois JSONs malformados sem reiniciar o turno e sem inventar declaração", async () => {
    const tentativas: number[] = [];
    const respostas = ["{invalido", '{"rolling_summary":', checkpointValido];
    const content = await recuperarCheckpointNoFechamento(async (tentativa) => {
      tentativas.push(tentativa);
      return respostas[tentativa - 1]!;
    });
    expect(tentativas).toEqual([1, 2, 3]);
    expect(content.declaracao?.nada_a_declarar).toBe(true);
  });

  it("não transforma três respostas inválidas em checkpoint fabricado", async () => {
    const tentativas: number[] = [];
    await expect(
      recuperarCheckpointNoFechamento(async (tentativa) => {
        tentativas.push(tentativa);
        return "{não é JSON}";
      }),
    ).rejects.toThrow("JSON de checkpoint inválido");
    expect(tentativas).toEqual([1, 2, 3]);
  });

  it("não disfarça falha de infraestrutura como erro de formato ou faz retry de LLM", async () => {
    const chamada = async () => {
      throw new Error("modelo_indisponivel");
    };
    await expect(recuperarCheckpointNoFechamento(chamada)).rejects.toThrow("modelo_indisponivel");
  });

  it("não relaxa validação de declaração para obter falso verde", async () => {
    let n = 0;
    const value = await recuperarCheckpointNoFechamento(async () => {
      n += 1;
      if (n === 1) {
        return '{"rolling_summary":"x","declaracao":{"intencoes":"errado"}}';
      }
      return checkpointValido;
    });
    expect(n).toBe(2);
    expect(value.declaracao?.nada_a_declarar).toBe(true);
  });
});
