import { describe, expect, it } from "vitest";

import { chaveFiscalComprovadaDaNota } from "@/lib/integracoes-erp/chave-fiscal-comprovada";

const numero = 64_996_397;
const chave = ["35", "2610", "12345678000190", "55", "001", "064996397", "1", "12345678", "0"].join("");

describe("identidade fiscal da DANFE", () => {
  it("usa nNF da chave e não confunde número da nota com código de pedido", () => {
    expect(chave).toHaveLength(44);
    expect(chaveFiscalComprovadaDaNota({ numero, chave })).toBe(chave);
    expect(chaveFiscalComprovadaDaNota({ numero: numero + 1, chave })).toBeNull();
  });

  it("recusa ausência, valor estranho e chave inválida", () => {
    expect(chaveFiscalComprovadaDaNota({ numero, chave: null })).toBeNull();
    expect(chaveFiscalComprovadaDaNota({ numero: null, chave })).toBeNull();
    expect(chaveFiscalComprovadaDaNota({ numero: -1, chave })).toBeNull();
    expect(chaveFiscalComprovadaDaNota({ numero: 1.5, chave })).toBeNull();
    expect(chaveFiscalComprovadaDaNota({ numero, chave: "invalid" })).toBeNull();
    expect(chaveFiscalComprovadaDaNota({ numero, chave: "9".repeat(44) })).toBeNull();
  });

  it("normaliza espaços e separadores sem mudar os dígitos", () => {
    const agrupada = chave.match(/.{1,4}/g)?.join(" ") ?? "";
    expect(chaveFiscalComprovadaDaNota({ numero, chave: agrupada })).toBe(chave);
  });
});
