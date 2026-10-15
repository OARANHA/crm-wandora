import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdminEscrita,
} from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { validateProviderKey } from "@/lib/ai/provider-validators";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
const testSchema = z
  .object({
    base_url: z
      .string()
      .trim()
      .url()
      .max(500)
      .refine((x) => x.startsWith("https://")),
    api_key: z.string().min(1).max(8192),
  })
  .strict();
type Ctx = { params: Promise<{ id: string }> };

/** Pré-prova sem persistência: o validador canônico governa SSRF e /models. */
export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) return fail("validation_failed", "Organização inválida", 400, { requestId });
  const orgId = parsed.data.id;
  const supportDenied = await requireSupportWrite(orgId);
  if (supportDenied) return supportDenied;
  try {
    await requirePlatformAdminEscrita();
  } catch (e) {
    return falhaDaEscritaDePlatformAdmin(e, requestId);
  }
  const { data: organization, error: orgError } = await createAdminClient()
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();
  if (orgError)
    return fail("internal_error", "Falha ao consultar organização.", 500, { requestId });
  if (!organization) return fail("not_found", "Organização não encontrada.", 404, { requestId });

  const body = testSchema.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return fail("validation_failed", "Informe URL HTTPS e chave válidas.", 422, { requestId });
  const result = await validateProviderKey("custom", body.data.api_key, body.data.base_url);
  // Sem eco da chave, do corpo do provedor ou dos detalhes do erro.
  const modelosConfirmados = result.ok
    ? result.models.filter((model) => model.length > 0 && model.length <= 120).slice(0, 1000)
    : [];
  const verified = result.ok && modelosConfirmados.length > 0;
  return ok(
    verified
      ? { verified: true, models: modelosConfirmados, error: null }
      : {
          verified: false,
          models: [],
          error: result.ok ? "models_empty" : result.error,
        },
    { requestId },
  );
}
