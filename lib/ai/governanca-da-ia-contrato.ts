/**
 * Contrato de permissões técnicas da IA que pode atravessar Server Components
 * e Client Components. Somente tipos e constantes — sem env, Supabase ou I/O.
 *
 * A autorização continua exclusivamente no servidor em governanca-da-ia.ts.
 */
export const CHAVES_AUTONOMIA_IA = ["provider", "model", "credentials", "operator_model"] as const;
export type ChaveAutonomiaIa = (typeof CHAVES_AUTONOMIA_IA)[number];
export type AutonomiaIa = Record<ChaveAutonomiaIa, boolean>;

export const AUTONOMIA_IA_PADRAO: Readonly<AutonomiaIa> = Object.freeze({
  provider: false,
  model: false,
  credentials: false,
  operator_model: false,
});
