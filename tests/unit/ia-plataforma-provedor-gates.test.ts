import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function file(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}
const writeRoutes = [
  "app/api/v1/ai/credentials/route.ts",
  "app/api/v1/ai/credentials/[id]/route.ts",
  "app/api/v1/ai/credentials/[id]/revalidate/route.ts",
  "app/api/v1/ai/credentials/test/route.ts",
  "app/api/v1/ai/providers/route.ts",
  "app/api/v1/ai/knowledge/provedor/route.ts",
];
const versionRoutes = [
  "app/api/v1/ai/agents/route.ts",
  "app/api/v1/ai/agents/[id]/route.ts",
  "app/api/v1/ai/agents/[id]/versions/route.ts",
  "app/api/v1/ai/agents/[id]/versions/[vid]/route.ts",
  "app/api/v1/ai/agents/[id]/publish/route.ts",
];

describe("gates tecnicos de IA — backend e UI", () => {
  it.each(writeRoutes)("%s verifica permissao no servidor", (path) => {
    const code = file(path);
    expect(code).toContain("recusaConfiguracaoDeIa");
    expect(code).toContain("await recusaConfiguracaoDeIa(");
  });
  it.each(versionRoutes)("%s impede troca tecnica fora da concessao", (path) => {
    const code = file(path);
    expect(code).toMatch(/validarMudancasTecnicas|motivoDaRecusaTecnica/);
  });
  it("onboarding nao depende de frase nem papel admin para credenciais", () => {
    expect(file("app/actions/onboarding/chaveDaIa.ts")).toContain(
      'podeConfigurarIa(operador, ctx.orgId, "credentials")',
    );
  });
  it("server actions de agentes impedem payload tecnico alternativo", () => {
    const code = file("app/app/ai/agents/[id]/_actions.ts");
    expect(code).toContain("motivoDaRecusaTecnica");
  });
  it("isolamento da coluna de grants e migracao resistente a writes concorrentes", () => {
    const route = file("app/api/v1/admin/tenants/[id]/ai-permissions/route.ts");
    const governance = file("lib/ai/governanca-da-ia.ts");
    const migration = file("supabase/migrations/20261015031500_0506_org_ai_autonomy_protected.sql");
    const baseline = file("supabase/baseline.sql");
    expect(governance).toContain('.select("ai_autonomy")');
    expect(governance).not.toContain("CHAVE_SETTINGS_AUTONOMIA_IA");
    expect(route).toContain(".update({ ai_autonomy: body.data })");
    expect(route).toContain('.eq("ai_autonomy", JSON.stringify(org.ai_autonomy ?? {}))');
    expect(route).not.toContain(".update({ settings:");
    expect(migration).toContain("fn_guard_organizations_ai_autonomy");
    expect(migration).toContain("auth.role() = 'service_role'");
    expect(migration).toContain("errcode = '42501'");
    expect(migration).toContain("before insert or update on public.organizations");
    expect(baseline).toContain('"ai_autonomy" "jsonb" DEFAULT');
    expect(baseline).toContain("fn_guard_organizations_ai_autonomy()");
  });

  it("superadmin escreve por rota propria e exige MFA/scope full", () => {
    const code = file("app/api/v1/admin/tenants/[id]/ai-permissions/route.ts");
    expect(code).toContain("requirePlatformAdminEscrita()");
    expect(code).toContain("requireSupportWrite(orgId)");
    expect(code).toContain('.eq("id", orgId)');
  });
});
