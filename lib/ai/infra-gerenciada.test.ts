import { beforeEach, describe, expect, it, vi } from "vitest";

const ambiente = {
  chavesDeProvedor: {} as Record<string, boolean>,
};

vi.mock("@/lib/instalacao/ambiente", () => ({
  lerAmbiente: () => ambiente,
}));

import { resolverInfraIaGerenciada } from "./infra-gerenciada";

function dbFalso(args: {
  settings: unknown;
  credentialId?: string | null;
}) {
  const from = vi.fn((table: string) => {
    if (table === "organizations") {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({
          data: { settings: args.settings },
          error: null,
        })),
      };
      return chain;
    }
    if (table === "ai_provider_credentials") {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        not: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({
          data: args.credentialId ? { id: args.credentialId } : null,
          error: null,
        })),
      };
      return chain;
    }
    throw new Error(`tabela inesperada: ${table}`);
  });
  return { from } as never;
}

beforeEach(() => {
  ambiente.chavesDeProvedor = {};
});

describe("resolverInfraIaGerenciada", () => {
  it("usa provider/model da organização e chave da instalação quando ela existe", async () => {
    ambiente.chavesDeProvedor = { openai: true };
    const db = dbFalso({
      settings: { llm: { provider: "openai", default_model: "gpt-5-mini" } },
      credentialId: "cred-nao-deveria-ser-lida",
    });

    await expect(resolverInfraIaGerenciada(db, "org-1")).resolves.toEqual({
      provider: "openai",
      model: "gpt-5-mini",
      credentialId: null,
    });
  });

  it("sem chave da instalação usa a credencial validada resolvida pelo banco", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const db = dbFalso({
      settings: { llm: { provider: "openai", default_model: "gpt-5-mini" } },
      credentialId: id,
    });

    await expect(resolverInfraIaGerenciada(db, "org-1")).resolves.toEqual({
      provider: "openai",
      model: "gpt-5-mini",
      credentialId: id,
    });
  });

  it("falha fechado quando falta o modelo gerenciado", async () => {
    const db = dbFalso({
      settings: { llm: { provider: "openai" } },
    });

    await expect(resolverInfraIaGerenciada(db, "org-1")).resolves.toBeNull();
  });

  it("falha fechado quando não existe nenhuma chave utilizável", async () => {
    const db = dbFalso({
      settings: { llm: { provider: "openai", default_model: "gpt-5-mini" } },
      credentialId: null,
    });

    await expect(resolverInfraIaGerenciada(db, "org-1")).resolves.toBeNull();
  });
});
