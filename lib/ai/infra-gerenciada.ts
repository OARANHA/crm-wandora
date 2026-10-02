/**
 * Infraestrutura de IA gerenciada pela instalação.
 *
 * Cliente sem o entitlement `administracao_ia` não escolhe provider/model/chave.
 * Agente NOVO recebe este trio; agente existente preserva o trio da versão que
 * já usa. Este resolvedor só responde o caso novo.
 *
 * A fonte é a mesma já existente:
 * - provider/model: organizations.settings.llm;
 * - chave: ambiente da instalação, ou a credencial validada mais antiga da org.
 *
 * Nunca devolve segredo em plaintext.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ehProvedorSuportado } from "@/lib/ai/pontos/provedores";
import { lerAmbiente } from "@/lib/instalacao/ambiente";

export interface InfraIaGerenciada {
  provider: string;
  model: string;
  /** null = chave/gateway da instalação, como em ai_agent_versions. */
  credentialId: string | null;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export async function resolverInfraIaGerenciada(
  db: SupabaseClient,
  organizationId: string,
): Promise<InfraIaGerenciada | null> {
  try {
    const { data: org, error: orgError } = await db
      .from("organizations")
      .select("settings")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgError || !org) return null;

    const llm = objeto(objeto((org as { settings?: unknown }).settings)?.llm);
    const provider = llm?.provider;
    const model = llm?.default_model;
    if (
      typeof provider !== "string" ||
      !ehProvedorSuportado(provider) ||
      typeof model !== "string" ||
      model.trim() === ""
    ) {
      return null;
    }

    const ambiente = lerAmbiente();
    if (ambiente.chavesDeProvedor[provider] === true) {
      return { provider, model, credentialId: null };
    }

    const { data: credencial, error: credError } = await db
      .from("ai_provider_credentials")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("provider", provider)
      .eq("is_active", true)
      .not("validated_at", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (credError || !credencial?.id) return null;

    return { provider, model, credentialId: String(credencial.id) };
  } catch {
    return null;
  }
}
