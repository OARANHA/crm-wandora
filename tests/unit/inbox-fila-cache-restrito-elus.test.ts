import { describe, expect, it } from "vitest";

import {
  soMudouOAutomaticoDaFila,
  type ConversationsFilters,
} from "@/hooks/inbox/useConversationsRealtime";

const fila: ConversationsFilters = { comando: ["aguardando"], channel_session_id: "canal-1" };
const filaSemAutomatico: ConversationsFilters = {
  comando: ["aguardando", "automatico"],
  channel_session_id: "canal-1",
};

describe("preservação restrita do cache da Fila", () => {
  it("reconhece somente a mudança do fato de atendimento automático na mesma Fila", () => {
    expect(soMudouOAutomaticoDaFila(fila, filaSemAutomatico)).toBe(true);
    expect(soMudouOAutomaticoDaFila(filaSemAutomatico, fila)).toBe(true);
  });

  it("não reutiliza resultados quando busca, atendente, canal ou etiqueta mudam", () => {
    expect(soMudouOAutomaticoDaFila(fila, { ...filaSemAutomatico, search: "cliente" })).toBe(false);
    expect(soMudouOAutomaticoDaFila(fila, { ...filaSemAutomatico, assigned_to: "me" })).toBe(false);
    expect(
      soMudouOAutomaticoDaFila(fila, { ...filaSemAutomatico, channel_session_id: "canal-2" }),
    ).toBe(false);
    expect(soMudouOAutomaticoDaFila(fila, { ...filaSemAutomatico, tag: ["importante"] })).toBe(
      false,
    );
  });

  it("não reaproveita Fila antiga em outra aba", () => {
    expect(soMudouOAutomaticoDaFila(fila, { channel_session_id: "canal-1" })).toBe(false);
    expect(soMudouOAutomaticoDaFila(fila, { comando: ["automatico"] })).toBe(false);
  });
});
