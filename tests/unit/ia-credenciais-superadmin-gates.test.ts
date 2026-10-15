import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

const routes = [
  "app/api/v1/admin/tenants/[id]/ai-credentials/route.ts",
  "app/api/v1/admin/tenants/[id]/ai-credentials/test/route.ts",
];
describe("Superadmin configura IA da organização, não do servidor", () => {
  it.each(routes)("escritas protegidas em %s", (file) => {
    const s = source(file);
    expect(s).toContain("requirePlatformAdminEscrita()");
    expect(s).toContain("requireSupportWrite(orgId)");
    expect(s).toContain("z.string().uuid()");
    expect(s).not.toContain("recusaConfiguracaoDeIa(");
  });
  it("cadastro usa a credencial canônica, auditável e criptografada", () => {
    const s = source(routes[0]!);
    expect(s).toContain("guardarCredencial(");
    expect(s).toContain('provider: "custom"');
    expect(s).toContain("orgId,");
    expect(s).toContain("validateProviderKey(");
    expect(s).toContain('.from("organizations")');
    expect(s).toContain('.eq("id", orgId)');
    expect(s).not.toContain('.from("ai_provider_credentials")');
  });
  it("o teste de conectividade usa o validador SSRF, sem persistência", () => {
    const s = source(routes[1]!);
    expect(s).toContain('validateProviderKey("custom"');
    expect(s).not.toContain("guardarCredencial(");
    expect(s).not.toContain("audit(");
  });
  it("a rota de ativação exige a mesma organização, provedor e credencial validada", () => {
    const s = source("app/api/v1/admin/tenants/[id]/ai-default/route.ts");
    expect(s).toContain("credential_id: z.string().uuid().nullable().optional()");
    expect(s).toContain('.from("ai_provider_credentials_safe")');
    expect(s).toContain('.eq("organization_id", orgId)');
    expect(s).toContain('.eq("id", credentialId)');
    expect(s).toContain("cred.provider !== body.data.provider");
    expect(s).toContain("!cred.validated_at");
    expect(s).toContain("mesclarPadraoLlmDaOrganizacao(");
  });
  it("runtime usa credencial do mesmo provedor da organização e falha se revogada", () => {
    const seam = source("lib/agent-engine/edge/llm/credentials.ts");
    expect(seam).toContain("settings.credential_id");
    expect(seam).toContain("credentialIdEscolhida");
    expect(seam).toContain("settings.credential_id && cred === undefined");
    expect(seam).toContain("and provider = $3");
    const gateway = source("lib/ai/gateway-binding.ts");
    expect(gateway).toContain("llm.credential_id");
    expect(gateway).toContain('query.eq("id", credentialId)');
  });
  it("o formulário registra URL, token e modelo no Superadmin, sem env", () => {
    const s = source("components/admin/tenants/TenantAiPlatformDefault.tsx");
    expect(s).toContain("Token/API Key");
    expect(s).toContain("Base URL HTTPS");
    expect(s).toContain("testCustom()");
    expect(s).toContain("createCustom()");
    expect(s).toContain("credential_id: credentialId || null");
    expect(s).toContain("selectedReady");
    expect(s).not.toContain("process.env.");
  });
});
