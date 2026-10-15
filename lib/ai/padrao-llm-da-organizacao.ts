/**
 * O padrão de LLM do tenant é o mesmo usado pelo runtime:
 * organizations.settings.llm. Não reescrever versões publicadas e bindings.
 */
export interface PadraoDaOrganizacao {
  provider: string;
  default_model: string | null;
  credential_id: string | null;
  configured: boolean;
}
export function lerPadraoLlmDaOrganizacao(settings: unknown): PadraoDaOrganizacao & {
  settings: Record<string, unknown>;
} {
  const root =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const llm =
    root.llm && typeof root.llm === "object" && !Array.isArray(root.llm)
      ? (root.llm as Record<string, unknown>)
      : {};
  return {
    settings: root,
    provider: typeof llm.provider === "string" && llm.provider ? llm.provider : "anthropic",
    default_model:
      typeof llm.default_model === "string" && llm.default_model ? llm.default_model : null,
    credential_id:
      typeof llm.credential_id === "string" && llm.credential_id ? llm.credential_id : null,
    configured: typeof llm.provider === "string" && typeof llm.default_model === "string",
  };
}
export function mesclarPadraoLlmDaOrganizacao(
  settings: unknown,
  novo: { provider: string; default_model: string; credential_id?: string | null },
): Record<string, unknown> {
  const current = lerPadraoLlmDaOrganizacao(settings);
  const llmAnterior = current.settings.llm;
  const camposAnteriores =
    llmAnterior && typeof llmAnterior === "object" && !Array.isArray(llmAnterior)
      ? (llmAnterior as Record<string, unknown>)
      : {};
  return {
    ...current.settings,
    llm: {
      ...camposAnteriores,
      provider: novo.provider,
      default_model: novo.default_model,
      credential_id:
        novo.credential_id !== undefined
          ? novo.credential_id
          : novo.provider === current.provider
            ? current.credential_id
            : null,
    },
  };
}
