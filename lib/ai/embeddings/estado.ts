/**
 * O estado da chave da base de conhecimento, como a tela o recebe.
 *
 * Um só construtor para a página (render de servidor) e para
 * `GET /api/v1/ai/knowledge/chave` (o polling do hook): eram dois blocos iguais,
 * e um campo novo em só um deles faria a tela mudar de resposta no primeiro
 * refetch.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EXPLICACAO_DA_ORIGEM,
  FamiliaDaBaseIlegivelError,
  familiaDaBase,
  provedorDaBase,
  resolverChaveDeEmbedding,
  type ProvedorDaBase,
} from "@/lib/ai/embeddings/chave";

export interface EstadoDaChave {
  /** true = o tenant usa IA gerenciada e não recebe detalhes de fornecedor/chave. */
  modo_gerenciado: boolean;
  pode_indexar: boolean;
  origem: string | null;
  explicacao: string | null;
  chave_em_uso: string | null;
  avisos: string[];
  /** Quem prepara a base: a família gravada ou indexada; sem ela, a da chave. `null` sem nenhuma. */
  provedor: ProvedorDaBase | null;
  /**
   * A base tem família e a chave dela sumiu (removida, desativada, inválida).
   * Outra família com chave NÃO assume sozinha — a tela diz isto e oferece a
   * troca explícita, que refaz a base.
   */
  familia_sem_chave: ProvedorDaBase | null;
  /** Para onde dá para trocar AGORA (há chave utilizável do outro lado); `null` = nenhum. */
  pode_trocar_para: ProvedorDaBase | null;
  credenciais_embedding: Array<{
    id: string;
    provider: "openai" | "openrouter" | "google";
    label: string;
    api_key_last4: string | null;
    validated_at: string | null;
    validation_error: string | null;
    is_active: boolean;
  }>;
}

export const AVISO_DA_FAMILIA_ILEGIVEL =
  "Não consegui confirmar agora com que provedor a base é preparada. Recarregue em instantes.";

export async function montarEstadoDaChave(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<EstadoDaChave> {
  // A tela é INFORMAÇÃO: se a família não pôde ser lida, ela ainda mostra a
  // chave e diz que não sabe o provedor — sem oferecer troca nenhuma.
  let familia: ProvedorDaBase | null = null;
  let familiaIlegivel = false;
  try {
    familia = (await familiaDaBase(organizationId))?.familia ?? null;
  } catch (err) {
    if (!(err instanceof FamiliaDaBaseIlegivelError)) throw err;
    familiaIlegivel = true;
  }
  const [chave, { data }] = await Promise.all([
    resolverChaveDeEmbedding(organizationId, "embedding_indexar", { familia }),
    supabase
      .from("ai_provider_credentials_safe")
      .select("id, provider, label, api_key_last4, validated_at, validation_error, is_active")
      .eq("organization_id", organizationId)
      .in("provider", ["openai", "openrouter", "google"])
      .order("created_at", { ascending: true }),
  ]);
  const credenciais = (data ?? []) as EstadoDaChave["credenciais_embedding"];
  const provedor = familiaIlegivel ? null : (familia ?? (chave ? provedorDaBase(chave) : null));

  // A troca só é oferecida quando a OUTRA família tem chave utilizável agora.
  const outra: ProvedorDaBase | null =
    provedor === "openai" ? "google" : provedor === "google" ? "openai" : null;
  const podeTrocarPara =
    outra &&
    (await resolverChaveDeEmbedding(organizationId, "embedding_indexar", { familia: outra }))
      ? outra
      : null;

  return {
    modo_gerenciado: false,
    pode_indexar: chave !== null,
    origem: chave?.origem ?? null,
    explicacao: chave ? EXPLICACAO_DA_ORIGEM[chave.origem] : null,
    chave_em_uso: chave?.rotulo ?? null,
    avisos: [
      ...(chave?.avisos ?? []),
      ...(familiaIlegivel ? [AVISO_DA_FAMILIA_ILEGIVEL] : []),
    ],
    provedor,
    familia_sem_chave: familia !== null && chave === null ? familia : null,
    pode_trocar_para: podeTrocarPara,
    credenciais_embedding: credenciais,
  };
}


/**
 * Projeção segura para organizações com IA gerenciada.
 *
 * Mantém apenas a resposta operacional que a tela precisa ("dá para preparar
 * material agora?"). Provider, origem, rótulos e inventário de credenciais são
 * administração da instalação/Enterprise e não atravessam a fronteira HTTP.
 */
export function projetarEstadoDaChaveGerenciado(estado: EstadoDaChave): EstadoDaChave {
  return {
    modo_gerenciado: true,
    pode_indexar: estado.pode_indexar,
    origem: null,
    explicacao: null,
    chave_em_uso: null,
    avisos: [],
    provedor: null,
    familia_sem_chave: null,
    pode_trocar_para: null,
    credenciais_embedding: [],
  };
}
