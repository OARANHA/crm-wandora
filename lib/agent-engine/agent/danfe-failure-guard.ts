/**
 * Proteção do turno administrativo: uma tentativa de DANFE por NFe e nenhuma
 * promessa de envio posterior quando o renderizador falhou.
 *
 * Estado isolado por invocation do inbound_turn. Não substitui o renderer, nem
 * envia nada: send_message continua no caminho before_send → ledger → canal.
 */
export const AVISO_FALHA_DANFE =
  "Não consegui gerar nem anexar o PDF da DANFE neste atendimento por uma falha técnica. " +
  "Nenhum documento foi enviado e não há envio automático posterior agendado. " +
  "É necessário corrigir a geração do PDF antes de repetir a solicitação.";

export class GuardaFalhaDanfeNoTurno {
  private readonly numerosTentados = new Set<string>();
  falhou = false;
  avisoEnviado = false;

  iniciarTentativa(numero: string): boolean {
    if (!/^[0-9]+$/.test(numero) || this.numerosTentados.has(numero)) return false;
    this.numerosTentados.add(numero);
    return true;
  }

  registrarResultado(resultado: unknown): void {
    if (
      resultado === null ||
      typeof resultado !== "object" ||
      (resultado as { ok?: unknown }).ok !== true
    )
      this.falhou = true;
  }

  registrarExcecao(): void {
    this.falhou = true;
  }

  deveInformarFalha(temDocumentoPreparado: boolean): boolean {
    return this.falhou && !temDocumentoPreparado;
  }
}
