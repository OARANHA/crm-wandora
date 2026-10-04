import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("módulo Integrações ERP segue ADR-0002", () => {
  it("é módulo de tabela e tem provisionadora no baseline", () => {
    const modulos = ler("lib/instalacao/modulos.ts");
    const baseline = ler("supabase/baseline.sql");
    expect(modulos).toContain('"integracoes_erp"');
    expect(modulos).toContain('["honorarios", "integracoes_erp"]');
    expect(baseline).toContain("fn_integracoes_erp_provisionar");
    expect(baseline).toContain("create table if not exists public.erp_connections");
    expect(baseline).toContain("create table if not exists public.erp_admin_whatsapp_bindings");
  });

  it("tem porta de navegação própria, protegida pelo módulo", () => {
    const nav = ler("lib/navigation/catalogo.ts");
    expect(nav).toContain('href: "/app/integracoes-erp"');
    expect(nav).toContain('modulo: "integracoes_erp"');
  });
});
