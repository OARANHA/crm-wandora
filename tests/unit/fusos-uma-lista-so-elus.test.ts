/**
 * Mesmo catálogo IANA para primeiro acesso, perfil e organização.
 *
 * Antes, o onboarding tinha fusos que sumiam das Configurações: Radix Select
 * não tinha opção correspondente e podia mostrar horário diferente do salvo.
 * Teste de fonte detecta a volta de listas paralelas, não reescreve o schema.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FUSOS_DO_ONBOARDING,
  FUSOS_OFERECIDOS,
  fusoOferecidoOuPadrao,
  fusoValido,
} from "@/lib/tempo/fusos";

const oferecidos = new Set(FUSOS_OFERECIDOS.map((f) => f.codigo));

describe("fuso IANA: um catálogo no onboarding e nas configurações", () => {
  it("todo fuso do primeiro acesso permanece disponível depois", () => {
    const ausentes = FUSOS_DO_ONBOARDING.map((f) => f.id).filter((id) => !oferecidos.has(id));
    expect(ausentes).toEqual([]);
  });

  it("Madri, Cuiabá e Roma são opções estáveis entre telas", () => {
    for (const id of ["Europe/Madrid", "America/Cuiaba", "Europe/Rome"]) {
      expect(fusoOferecidoOuPadrao(id)).toBe(id);
    }
    expect(FUSOS_DO_ONBOARDING.map((f) => f.id)).toContain("Europe/Rome");
  });

  it("toda opção do catálogo é aceita pelo Intl do runtime", () => {
    const invalidos = [...oferecidos, ...FUSOS_DO_ONBOARDING.map((f) => f.id)].filter(
      (tz) => !fusoValido(tz),
    );
    expect(invalidos).toEqual([]);
  });

  it.each([
    "app/onboarding/welcome/_form.tsx",
    "app/app/settings/tenant/_form.tsx",
    "app/app/settings/profile/_form.tsx",
  ])("%s não define uma segunda lista de fusos", (arquivo) => {
    const fonte = readFileSync(join(process.cwd(), arquivo), "utf8");
    expect(fonte).not.toMatch(/["'](?:America|Europe|Africa)\/[A-Za-z_]+["']/);
    if (arquivo.includes("welcome")) expect(fonte).toContain("FUSOS_DO_ONBOARDING.map");
    else expect(fonte).toContain("FUSOS_OFERECIDOS.map");
  });
});
