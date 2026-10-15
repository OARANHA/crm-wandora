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
  it("superadmin escreve por rota propria e exige MFA/scope full", () => {
    const code = file("app/api/v1/admin/tenants/[id]/ai-permissions/route.ts");
    expect(code).toContain("requirePlatformAdminEscrita()");
    expect(code).toContain("requireSupportWrite(orgId)");
    expect(code).toContain('.eq("id", orgId)');
  });
});
