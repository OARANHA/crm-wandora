import { describe, expect, it } from "vitest";
import {
  lerPadraoLlmDaOrganizacao,
  mesclarPadraoLlmDaOrganizacao,
} from "./padrao-llm-da-organizacao";

describe("padrão de LLM gerenciado por organização", () => {
  it("fallback não se confunde com valor explicitamente salvo", () => {
    expect(lerPadraoLlmDaOrganizacao({}).configured).toBe(false);
    expect(lerPadraoLlmDaOrganizacao({}).default_model).toBeNull();
    expect(lerPadraoLlmDaOrganizacao(null).provider).toBe("anthropic");
    expect(
      lerPadraoLlmDaOrganizacao({ llm: { provider: "custom", default_model: "a/b" } }),
    ).toMatchObject({ provider: "custom", default_model: "a/b", configured: true });
  });
  it("preserva identidade, segurança, branding e demais settings; não muta o original", () => {
    const original = {
      security: { mfa_required: true },
      branding: { cor: "violeta" },
      base_de_conhecimento: { familia: "google" },
      llm: { provider: "anthropic", default_model: "claude-sonnet-5" },
    };
    const next = mesclarPadraoLlmDaOrganizacao(original, {
      provider: "custom",
      default_model: "deepseek-ai/DeepSeek-V4-Flash-0731-TEE",
    });
    expect(next).toMatchObject({
      security: original.security,
      branding: original.branding,
      base_de_conhecimento: original.base_de_conhecimento,
      llm: { provider: "custom", default_model: "deepseek-ai/DeepSeek-V4-Flash-0731-TEE" },
    });
    expect(original.llm.provider).toBe("anthropic");
    expect(next).not.toHaveProperty("ai_autonomy");
  });
  it("lê e preserva a credencial estável sem alterar outros campos", () => {
    const id = "5f4554d8-64b5-4241-a70d-c1f171678a20";
    const original = {
      security: { mfa_required: true },
      llm: { provider: "custom", default_model: "model-a", credential_id: id, quota: 15 },
    };
    expect(lerPadraoLlmDaOrganizacao(original).credential_id).toBe(id);
    const updated = mesclarPadraoLlmDaOrganizacao(original, {
      provider: "custom",
      default_model: "model-b",
      credential_id: id,
    });
    expect(updated.llm).toEqual({
      provider: "custom",
      default_model: "model-b",
      credential_id: id,
      quota: 15,
    });
    expect(updated.security).toEqual(original.security);
    expect(original.llm.default_model).toBe("model-a");
  });
  it("ao mudar provedor sem escolher credencial não herda uma chave de outro provedor", () => {
    const changed = mesclarPadraoLlmDaOrganizacao(
      { llm: { provider: "custom", default_model: "a", credential_id: "pinned" } },
      { provider: "anthropic", default_model: "sonnet" },
    );
    expect(lerPadraoLlmDaOrganizacao(changed).credential_id).toBeNull();
  });

  it("não reaproveita valores malformados como configuração ativa", () => {
    expect(lerPadraoLlmDaOrganizacao({ llm: [] }).configured).toBe(false);
    expect(
      lerPadraoLlmDaOrganizacao({ llm: { provider: 123, default_model: {} } }).default_model,
    ).toBeNull();
  });
});
