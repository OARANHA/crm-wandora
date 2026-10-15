import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const source = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const route = "app/api/v1/admin/tenants/[id]/ai-default/route.ts";

describe("governança central de IA — contrato contra regressões", () => {
  it("escrita exige Superadmin full, MFA e bloqueio de suporte", () => {
    const s = source(route);
    expect(s).toContain("requirePlatformAdminEscrita()");
    expect(s).toContain("requireSupportWrite(orgId)");
    expect(s).toContain("falhaDaEscritaDePlatformAdmin");
    expect(s).toContain("bodySchema.safeParse(await req.json().catch(() => null))");
  });
  it("consulta e escrita se restringem a um UUID de organização validado", () => {
    const s = source(route);
    expect(s).toContain("z.string().uuid()");
    expect(s.match(/\.eq\("id", orgId\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(s).toContain('.eq("organization_id", orgId)');
  });
  it("CAS rejeita concorrência e nunca retorna sucesso de UPDATE sem linha", () => {
    const s = source(route);
    expect(s).toContain('.eq("settings", JSON.stringify(org.settings ?? {}))');
    expect(s).toContain('fail("conflict"');
    expect(s).toContain("if (!updated)");
    expect(s).toContain("mesclarPadraoLlmDaOrganizacao(org.settings, body.data)");
  });
  it("não atualiza versões publicadas ou bindings e não transporta secrets", () => {
    const s = source(route);
    expect(s).not.toMatch(/\.from\("ai_agent_versions"\)/);
    expect(s).not.toMatch(/\.from\("ai_purpose_bindings"\)\s*\.update\(/);
    expect(s).not.toMatch(/api_key_encrypted|api_key_iv|api_key_tag/);
    expect(s).toContain('action: "platform_admin.ai_default_updated"');
    expect(source("app/admin/(protected)/tenants/[id]/_client.tsx")).toContain(
      "<TenantAiPlatformDefault organizationId={organization.id} />",
    );
  });
  it("sempre usa catálogo de providers canônico e valida modelo no servidor", () => {
    const s = source(route);
    expect(s).toContain("ehProvedorSuportado");
    expect(s).toMatch(/\.from\("ai_models"\)/);
    expect(s).toContain("modelo_desconhecido");
  });
});
