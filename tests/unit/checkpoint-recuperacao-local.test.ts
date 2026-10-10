import { describe, expect, it, vi } from "vitest";

import {
  recuperarCheckpointNoFechamento,
  registrarFalhaCheckpointAposEnvio,
} from "@/lib/agent-engine/agent/abertura/checkpoint";

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

describe("checkpoint depois de um envio aceito", () => {
  const ids = {
    tenantId: "11111111-1111-4111-8111-111111111111",
    conversationId: "22222222-2222-4222-8222-222222222222",
    jobId: "33333333-3333-4333-8333-333333333333",
  };

  it("sem outbound, NÃO transforma falha de fechamento em turno concluído", async () => {
    const query = vi.fn();
    expect(
      await registrarFalhaCheckpointAposEnvio({ query } as never, {
        ...ids,
        houveEnvioAceito: false,
      }),
    ).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it("com outbound, registra alerta durável sem inventar checkpoint e sem texto privado", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "aviso-sintetico" }] }));
    expect(
      await registrarFalhaCheckpointAposEnvio({ query } as never, {
        ...ids,
        houveEnvioAceito: true,
      }),
    ).toBe(true);
    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("insert into agent_inbox_items");
    expect(sql).not.toContain("lead_checkpoints");
    expect(params).toContain(ids.tenantId);
    expect(params).toContain(ids.conversationId);
    expect(params).not.toContain("senha ou nota fiscal");
  });

  it("se o alerta durável não gravar, propaga erro para fila, sem sucesso falso", async () => {
    const query = vi.fn(async () => { throw new Error("db_indisponivel"); });
    await expect(
      registrarFalhaCheckpointAposEnvio({ query } as never, {
        ...ids,
        houveEnvioAceito: true,
      }),
    ).rejects.toThrow("db_indisponivel");
  });
});
