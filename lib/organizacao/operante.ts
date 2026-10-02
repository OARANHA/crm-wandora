/**
 * A ORGANIZAÇÃO OPERA OU NÃO OPERA — a régua única do predicado (spec cobrança
 * do revendedor, §4). Espelho SQL: `public.fn_org_operante(uuid)` (migration 0502).
 * O predicado e o erro entram em tarefa posterior da PR 1; aqui nasce só o
 * vocabulário que o invariante `vocabulario-banco-x-typescript` cobra.
 */

/** Por que a organização está suspensa. Par de `organizations_suspended_kind_check` (0502). */
export const TIPOS_DE_SUSPENSAO = ["administrativa", "cobranca"] as const;
export type TipoDeSuspensao = (typeof TIPOS_DE_SUSPENSAO)[number];
