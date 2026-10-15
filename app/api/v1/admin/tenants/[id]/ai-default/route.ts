import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdmin,
  requirePlatformAdminEscrita,
} from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ehProvedorSuportado, PROVEDORES } from "@/lib/ai/pontos/provedores";
import { lerAmbiente } from "@/lib/instalacao/ambiente";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  lerPadraoLlmDaOrganizacao,
  mesclarPadraoLlmDaOrganizacao,
} from "@/lib/ai/padrao-llm-da-organizacao";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    provider: z.string().min(1).max(80).refine(ehProvedorSuportado),
    default_model: z.string().trim().min(1).max(120),
  })
  .strict();
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) return fail("validation_failed", "Organização inválida", 400, { requestId });
  const orgId = parsed.data.id;
  const db = createAdminClient();
  const [orgResult, modelsResult, credentialsResult, agentsResult, bindingsResult] =
    await Promise.all([
      db.from("organizations").select("id, settings").eq("id", orgId).maybeSingle(),
      db
        .from("ai_models")
        .select("provider, model_id, display_name")
        .is("deprecated_at", null)
        .order("provider")
        .order("display_name")
        .limit(1000),
      db
        .from("ai_provider_credentials")
        .select("provider, is_active, validated_at")
        .eq("organization_id", orgId),
      db
        .from("ai_agents")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .not("published_version_id", "is", null)
        .is("archived_at", null),
      db
        .from("ai_purpose_bindings")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("is_enabled", true),
    ]);
  if (
    orgResult.error ||
    modelsResult.error ||
    credentialsResult.error ||
    agentsResult.error ||
    bindingsResult.error
  ) {
    return fail("internal_error", "Não foi possível consultar a configuração de IA", 500, {
      requestId,
    });
  }
  if (!orgResult.data) return fail("not_found", "Organização não encontrada", 404, { requestId });
  const current = lerPadraoLlmDaOrganizacao(orgResult.data.settings);
  const environment = lerAmbiente();
  const supported = PROVEDORES.map((p) => p.id);
  const status = supported.map((provider) => ({
    provider,
    chave_instalacao: environment.gateway || environment.chavesDeProvedor[provider] === true,
    credencial_organizacao_validada: (credentialsResult.data ?? []).some(
      (c) => c.provider === provider && c.is_active === true && c.validated_at != null,
    ),
  }));
  return ok(
    {
      organization_id: orgId,
      padrao: {
        provider: current.provider,
        default_model: current.default_model,
        configured: current.configured,
      },
      provedores: supported,
      modelos: (modelsResult.data ?? []).map((x) => ({
        provider: x.provider,
        model_id: x.model_id,
        display_name: x.display_name,
      })),
      disponibilidade: status,
      agentes_publicados: agentsResult.count ?? 0,
      pontos_com_configuracao_propria: bindingsResult.count ?? 0,
      pode_editar: adminCtx.platformAdmin.scope === "full" && !adminCtx.user.support,
    },
    { requestId },
  );
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) return fail("validation_failed", "Organização inválida", 400, { requestId });
  const orgId = parsed.data.id;
  const supportDenied = await requireSupportWrite(orgId);
  if (supportDenied) return supportDenied;
  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdminEscrita>>;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (e) {
    return falhaDaEscritaDePlatformAdmin(e, requestId);
  }
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return fail("validation_failed", "Provedor ou modelo inválido", 422, { requestId });
  const db = createAdminClient();
  const { data: org, error: loadError } = await db
    .from("organizations")
    .select("id, settings")
    .eq("id", orgId)
    .maybeSingle();
  if (loadError)
    return fail("internal_error", "Falha ao consultar organização", 500, { requestId });
  if (!org) return fail("not_found", "Organização não encontrada", 404, { requestId });

  const { data: knownModel, error: lookupError } = await db
    .from("ai_models")
    .select("model_id")
    .eq("provider", body.data.provider)
    .eq("model_id", body.data.default_model)
    .is("deprecated_at", null)
    .maybeSingle();
  if (lookupError)
    return fail("internal_error", "Catálogo de modelos indisponível", 500, { requestId });
  let catalogoIncompleto = false;
  if (!knownModel) {
    const { data: anyModel, error: anyError } = await db
      .from("ai_models")
      .select("model_id")
      .eq("provider", body.data.provider)
      .is("deprecated_at", null)
      .limit(1)
      .maybeSingle();
    if (anyError)
      return fail("internal_error", "Catálogo de modelos indisponível", 500, { requestId });
    if (anyModel) {
      return fail("modelo_desconhecido", "Modelo não encontrado no catálogo do provedor", 422, {
        requestId,
      });
    }
    catalogoIncompleto = true;
  }
  const previous = lerPadraoLlmDaOrganizacao(org.settings);
  if (
    previous.configured &&
    previous.provider === body.data.provider &&
    previous.default_model === body.data.default_model
  )
    return ok({ organization_id: orgId, padrao: body.data, changed: false }, { requestId });

  // CAS no JSONB: não substituir branding/security nem sobrescrever settings alteradas
  // desde a leitura. Em conflito o operador recarrega; nunca simular sucesso.
  const updatedSettings = mesclarPadraoLlmDaOrganizacao(org.settings, body.data);
  const { data: updated, error } = await db
    .from("organizations")
    .update({ settings: updatedSettings })
    .eq("id", orgId)
    .eq("settings", JSON.stringify(org.settings ?? {}))
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", "Falha ao salvar padrão de IA", 500, { requestId });
  if (!updated)
    return fail("conflict", "Configuração alterada em paralelo; recarregue a página", 409, {
      requestId,
    });
  void audit({
    action: "platform_admin.ai_default_updated",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: {
      previous: { provider: previous.provider, default_model: previous.default_model },
      next: body.data,
      catalogo_incompleto: catalogoIncompleto,
    },
  });
  return ok(
    {
      organization_id: orgId,
      padrao: body.data,
      changed: true,
      avisos: catalogoIncompleto
        ? ["Catálogo indisponível para validar esse modelo; teste antes de usar."]
        : [],
    },
    { requestId },
  );
}
