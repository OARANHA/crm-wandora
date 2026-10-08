/**
 * Gate determinístico de afirmações sobre NFes mais recentes.
 *
 * O histórico da conversa e o número da NFe não são provas de recência.
 * Somente um retorno fiscal completo da capability oficial no turno pode
 * liberar uma resposta que afirma "última nota" ou anexa a DANFE correspondente.
 */
export const AVISO_SEM_RECENCIA_FISCAL =
  "Não consegui comprovar qual é a nota fiscal mais recente neste atendimento. " +
  "Não vou apresentar uma nota conhecida do histórico como a última, " +
  "nem anexar uma DANFE sem confirmar primeiro a recência fiscal. " +
  "É necessário consultar as NFes por período para concluir com segurança.";

export function pedidoDeNfeMaisRecente(texto: string): boolean {
  const normalizado = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const mencionaNota = /\b(?:notas?|nf-?es?)\b/.test(normalizado);
  const mencionaRecencia = /\bultim[ao]s?\b|\bmais\s+recentes?\b/.test(normalizado);
  return mencionaNota && mencionaRecencia;
}

export function recenciaFiscalComprovada(resultado: unknown): boolean {
  if (resultado === null || typeof resultado !== "object" || Array.isArray(resultado)) return false;
  const resposta = resultado as Record<string, unknown>;
  if (!Array.isArray(resposta.notas) || resposta.notas.length === 0) return false;
  const resumo = resposta.resumo;
  if (!resumo || typeof resumo !== "object" || Array.isArray(resumo)) return false;
  if ((resumo as Record<string, unknown>).consultaCompleta !== true) return false;
  return resposta.notas.every(
    (nota) =>
      nota !== null &&
      typeof nota === "object" &&
      !Array.isArray(nota) &&
      typeof nota.numeroNFe === "string" &&
      nota.numeroNFe.length > 0 &&
      typeof nota.dataEmissao === "string" &&
      nota.dataEmissao.length > 0,
  );
}

/** Somente números que a busca fiscal certificou entram no preparo de DANFE. */
export function numerosDaBuscaFiscalComprovada(resultado: unknown): string[] {
  if (!recenciaFiscalComprovada(resultado)) return [];
  const notas = (resultado as { notas: Array<{ numeroNFe: string }> }).notas;
  return notas.map((n) => n.numeroNFe);
}

/**
 * Limite de NFes que podem ser anunciadas como "as últimas" no pedido atual.
 * A consulta fiscal já ordena por emissão decrescente: jamais usar um item mais
 * antigo da mesma página só porque ele aparece no retorno.
 */
export function quantidadeDeNotasMaisRecentesPedida(texto: string): number {
  const normalizado = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const quantidadePorPalavra: Record<string, number> = {
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
  };
  const numero = "(\\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)";
  const padroes = [
    new RegExp("\\bultim[ao]s?\\s+" + numero + "\\b"),
    new RegExp("\\b" + numero + "\\s+ultim[ao]s?\\b"),
    new RegExp("\\b" + numero + "\\s+notas?\\s+(?:fiscais?\\s+)?mais\\s+recentes?\\b"),
  ];
  for (const padrao of padroes) {
    const encontrado = normalizado.match(padrao);
    const termo = encontrado?.[1];
    if (!termo) continue;
    const quantidade = quantidadePorPalavra[termo] ?? Number(termo);
    if (Number.isInteger(quantidade) && quantidade >= 1 && quantidade <= 20) return quantidade;
  }
  // "A última nota" significa uma. "As últimas notas" segue o default
  // contratual do provider (até três) quando não há N explícito.
  if (/\bultim[ao]\b|\bmais\s+recente\b/.test(normalizado)) return 1;
  return 3;
}

/**
 * Não deixe o modelo alegar "última NFe #X" com um número fora do
 * subconjunto efetivamente ranqueado pela consulta fiscal deste turno.
 */
export function mencionaNfeNaoComprovada(
  texto: string,
  numerosAutorizados: ReadonlySet<string>,
): boolean {
  const padrao =
    /\b(?:nf[\s.-]*e|nota(?:\s+fiscal)?)\s*(?:n[ºo°.]*(?:\s+de\s+numero)?\s*)?[:#-]?\s*(\d{3,12})\b/gi;
  for (const match of texto.matchAll(padrao)) {
    const numero = (match[1] ?? "").replace(/^0+(?=\d)/, "");
    if (numero && !numerosAutorizados.has(numero)) return true;
  }
  return false;
}
