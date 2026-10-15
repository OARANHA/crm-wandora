import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  requirePlatformAdmin,
  requirePlatformAdminEscrita,
  falhaDaEscritaDePlatformAdmin,
} from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { interpretarAutonomiaIa } from "@/lib/ai/governanca-da-ia";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    provider: z.boolean(),
    model: z.boolean(),
    credentials: z.boolean(),
    operator_model: z.boolean(),
  })
  .strict();

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) return fail("validation_failed", "Tenant id invalido", 400, { requestId });
  const orgId = parsed.data.id;
  const { data, error } = await createAdminClient()
    .from("organizations")
    .select("id, ai_autonomy")
    .eq("id", orgId)
    .maybeSingle();
  if (error)
    return fail("internal_error", "Falha ao consultar permissoes de IA", 500, { requestId });
  if (!data) return fail("not_found", "Tenant not found", 404, { requestId });
  return ok(
    { organization_id: orgId, permissions: interpretarAutonomiaIa(data.ai_autonomy) },
    { requestId },
  );
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) return fail("validation_failed", "Tenant id invalido", 400, { requestId });
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
  if (!body.success) return fail("validation_failed", "Permissoes invalidas", 422, { requestId });
  const admin = createAdminClient();
  const { data: org, error: loadError } = await admin
    .from("organizations")
    .select("id, ai_autonomy")
    .eq("id", orgId)
    .maybeSingle();
  if (loadError) return fail("internal_error", "Falha ao ler configuracao", 500, { requestId });
  if (!org) return fail("not_found", "Tenant not found", 404, { requestId });
  const anterior = interpretarAutonomiaIa(org.ai_autonomy);
  if (
    Object.keys(anterior).every(
      (key) => anterior[key as keyof typeof anterior] === body.data[key as keyof typeof anterior],
    )
  ) {
    return ok({ organization_id: orgId, permissions: anterior, changed: false }, { requestId });
  }
  // CAS exclusivamente na coluna de autorização; salvar settings em paralelo
  // nunca pode ressuscitar uma permissão revogada.
  const { data: updated, error } = await admin
    .from("organizations")
    .update({ ai_autonomy: body.data })
    .eq("id", orgId)
    .eq("ai_autonomy", JSON.stringify(org.ai_autonomy ?? {}))
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", "Falha ao atualizar permissoes", 500, { requestId });
  if (!updated)
    return fail("conflict", "Configuracao modificada por outra operacao; atualize a tela", 409, {
      requestId,
    });
  void audit({
    action: "platform_admin.ai_autonomy_updated",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: { previous: anterior, next: body.data },
  });
  return ok({ organization_id: orgId, permissions: body.data, changed: true }, { requestId });
}
