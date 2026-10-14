/**
 * Chutes Qwen3-Embedding-8B-TEE: adapter de transporte e projecao vetorial.
 *
 * Gate OFFLINE: este modulo nao esta ligado ao resolvedor de credenciais,
 * indexador ou busca em producao. Nenhuma credencial ou consulta e executada
 * durante a importacao. A ativacao requer gate separado.
 *
 * Endpoint oficial fixo (sem parametro de URL ou redirect configuravel).
 * O contrato publicado do chute so documenta input e model no request;
 * a projecao MRL acontece localmente apos validar a resposta real.
 */
export const CHUTES_QWEN3_EMBEDDINGS_URL =
  "https://chutes-qwen-qwen3-embedding-8b-tee.chutes.ai/v1/embeddings";
export const CHUTES_QWEN3_API_MODEL = "Qwen/Qwen3-Embedding-8B-TEE";
export const CHUTES_QWEN3_VECTOR_MODEL = "chutes/Qwen3-Embedding-8B-TEE:mrl1536-l2-v1";
export const CHUTES_QWEN3_TARGET_DIMS = 1536;

const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const QUERY_INSTRUCTION =
  "Given a customer question in any language, retrieve relevant factual passages from the company's product and technical documentation.";

export type FinalidadeEmbeddingQwen3 = "documento" | "consulta";

export class ErroEmbeddingQwen3 extends Error {
  constructor(readonly codigo: string) {
    super("Embedding Qwen3 indisponivel ou com contrato invalido: " + codigo);
    this.name = "ErroEmbeddingQwen3";
  }
}

export interface ResultadoEmbeddingQwen3 {
  embedding: number[];
  model: typeof CHUTES_QWEN3_VECTOR_MODEL;
}

export function prepararEntradaQwen3(texto: string, finalidade: FinalidadeEmbeddingQwen3): string {
  if (typeof texto !== "string" || !texto.trim() || texto.length > 12_000) {
    throw new ErroEmbeddingQwen3("entrada_invalida");
  }
  if (finalidade !== "documento" && finalidade !== "consulta") {
    throw new ErroEmbeddingQwen3("finalidade_invalida");
  }
  // Documento SEM instrucao. Somente a consulta recebe a tarefa de retrieval.
  return finalidade === "consulta" ? "Instruct: " + QUERY_INSTRUCTION + "\nQuery: " + texto : texto;
}

/**
 * Aceita EXATAMENTE 1536 ou 4096 valores numericos finitos.
 * Nao inventa compatibilidade com modelos/familias anteriores.
 * Qwen3 MRL: prefixo dos primeiros 1536 valores, normalizado L2.
 */
export function projetarEmbeddingQwen3(valor: unknown): number[] {
  if (
    !Array.isArray(valor) ||
    (valor.length !== CHUTES_QWEN3_TARGET_DIMS && valor.length !== 4096) ||
    !valor.every((x) => typeof x === "number" && Number.isFinite(x))
  ) {
    throw new ErroEmbeddingQwen3("vetor_invalido");
  }
  const trecho: number[] = valor.slice(0, CHUTES_QWEN3_TARGET_DIMS);
  let escala = 0;
  for (const x of trecho) escala = Math.max(escala, Math.abs(x));
  if (escala === 0 || !Number.isFinite(escala)) {
    throw new ErroEmbeddingQwen3("vetor_nulo");
  }
  let soma = 0;
  for (const x of trecho) soma += (x / escala) ** 2;
  const norma = Math.sqrt(soma);
  if (!(norma > 0) || !Number.isFinite(norma)) {
    throw new ErroEmbeddingQwen3("norma_invalida");
  }
  const final = trecho.map((x) => x / escala / norma);
  if (final.some((x) => !Number.isFinite(x))) {
    throw new ErroEmbeddingQwen3("projecao_invalida");
  }
  return final;
}

async function lerRespostaLimitada(response: Response): Promise<string> {
  if (!response.body) throw new ErroEmbeddingQwen3("resposta_vazia");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        throw new ErroEmbeddingQwen3("resposta_excessiva");
      }
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Adaptador SOMENTE da operacao de embeddings. A credencial precisa ser
 * resolvida pelo cofre/capability canonicamente, nunca do usuario ou do LLM.
 * fetchImpl e um seam injetado APENAS por testes sem rede.
 */
export async function solicitarEmbeddingQwen3(
  texto: string,
  finalidade: FinalidadeEmbeddingQwen3,
  tokenDeAcessoChutes: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResultadoEmbeddingQwen3> {
  const entrada = prepararEntradaQwen3(texto, finalidade);
  if (
    typeof tokenDeAcessoChutes !== "string" ||
    !tokenDeAcessoChutes.trim() ||
    /[\r\n]/.test(tokenDeAcessoChutes) ||
    tokenDeAcessoChutes.length > 8192
  ) {
    throw new ErroEmbeddingQwen3("credencial_invalida");
  }

  let response: Response;
  try {
    response = await fetchImpl(CHUTES_QWEN3_EMBEDDINGS_URL, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: "Bearer " + tokenDeAcessoChutes,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        input: entrada,
        model: CHUTES_QWEN3_API_MODEL,
      }),
    });
  } catch {
    // Nao propagar headers, payload, endpoint interpolado ou erro do provider.
    throw new ErroEmbeddingQwen3("transporte_falhou");
  }

  if (!response.ok) {
    throw new ErroEmbeddingQwen3("http_" + response.status);
  }
  const tamanho = Number(response.headers.get("content-length"));
  if (Number.isFinite(tamanho) && tamanho > MAX_RESPONSE_BYTES) {
    throw new ErroEmbeddingQwen3("resposta_excessiva");
  }
  let corpo: unknown;
  try {
    corpo = JSON.parse(await lerRespostaLimitada(response));
  } catch (err) {
    if (err instanceof ErroEmbeddingQwen3) throw err;
    throw new ErroEmbeddingQwen3("json_invalido");
  }
  const obj = corpo as {
    data?: Array<{ embedding?: unknown; index?: unknown }>;
    model?: unknown;
  } | null;
  if (
    !obj ||
    !Array.isArray(obj.data) ||
    obj.data.length !== 1 ||
    (obj.data[0]?.index !== undefined && obj.data[0]?.index !== 0)
  ) {
    throw new ErroEmbeddingQwen3("formato_invalido");
  }
  if (obj.model !== undefined && obj.model !== CHUTES_QWEN3_API_MODEL) {
    throw new ErroEmbeddingQwen3("modelo_divergente");
  }
  return {
    embedding: projetarEmbeddingQwen3(obj.data[0]?.embedding),
    model: CHUTES_QWEN3_VECTOR_MODEL,
  };
}
