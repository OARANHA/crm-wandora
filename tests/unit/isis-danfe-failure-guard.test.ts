import { describe, expect, it } from "vitest";
import {
  AVISO_FALHA_DANFE,
  GuardaFalhaDanfeNoTurno,
} from "@/lib/agent-engine/agent/danfe-failure-guard";

describe("DANFE por turno, sem prometer entrega futura", () => {
  it("uma tentativa por NFe; outra nota pode ser tentada", () => {
    const g = new GuardaFalhaDanfeNoTurno();
    expect(g.iniciarTentativa("101")).toBe(true);
    expect(g.iniciarTentativa("101")).toBe(false);
    expect(g.iniciarTentativa("102")).toBe(true);
    expect(g.iniciarTentativa("")).toBe(false);
    expect(g.iniciarTentativa("abc")).toBe(false);
  });
  it("falha reporta ausência de PDF e de job de envio futuro", () => {
    const g = new GuardaFalhaDanfeNoTurno();
    g.registrarResultado({ ok: false, motivo: "danfe_download_failed" });
    expect(g.deveInformarFalha(false)).toBe(true);
    expect(AVISO_FALHA_DANFE).toMatch(/não consegui gerar nem anexar/i);
    expect(AVISO_FALHA_DANFE).toMatch(/não há envio automático posterior/i);
  });
  it("não bloqueia PDF válido de outra NFe", () => {
    const g = new GuardaFalhaDanfeNoTurno();
    g.registrarResultado({ ok: false });
    expect(g.deveInformarFalha(true)).toBe(false);
  });
  it("sucesso não informa falha", () => {
    const g = new GuardaFalhaDanfeNoTurno();
    g.registrarResultado({ ok: true });
    expect(g.falhou).toBe(false);
  });
  it("exceção também informa falha", () => {
    const g = new GuardaFalhaDanfeNoTurno();
    g.registrarExcecao();
    expect(g.falhou).toBe(true);
  });
  it("estado não vaza entre turnos", () => {
    const a = new GuardaFalhaDanfeNoTurno();
    const b = new GuardaFalhaDanfeNoTurno();
    a.iniciarTentativa("101");
    a.registrarResultado({ ok: false });
    a.avisoEnviado = true;
    expect(b.iniciarTentativa("101")).toBe(true);
    expect(b.falhou).toBe(false);
    expect(b.avisoEnviado).toBe(false);
  });
});
