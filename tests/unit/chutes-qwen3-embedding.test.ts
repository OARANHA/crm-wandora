import { describe, expect, it, vi } from "vitest";

import {
  CHUTES_QWEN3_API_MODEL,
  CHUTES_QWEN3_EMBEDDINGS_URL,
  CHUTES_QWEN3_TARGET_DIMS,
  CHUTES_QWEN3_VECTOR_MODEL,
  prepararEntradaQwen3,
  projetarEmbeddingQwen3,
  solicitarEmbeddingQwen3,
} from "@/lib/ai/embeddings/chutes-qwen3-tee";

const CHAVE_SINTETICA = "teste_chutes_nao_real";

function vetor(largura = 4096): number[] {
  const vetor = Array.from({ length: largura }, () => 0);
  vetor[0] = 3;
  vetor[1] = 4;
  if (largura > CHUTES_QWEN3_TARGET_DIMS) vetor[2048] = 900;
  return vetor;
}

function resposta(
  valor: unknown,
  opt: { modelo?: string; status?: number; index?: number } = {},
): Response {
  return new Response(
    JSON.stringify({
      object: "list",
      model: opt.modelo ?? CHUTES_QWEN3_API_MODEL,
      data: [{ index: opt.index ?? 0, embedding: valor }],
    }),
    { status: opt.status ?? 200, headers: { "content-type": "application/json" } },
  );
}

