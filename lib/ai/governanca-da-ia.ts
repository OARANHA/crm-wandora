import type { AuthUser } from "@/lib/auth/types";
import { fail } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Autonomia técnica é autorização de EDIÇÃO, nunca chave de execução.
 * Ao revogar, agentes publicados e credenciais existentes continuam intactos.
 * Coluna isolada organizations.ai_autonomy: salvar settings não reabre acesso revogado.
 * Ausência/corrupção/erro de leitura: nenhum poder técnico é concedido ao tenant.
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

type Ator = Pick<AuthUser, "is_platform_admin" | "platform_admin_scope" | "support">;

export function podeGerenciarIaDaPlataforma(user: Ator): boolean {
  return user.is_platform_admin === true && user.platform_admin_scope === "full" && !user.support;
}

export function interpretarAutonomiaIa(value: unknown): AutonomiaIa {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    provider: raw.provider === true,
    model: raw.model === true,
    credentials: raw.credentials === true,
    operator_model: raw.operator_model === true,
  };
}

export async function lerAutonomiaIa(orgId: string): Promise<AutonomiaIa | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return null;
  try {
    const { data, error } = await createAdminClient()
      .from("organizations")
      .select("ai_autonomy")
      .eq("id", orgId)
      .maybeSingle();
    if (error || !data) return null;
    return interpretarAutonomiaIa(data.ai_autonomy);
  } catch {
    return null;
  }
}

export async function autonomiaEfetiva(user: Ator, orgId: string): Promise<AutonomiaIa> {
  if (podeGerenciarIaDaPlataforma(user))
    return { provider: true, model: true, credentials: true, operator_model: true };
  if (user.support) return { ...AUTONOMIA_IA_PADRAO };
  return (await lerAutonomiaIa(orgId)) ?? { ...AUTONOMIA_IA_PADRAO };
}

export async function podeConfigurarIa(
  user: Ator,
  orgId: string,
  chave: ChaveAutonomiaIa,
): Promise<boolean> {
  const permissoes = await autonomiaEfetiva(user, orgId);
  return permissoes[chave] === true;
}

export async function recusaConfiguracaoDeIa(
  user: Ator,
  orgId: string,
  chave: ChaveAutonomiaIa,
  requestId?: string,
): Promise<Response | null> {
  return (await podeConfigurarIa(user, orgId, chave))
    ? null
    : fail(
        "forbidden_platform_ai",
        "Esta configuração técnica de IA é gerenciada pela plataforma ELUS.",
        403,
        { requestId },
      );
}

export type CamposTecnicosDaVersao = {
  provider?: string | null;
  model?: string | null;
  credential_id?: string | null;
  operator_model?: string | null;
};

/** Compara a escolha com a versão anterior. Reenvio idêntico não exige autonomia. */
export function mudancasTecnicas(
  antes: CamposTecnicosDaVersao,
  depois: CamposTecnicosDaVersao,
): ChaveAutonomiaIa[] {
  const resultado: ChaveAutonomiaIa[] = [];
  const pares: readonly [keyof CamposTecnicosDaVersao, ChaveAutonomiaIa][] = [
    ["provider", "provider"],
    ["model", "model"],
    ["credential_id", "credentials"],
    ["operator_model", "operator_model"],
  ];
  for (const [campo, poder] of pares) {
    if (depois[campo] === undefined) continue;
    if ((antes[campo] ?? null) !== (depois[campo] ?? null)) resultado.push(poder);
  }
  return resultado;
}

export async function validarMudancasTecnicas(
  user: Ator,
  orgId: string,
  antes: CamposTecnicosDaVersao,
  depois: CamposTecnicosDaVersao,
): Promise<ChaveAutonomiaIa[]> {
  const mudancas = mudancasTecnicas(antes, depois);
  if (mudancas.length === 0) return [];
  const permissoes = await autonomiaEfetiva(user, orgId);
  return mudancas.filter((campo) => !permissoes[campo]);
}

/** Configuração inicial sempre nasce do servidor, nunca de campos enviados pelo tenant. */
export async function padraoTecnicoDaOrganizacao(
  orgId: string,
): Promise<CamposTecnicosDaVersao | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();
    if (error || !data) return null;
    const settings = data.settings;
    const llm =
      settings && typeof settings === "object" && !Array.isArray(settings)
        ? (settings as Record<string, unknown>).llm
        : null;
    const p =
      llm && typeof llm === "object" && !Array.isArray(llm) ? (llm as Record<string, unknown>) : {};
    return {
      provider: typeof p.provider === "string" && p.provider ? p.provider : "anthropic",
      model:
        typeof p.default_model === "string" && p.default_model
          ? p.default_model
          : "anthropic/claude-sonnet-5",
      credential_id: null,
      operator_model: null,
    };
  } catch {
    return null;
  }
}

/** Servidor resolve a referência pelo tenant; o caller nunca envia o valor 'antes'. */
export async function referenciaTecnicaDaVersao(
  orgId: string,
  versionId: string | null,
): Promise<CamposTecnicosDaVersao | null> {
  if (!versionId) return padraoTecnicoDaOrganizacao(orgId);
  try {
    const { data, error } = await createAdminClient()
      .from("ai_agent_versions")
      .select("provider, model, credential_id, operator_model")
      .eq("organization_id", orgId)
      .eq("id", versionId)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

export async function motivoDaRecusaTecnica(
  user: Ator,
  orgId: string,
  referencia: string | null,
  proposta: CamposTecnicosDaVersao,
): Promise<string | null> {
  const antes = await referenciaTecnicaDaVersao(orgId, referencia);
  if (!antes) return "configuracao_ia_indisponivel";
  const recusadas = await validarMudancasTecnicas(user, orgId, antes, proposta);
  return recusadas.length ? "forbidden_platform_ai" : null;
}
