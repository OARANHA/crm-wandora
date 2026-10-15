import { describe, expect, it } from "vitest";
import {
  podePreservarChaveLegadaAoSalvar,
  type EscolhaTecnicaDeAgente,
} from "./edicao-nao-tecnica";

const original: EscolhaTecnicaDeAgente = {
  provider: "custom",
  model: "deepseek-ai/DeepSeek-V4-Flash-0731-TEE",
  credential_id: "__CHAVE_INSTALACAO__",
  operator_model: "",
};
type Entrada = Parameters<typeof podePreservarChaveLegadaAoSalvar>[0];
function permitido(opcoes: Partial<Entrada> = {}) {
  return podePreservarChaveLegadaAoSalvar({
    editandoAgente: true,
    temVersaoPersistida: true,
    podeEditarCredencial: false,
    antes: original,
    depois: { ...original },
    ...opcoes,
  });
}
describe("salvar edições não técnicas sob gestão da plataforma", () => {
  it("preserva escolhas técnicas legadas", () => expect(permitido()).toBe(true));
  it("não permite exceção em criação ou sem versão persistida", () => {
    expect(permitido({ editandoAgente: false })).toBe(false);
    expect(permitido({ temVersaoPersistida: false })).toBe(false);
  });
  it("não permite exceção quando credencial pode ser trocada", () => {
    expect(permitido({ podeEditarCredencial: true })).toBe(false);
  });
  it.each(["provider", "model", "credential_id", "operator_model"] as const)(
    "recusa exceção quando %s muda",
    (key) => expect(permitido({ depois: { ...original, [key]: "outro" } })).toBe(false),
  );
});
