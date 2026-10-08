/**
 * Contexto efêmero do turno: preserva SOMENTE a quantidade de notas fiscais
 * solicitada quando o fallback muda de nome para contato vinculado.
 *
 * Não grava em banco, não armazena PII, não consulta o VendaERP e não é
 * autoridade para selecionar NFes: esse ranking sempre cabe à capability ERP.
 */
type EscopoTurno = { organizationId: string; requestId: string };

const PENDENCIA_NOTAS_RECENTES_TTL_MS = 120_000;
const pendentes = new Map<string, { quantidade: number; expiraEm: number }>();

function chaveTurno(ctx: EscopoTurno): string {
  return `${ctx.organizationId}:${ctx.requestId}`;
}

export function registrarNotasRecentesPendentes(ctx: EscopoTurno, quantidade: number): void {
  const agora = Date.now();
  for (const [chave, pendencia] of pendentes) {
    if (pendencia.expiraEm <= agora) pendentes.delete(chave);
  }
  pendentes.set(chaveTurno(ctx), {
    quantidade,
    expiraEm: agora + PENDENCIA_NOTAS_RECENTES_TTL_MS,
  });
}

export function notasRecentesPendentes(ctx: EscopoTurno): number | null {
  const chave = chaveTurno(ctx);
  const pendencia = pendentes.get(chave);
  if (!pendencia) return null;
  if (pendencia.expiraEm <= Date.now()) {
    pendentes.delete(chave);
    return null;
  }
  return pendencia.quantidade;
}

export function limparNotasRecentesPendentes(ctx: EscopoTurno): void {
  pendentes.delete(chaveTurno(ctx));
}