describe("Chutes Qwen3 Embedding - adapter isolado sem rede", () => {
  it("define uma identidade vetorial distinta de OpenAI e Google", () => {
    expect(CHUTES_QWEN3_VECTOR_MODEL).toContain("mrl1536");
    expect(CHUTES_QWEN3_VECTOR_MODEL).not.toBe("openai/text-embedding-3-small");
    expect(CHUTES_QWEN3_EMBEDDINGS_URL).toBe(
      "https://chutes-qwen-qwen3-embedding-8b-tee.chutes.ai/v1/embeddings",
    );
  });

  it("aplica MRL aos primeiros 1536 de 4096 e renormaliza L2", () => {
    const saida = projetarEmbeddingQwen3(vetor());
    expect(saida).toHaveLength(1536);
    expect(saida[0]).toBeCloseTo(0.6);
    expect(saida[1]).toBeCloseTo(0.8);
    expect(saida.slice(2).every((v) => v === 0)).toBe(true);
  });

  it("aceita vetor nativo de 1536 e normaliza sem alterar a ordem", () => {
    const saida = projetarEmbeddingQwen3(vetor(1536));
    expect(saida).toHaveLength(1536);
    expect(saida[0]).toBeCloseTo(0.6);
    expect(saida[1]).toBeCloseTo(0.8);
  });

  it("usa instrucao somente na consulta e preserva documento", () => {
    expect(prepararEntradaQwen3("Epóxi para aço", "documento")).toBe("Epóxi para aço");
    const consulta = prepararEntradaQwen3("Epóxi para aço", "consulta");
    expect(consulta).toMatch(/^Instruct: /);
    expect(consulta).toContain("\nQuery: Epóxi para aço");
  });

  it("envia POST fixo sem dimensions, sem redirect e retorna a identidade pinada", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => resposta(vetor()));
    const resultado = await solicitarEmbeddingQwen3(
      "qual primer usar?",
      "consulta",
      CHAVE_SINTETICA,
      fetcher,
    );
    expect(resultado.model).toBe(CHUTES_QWEN3_VECTOR_MODEL);
    expect(resultado.embedding).toHaveLength(1536);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe(CHUTES_QWEN3_EMBEDDINGS_URL);
    expect(options?.method).toBe("POST");
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(options?.body));
    expect(Object.keys(body).sort()).toEqual(["input", "model"]);
    expect(body.model).toBe(CHUTES_QWEN3_API_MODEL);
    expect(body.input).toContain("\nQuery: qual primer usar?");
    expect(options?.headers).toMatchObject({
      Authorization: "Bearer " + CHAVE_SINTETICA,
    });
  });

  it("nao adiciona instrucao para indexar documento", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      expect(JSON.parse(String(options?.body)).input).toBe("Fundo para aço galvanizado");
      return resposta(vetor());
    });
    await solicitarEmbeddingQwen3(
      "Fundo para aço galvanizado",
      "documento",
      CHAVE_SINTETICA,
      fetcher,
    );
  });

  it.each([768, 2048, 4095, 4097])("recusa vetor de %i dimensoes fora do contrato", (dimensoes) => {
    expect(() => projetarEmbeddingQwen3(vetor(dimensoes))).toThrow("vetor_invalido");
  });

  it("recusa NaN mesmo na cauda descartada da projecao", () => {
    const invalido = vetor();
    invalido[4095] = NaN;
    expect(() => projetarEmbeddingQwen3(invalido)).toThrow("vetor_invalido");
  });

  it("recusa vetor de prefixo nulo, sem enviar coordenadas falsas", () => {
    const invalido = Array.from({ length: 4096 }, () => 0);
    invalido[2048] = 9;
    expect(() => projetarEmbeddingQwen3(invalido)).toThrow("vetor_nulo");
  });

  it("recusa modelo divergente mesmo com 1536 dimensoes", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      resposta(vetor(1536), { modelo: "openai/text-embedding-3-small" }),
    );
    await expect(
      solicitarEmbeddingQwen3("teste", "documento", CHAVE_SINTETICA, fetcher),
    ).rejects.toMatchObject({ codigo: "modelo_divergente" });
  });

  it("recusa tipo incorreto de modelo declarado, sem aceitar identidade indefinida", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ model: 37, data: [{ index: 0, embedding: vetor() }] })),
    );
    await expect(
      solicitarEmbeddingQwen3("teste", "documento", CHAVE_SINTETICA, fetcher),
    ).rejects.toMatchObject({ codigo: "modelo_divergente" });
  });

  it("recusa resposta 503 e nao interpreta JSON de erro como ausencia de produto", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("erro externo", { status: 503 }));
    await expect(
      solicitarEmbeddingQwen3("teste", "consulta", CHAVE_SINTETICA, fetcher),
    ).rejects.toMatchObject({ codigo: "http_503" });
  });

  it("recusa redirecionamento 302 para qualquer destino", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://outro-exemplo.invalid/redirect" },
        }),
    );
    await expect(
      solicitarEmbeddingQwen3("teste", "consulta", CHAVE_SINTETICA, fetcher),
    ).rejects.toMatchObject({ codigo: "http_302" });
  });

  it("recusa JSON ilegivel ou estrutura inesperada", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("<html>falha</html>"));
    await expect(
      solicitarEmbeddingQwen3("teste", "documento", CHAVE_SINTETICA, fetcher),
    ).rejects.toMatchObject({ codigo: "json_invalido" });
    fetcher.mockImplementation(async () => new Response('{"data":[]}'));
    await expect(
      solicitarEmbeddingQwen3("teste", "documento", CHAVE_SINTETICA, fetcher),
    ).rejects.toMatchObject({ codigo: "formato_invalido" });
  });

  it("recusa resposta com tamanho declarado acima do limite", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response("{}", {
          headers: { "content-length": String(1024 * 1024 + 1) },
        }),
    );
    await expect(
      solicitarEmbeddingQwen3("teste", "consulta", CHAVE_SINTETICA, fetcher),
    ).rejects.toMatchObject({ codigo: "resposta_excessiva" });
  });

  it("recusa resposta transmitida grande mesmo sem Content-Length", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("x".repeat(1024 * 1024 + 1)));
    await expect(
      solicitarEmbeddingQwen3("teste", "documento", CHAVE_SINTETICA, fetcher),
    ).rejects.toMatchObject({ codigo: "resposta_excessiva" });
  });

  it("nao expoe tokens nem mensagens remotas em excecoes", async () => {
    const marcador = "SEGREDO_NAO_EXPOR_EM_LOG";
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error(marcador);
    });
    await expect(
      solicitarEmbeddingQwen3("teste", "documento", marcador, fetcher),
    ).rejects.toMatchObject({ codigo: "transporte_falhou" });
    try {
      await solicitarEmbeddingQwen3("teste", "documento", marcador, fetcher);
    } catch (err) {
      expect(String(err)).not.toContain(marcador);
    }
  });

  it("bloqueia entrada vazia e token com CRLF antes de usar transporte", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => resposta(vetor()));
    await expect(
      solicitarEmbeddingQwen3(" ", "consulta", CHAVE_SINTETICA, fetcher),
    ).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(
      solicitarEmbeddingQwen3("teste", "consulta", "abc\nX-Header: injetado", fetcher),
    ).rejects.toMatchObject({ codigo: "credencial_invalida" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
