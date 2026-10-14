import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({ embed: vi.fn() }));
vi.mock("@/lib/ai/embeddings/chutes-qwen3-tee", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, solicitarEmbeddingQwen3: stub.embed };
});

import { embedText } from "@/lib/ai/embed";
import { validateProviderKey } from "@/lib/ai/provider-validators";
import {
  CHUTES_QWEN3_VECTOR_MODEL,
  ErroEmbeddingQwen3,
} from "@/lib/ai/embeddings/chutes-qwen3-tee";
import type { ChaveDeEmbedding } from "@/lib/ai/embeddings/chave";

const TOKEN_SINTETICO = "chave-falsa-para-testes";
const credencial: ChaveDeEmbedding = {
  apiKey: TOKEN_SINTETICO,
  baseUrl: null,
  viaGateway: false,
  provedor: "chutes",
  origem: "credencial_da_organizacao",
  rotulo: "Chutes teste",
  avisos: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  stub.embed.mockResolvedValue({
    model: CHUTES_QWEN3_VECTOR_MODEL,
    embedding: Array(1536).fill(0.02),
  });
});

describe("Chutes Qwen3 - seam canonico pareado e sem rede", () => {
  it("indexar e consultar usam a MESMA identidade de vetor, com instruções distintas", async () => {
    const documento = await embedText("Cartela Prorevest PR001", {
      organizationId: "org-1",
      chave: credencial,
      ponto: "embedding_indexar",
    });
    const consulta = await embedText("Tem a cor PR001?", {
      organizationId: "org-1",
      chave: credencial,
      ponto: "embedding_consultar",
    });
    expect(documento.model).toBe(CHUTES_QWEN3_VECTOR_MODEL);
    expect(consulta.model).toBe(CHUTES_QWEN3_VECTOR_MODEL);
    expect(documento.embedding).toHaveLength(1536);
    expect(stub.embed).toHaveBeenNthCalledWith(
      1,
      "Cartela Prorevest PR001",
      "documento",
      TOKEN_SINTETICO,
    );
    expect(stub.embed).toHaveBeenNthCalledWith(2, "Tem a cor PR001?", "consulta", TOKEN_SINTETICO);
  });

  it("nunca aceita modelo de outra familia ou gateway externo", async () => {
    await expect(
      embedText("Teste", {
        organizationId: "org-1",
        chave: credencial,
        model: "openai/text-embedding-3-small" as never,
      }),
    ).rejects.toThrow("embedding_chutes_contrato_ou_chave_invalida");
    await expect(
      embedText("Teste", { organizationId: "org-1", chave: { ...credencial, viaGateway: true } }),
    ).rejects.toThrow("embedding_chutes_contrato_ou_chave_invalida");
    expect(stub.embed).not.toHaveBeenCalled();
  });

  it("valida pela operação de embedding real, não por /models público", async () => {
    expect(await validateProviderKey("chutes", TOKEN_SINTETICO)).toEqual({
      ok: true,
      models: [CHUTES_QWEN3_VECTOR_MODEL],
    });
    expect(stub.embed).toHaveBeenCalledWith(
      "Teste de indexação de conhecimento",
      "documento",
      TOKEN_SINTETICO,
    );
  });

  it("validação recusa contrato do provider sem refletir credencial", async () => {
    stub.embed.mockRejectedValueOnce(new ErroEmbeddingQwen3("modelo_divergente"));
    expect(await validateProviderKey("chutes", TOKEN_SINTETICO)).toEqual({
      ok: false,
      error: "modelo_divergente",
    });
    stub.embed.mockRejectedValueOnce(new Error("segredo-recebido-de-volta"));
    const outra = await validateProviderKey("chutes", TOKEN_SINTETICO);
    expect(outra).toEqual({ ok: false, error: "provider_unavailable" });
    expect(JSON.stringify(outra)).not.toContain(TOKEN_SINTETICO);
  });
});
