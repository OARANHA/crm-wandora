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
  it("não reaproveita valores malformados como configuração ativa", () => {
    expect(lerPadraoLlmDaOrganizacao({ llm: [] }).configured).toBe(false);
    expect(
      lerPadraoLlmDaOrganizacao({ llm: { provider: 123, default_model: {} } }).default_model,
    ).toBeNull();
  });
});
