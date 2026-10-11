/**
 * Exceção LIMITADA ao preparo/envio de DANFE para o administrador autorizado.
 * Não modifica o teto geral de mensagens nem autoriza templates ou texto livre.
 * A autorização é comprovada fora deste módulo pela tool administrativa
 * efetivamente montada no turno (WhatsApp → membership → erp.admin.read).
 */
export const MAX_DANFES_ADMIN_POR_TURNO = 5;

export function orcamentoDeStepsDanfeAdmin(input: {
  ferramentaAdminMontada: boolean;
  pedidoRecente: boolean;
  quantidade: number;
  limiteEnviosGeral: number;
  maxSteps: number;
}): number {
  const { ferramentaAdminMontada, pedidoRecente, quantidade, limiteEnviosGeral, maxSteps } = input;
  if (
    !ferramentaAdminMontada ||
    !pedidoRecente ||
    !Number.isInteger(quantidade) ||
    quantidade < 2 ||
    quantidade > MAX_DANFES_ADMIN_POR_TURNO ||
    limiteEnviosGeral < 3
  ) {
    return maxSteps;
  }
  // Busca + N preparos + N envios + margem finita para tool de identidade.
  return Math.max(maxSteps, quantidade * 2 + 4);
}

export function envioExtraDeDanfeAdminPermitido(input: {
  ferramentaAdminMontada: boolean;
  pedidoRecente: boolean;
  quantidade: number;
  limiteEnviosGeral: number;
  enviosRealizados: number;
  danfesEnviadas: number;
  documentoPreparado: boolean;
  numeroDaNotaPreparada: string | null;
  recenciaComprovada: boolean;
  numerosComprovados: ReadonlySet<string>;
}): boolean {
  const {
    ferramentaAdminMontada,
    pedidoRecente,
    quantidade,
    limiteEnviosGeral,
    enviosRealizados,
    danfesEnviadas,
    documentoPreparado,
    numeroDaNotaPreparada,
    recenciaComprovada,
    numerosComprovados,
  } = input;
  return (
    ferramentaAdminMontada &&
    pedidoRecente &&
    Number.isInteger(quantidade) &&
    quantidade >= 2 &&
    quantidade <= MAX_DANFES_ADMIN_POR_TURNO &&
    limiteEnviosGeral >= 3 &&
    Number.isInteger(danfesEnviadas) &&
    danfesEnviadas >= 0 &&
    danfesEnviadas < quantidade &&
    enviosRealizados >= danfesEnviadas &&
    enviosRealizados >= limiteEnviosGeral &&
    // Apenas o envio documental excepcional: textos não ganham orçamento extra.
    enviosRealizados - danfesEnviadas <= limiteEnviosGeral &&
    enviosRealizados < limiteEnviosGeral + quantidade &&
    documentoPreparado &&
    typeof numeroDaNotaPreparada === "string" &&
    numerosComprovados.has(numeroDaNotaPreparada) &&
    recenciaComprovada
  );
}
