import { describe, expect, it } from "vitest";

import { NOME_DO_TOM, PALETA_DE_ETIQUETAS } from "@/lib/tags/cor-da-etiqueta";

describe("paleta das etiquetas do ELUS", () => {
  it("cada tom ofertado tem exatamente um nome acessível", () => {
    expect(PALETA_DE_ETIQUETAS).toHaveLength(8);
    expect(Object.keys(NOME_DO_TOM).sort()).toEqual([...PALETA_DE_ETIQUETAS].sort());
    for (const cor of PALETA_DE_ETIQUETAS) {
      expect(NOME_DO_TOM[cor]?.trim().length).toBeGreaterThan(1);
    }
  });

  it("preserva as cores publicadas pelo ELUS, sem importar a troca visual do upstream", () => {
    expect(PALETA_DE_ETIQUETAS).toContain("#e54d2e");
    expect(PALETA_DE_ETIQUETAS).toContain("#12a594");
    expect(NOME_DO_TOM["#e54d2e"]).toBe("Vermelho");
    expect(NOME_DO_TOM["#12a594"]).toBe("Verde-água");
  });
});
