/**
 * Projeção EXCLUSIVAMENTE de auditoria. Nunca exportar mensagem, input fiscal,
 * XML, nome, documento, URL ou erro arbitrário do provider para o ledger.
 * O retorno da tool para o modelo permanece inalterado.
 */
const CODIGOS_FISCAIS_PERMITIDOS = new Set([
  "mes_necessario",
  "mes_invalido",
  "quantidade_invalida",
  "filtros_cliente_conflitantes",
  "cliente_ambiguo",
  "cliente_nao_resolvido",
  "identidade_fiscal_nao_confirmada",
  "identidade_fiscal_conflitante",
  "erp_read_failed",
  "janela_fiscal_insuficiente",
  "consulta_parcial",
  "consulta_inconsistente",
  "invalid_response",
]);

export function erroFiscalRecenteParaAuditoria(resultado: unknown): string | null {
  if (resultado === null || typeof resultado !== "object" || Array.isArray(resultado)) return null;
  if (!Object.prototype.hasOwnProperty.call(resultado, "erro")) return null;
  const erro = (resultado as Record<string, unknown>).erro;
  return typeof erro === "string" && CODIGOS_FISCAIS_PERMITIDOS.has(erro)
    ? erro
    : "erro_fiscal_nao_classificado";
}

export function vazioFiscalRecenteParaAuditoria(resultado: unknown): string | null {
  if (resultado === null || typeof resultado !== "object" || Array.isArray(resultado)) return null;
  const r = resultado as Record<string, unknown>;
  // Lista fiscal completa, porém sem NFe: ausência de achado, não erro técnico.
  return Array.isArray(r.notas) && r.notas.length === 0 && r.erro === undefined
    ? "sem_nfes_no_periodo"
    : null;
}
