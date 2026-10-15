import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AUTONOMIA_IA_PADRAO, CHAVES_AUTONOMIA_IA } from "@/lib/ai/governanca-da-ia-contrato";

const arquivo = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Editor de agentes — fronteira entre cliente e servidor", () => {
  it("expõe permissões de autonomia pelo contrato puro, sem acesso ao ambiente", () => {
    expect(CHAVES_AUTONOMIA_IA).toEqual(["provider", "model", "credentials", "operator_model"]);
    expect(AUTONOMIA_IA_PADRAO).toEqual({
      provider: false,
      model: false,
      credentials: false,
      operator_model: false,
    });

    const contrato = arquivo("lib/ai/governanca-da-ia-contrato.ts");
    expect(contrato).not.toMatch(/\b(?:import|require)\s*\(/);
    expect(contrato).not.toMatch(/^import\s/m);
    expect(contrato).not.toContain("process.env");
    expect(contrato).not.toContain('from "@/lib/supabase/admin"');
  });

  it("não leva governanca-da-ia.ts, Supabase admin ou lib/env ao AgentForm", () => {
    const formulario = arquivo("app/app/ai/agents/[id]/_components/AgentForm.tsx");
    const abas = arquivo("app/app/ai/agents/[id]/_components/AgentTabs.tsx");

    expect(formulario).toContain('from "@/lib/ai/governanca-da-ia-contrato"');
    expect(abas).toContain('from "@/lib/ai/governanca-da-ia-contrato"');
    for (const fonte of [formulario, abas]) {
      expect(fonte).not.toContain('from "@/lib/ai/governanca-da-ia"');
      expect(fonte).not.toContain('from "@/lib/supabase/admin"');
      expect(fonte).not.toContain('from "@/lib/env"');
    }
  });

  it("preserva as mesmas exportações canônicas aos consumidores do servidor", () => {
    const servidor = arquivo("lib/ai/governanca-da-ia.ts");
    expect(servidor).toContain('from "./governanca-da-ia-contrato"');
    expect(servidor).toContain("export { AUTONOMIA_IA_PADRAO, CHAVES_AUTONOMIA_IA }");
    expect(servidor).toContain("export type { AutonomiaIa, ChaveAutonomiaIa }");
  });
});
