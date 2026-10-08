/**
 * Classificação auditável do retorno de uma tool sem alterar a resposta ao modelo.
 * Um handler pode devolver { erro: ... } sem lançar; não é sucesso só porque
 * a Promise resolveu. As duas portas (agente interno e MCP externo) devem
 * aplicar a mesma classificação.
 */
import type { McpToolDefinition } from "./types";

export function classificarResultadoParaAuditoria(
  definicao: Pick<McpToolDefinition, "erroParaAuditoria" | "motivoDoVazio">,
  resultado: unknown,
): { success: boolean; desfecho?: "erro_resultado" | "sem_resultado"; motivo: string | null } {
  const erro = definicao.erroParaAuditoria?.(resultado) ?? null;
  if (erro !== null) return { success: false, desfecho: "erro_resultado", motivo: erro };

  const vazio = definicao.motivoDoVazio?.(resultado) ?? null;
  if (vazio !== null) return { success: false, desfecho: "sem_resultado", motivo: vazio };

  return { success: true, motivo: null };
}
