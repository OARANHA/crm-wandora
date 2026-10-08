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
  const normalizado = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const mencionaNota = /\b(?:notas?|nf-?es?)\b/.test(normalizado);
  const mencionaRecencia = /\bultim[ao]s?\b|\bmais\s+recentes?\b/.test(normalizado);
  return mencionaNota && mencionaRecencia;
}

export function recenciaFiscalComprovada(resultado: unknown): boolean {
  if (resultado === null || typeof resultado !== "object" || Array.isArray(resultado))
    return false;
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
