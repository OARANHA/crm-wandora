import { describe, expect, it } from "vitest";

import { nomeDoCanal, rotuloDoCanalDaConversa } from "@/lib/channels/estado";

describe("rotuloDoCanalDaConversa — leitura única do nome do canal", () => {
  it("usa a mesma precedência da tela de conexões", () => {
    for (const canal of [
      { display_name: "Peças", phone_number: "+5511999112233" },
      { display_name: null, phone_number: "+5511999112233" },
      { display_name: "Vendas", phone_number: null },
    ]) {
      expect(rotuloDoCanalDaConversa(canal)).toBe(nomeDoCanal(canal));
    }
  });

  it("não mostra identificador do transporte nem badge sem canal identificável", () => {
    expect(
      rotuloDoCanalDaConversa({
        display_name: " ",
        phone_number: null,
        waha_session_name: "org_2dd5e6ea",
      }),
    ).toBeNull();
    expect(rotuloDoCanalDaConversa(null)).toBeNull();
    expect(rotuloDoCanalDaConversa(undefined)).toBeNull();
  });

  it("preserva o rótulo customizado sem exibir o telefone subjacente", () => {
    expect(
      rotuloDoCanalDaConversa({ display_name: "  Atendimento  ", phone_number: "+55119000000" }),
    ).toBe("Atendimento");
  });
});
