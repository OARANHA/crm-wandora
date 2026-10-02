/**
 * AS CAPACIDADES DA ORGANIZAÇÃO — o que ESTA empresa ligou para si.
 *
 * Irmã de `lib/instalacao/modulos.ts`, em outro nível: módulo opcional é
 * decisão da INSTALAÇÃO (o dono do servidor); capacidade é decisão da
 * ORGANIZAÇÃO (o administrador da empresa). A doutrina de extensões diz a
 * mesma coisa: "a instância decide o pacote; a organização decide o uso".
 *
 * Só o booleano `true` liga. Ausente, malformado, string ou erro de banco =
 * desligado: falha fechada, como `modulosLigados()`. Nunca lança — roda no
 * layout de `/app` e no turno do agente, e um throw ali derruba a tela ou o
 * atendimento.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { modulosLigados, type ModuloOpcional } from "@/lib/instalacao/modulos";
import { logger } from "@/lib/logger";

export const CAPACIDADES_DA_ORGANIZACAO = ["propostas", "administracao_ia"] as const;
export type CapacidadeDaOrganizacao = (typeof CAPACIDADES_DA_ORGANIZACAO)[number];

/**
 * O módulo da INSTALAÇÃO que cada capacidade exige (doc 79). A empresa liga a
 * dela; com o módulo desligado no servidor, a chave da empresa não liga nada —
 * e é aqui, e não em cada consumidor, que as duas se somam: tela, menu, rota,
 * ferramenta do agente e cron leem a mesma resposta.
 */
const MODULO_DA_CAPACIDADE: Partial<Record<CapacidadeDaOrganizacao, ModuloOpcional>> = {
  propostas: "propostas",
};

export interface ContextoDeCapacidades {
  isPlatformAdmin?: boolean;
  support?: boolean;
}

/**
 * Administração técnica de IA (provedores, credenciais, modelos e embedding).
 *
 * - dono real da instalação (platform admin fora de suporte) sempre pode;
 * - tenant comum só pode com grant comercial explícito;
 * - ausente/malformado = desligado.
 *
 * O grant manual é a ponte até a cobrança do revendedor chegar. Quando
 * `cobranca_planos` passar a conceder BYOK, ela alimentará esta MESMA
 * capacidade; o rótulo legado `settings.plan` nunca vira autoridade.
 */
export function administracaoIaLigada(
  settings: unknown,
  contexto: ContextoDeCapacidades = {},
): boolean {
  if (contexto.isPlatformAdmin === true && contexto.support !== true) return true;
  const comerciais = objeto(objeto(settings)?.commercial_entitlements);
  return comerciais?.ai_provider_admin === true;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * `organizations.settings` + os módulos ligados na instalação → as
 * capacidades ligadas. Pura; nunca lança.
 */
export function capacidadesLigadas(
  settings: unknown,
  modulos: readonly ModuloOpcional[],
  contexto: ContextoDeCapacidades = {},
): CapacidadeDaOrganizacao[] {
  const propostas = objeto(objeto(settings)?.proposals);
  const daEmpresa: CapacidadeDaOrganizacao[] = [
    ...(propostas?.enabled === true ? (["propostas"] as const) : []),
    ...(administracaoIaLigada(settings, contexto) ? (["administracao_ia"] as const) : []),
  ];
  return daEmpresa.filter((c) => {
    const modulo = MODULO_DA_CAPACIDADE[c];
    return !modulo || modulos.includes(modulo);
  });
}

/**
 * A catraca de administração técnica de IA, lida direto da organização.
 *
 * Não consulta módulos opcionais: BYOK não depende deles, e uma indisponibilidade
 * na configuração de módulos não pode conceder nem retirar acesso a segredos.
 * Falha de leitura fecha o acesso; platform admin real não depende da linha.
 */
export async function podeAdministrarIaDaOrganizacao(
  db: SupabaseClient,
  organizationId: string,
  contexto: ContextoDeCapacidades = {},
): Promise<boolean> {
  if (contexto.isPlatformAdmin === true && contexto.support !== true) return true;
  try {
    const { data, error } = await db
      .from("organizations")
      .select("settings")
      .eq("id", organizationId)
      .maybeSingle();
    if (error || !data) return false;
    return administracaoIaLigada((data as { settings?: unknown }).settings, contexto);
  } catch {
    return false;
  }
}

/** Lê a linha da organização. Nunca lança: erro = nenhuma capacidade. */
export async function capacidadesDaOrganizacao(
  db: SupabaseClient,
  organizationId: string,
  contexto: ContextoDeCapacidades = {},
): Promise<CapacidadeDaOrganizacao[]> {
  try {
    const [{ data, error }, modulos] = await Promise.all([
      db.from("organizations").select("settings").eq("id", organizationId).maybeSingle(),
      modulosLigados(db),
    ]);
    if (error) {
      logger.warn("capacidades da organização: leitura recusada — tratando todas como desligadas", {
        organization_id: organizationId,
        detalhe: (error as { message?: string }).message,
      });
      return [];
    }
    return capacidadesLigadas(
      (data as { settings?: unknown } | null)?.settings,
      modulos,
      contexto,
    );
  } catch (erro) {
    logger.warn("capacidades da organização: leitura falhou — tratando todas como desligadas", {
      organization_id: organizationId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return [];
  }
}
