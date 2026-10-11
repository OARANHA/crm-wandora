/**
 * Exceção LIMITADA ao preparo/envio de DANFE para o administrador autorizado.
 * Não modifica o teto geral de mensagens nem autoriza templates ou texto livre.
 * A autorização é comprovada fora deste módulo pela tool administrativa
 * efetivamente montada no turno (WhatsApp → membership → erp.admin.read).
 */
export const MAX_DANFES_ADMIN_POR_TURNO = 5;

/** Somente aceitação pelo sender consome quota documental. */
export function envioDanfeAceitoPeloSender(
  kind: "sent" | "already_sent" | "queued" | "blocked" | "failed" | "unavailable",
): boolean {
  return kind === "sent" || kind === "already_sent" || kind === "queued";
}

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

/**
 * Exclusão mútua por turno para consumir o único slot de documento fiscal.
 * A aquisição é síncrona: duas chamadas da IA iniciadas em paralelo não podem
 * atravessar a verificação de um mesmo PDF pendente.
 */
export class ReservaEnvioDanfeAdmin {
  private ocupada = false;

  tentarReservar(): boolean {
    if (this.ocupada) return false;
    this.ocupada = true;
    return true;
  }

  liberar(): void {
    this.ocupada = false;
  }

  estaOcupada(): boolean {
    return this.ocupada;
  }
}

/**
 * Amarra o documento ao início do send_message: um preparo concluído durante
 * awaits do before_send não pode ser capturado por uma chamada de texto antiga.
 * Com pedido de "últimas notas", uma nova busca pode revogar a prova fiscal
 * durante a espera; nesse caso o documento também não pode sair.
 */
export function reservaDanfeAindaValida<T extends object>(input: {
  documentoNoInicio: T | null;
  documentoNoEnvio: T | null;
  numeroNoInicio: string | null;
  numeroNoEnvio: string | null;
  pedidoRecente: boolean;
  recenciaComprovada: boolean;
  numerosComprovados: ReadonlySet<string>;
}): boolean {
  const {
    documentoNoInicio,
    documentoNoEnvio,
    numeroNoInicio,
    numeroNoEnvio,
    pedidoRecente,
    recenciaComprovada,
    numerosComprovados,
  } = input;
  return (
    documentoNoInicio !== null &&
    documentoNoEnvio === documentoNoInicio &&
    numeroNoInicio !== null &&
    numeroNoInicio === numeroNoEnvio &&
    (!pedidoRecente || (recenciaComprovada && numerosComprovados.has(numeroNoInicio)))
  );
}
