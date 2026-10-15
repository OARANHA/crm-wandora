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
import { guardarCredencial } from "@/lib/ai/credenciais/guardar";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    label: z.string().trim().min(1).max(80),
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

/**
 * Provisionamento por Superadmin, no MESMO storage AES-GCM, auditoria e
 * validação de ai_provider_credentials. Nunca usar a organização ativa
 * do cookie: a autoridade do alvo é exclusivamente o UUID no path.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
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
  const db = createAdminClient();
  const { data: org, error: orgError } = await db
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();
  if (orgError)
    return fail("internal_error", "Não foi possível consultar organização", 500, { requestId });
  if (!org) return fail("not_found", "Organização não encontrada", 404, { requestId });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return fail("validation_failed", "Informe nome, URL HTTPS e chave válidas.", 422, {
      requestId,
    });

  // O teste prévio da UI NÃO é autorização para gravar uma URL arbitrária.
  // Repete a prova no servidor com a mesma catraca SSRF do fluxo existente.
  const valid = await validateProviderKey("custom", body.data.api_key, body.data.base_url);
  const modelosConfirmados = valid.ok
    ? valid.models.filter((model) => model.length > 0 && model.length <= 120).slice(0, 1000)
    : [];
  if (!valid.ok || modelosConfirmados.length === 0)
    return fail(
      "credential_validation_failed",
      "O serviço deve confirmar a chave e retornar pelo menos um modelo em /models.",
      422,
      { requestId },
    );

  const created = await guardarCredencial({
    admin: db,
    orgId,
    userId: adminCtx.user.id,
    provider: "custom",
    label: body.data.label,
    apiKey: body.data.api_key,
    baseUrl: body.data.base_url.trim().replace(/\/+$/, ""),
    requestId,
    validacaoConfirmada: { models: modelosConfirmados },
  });
  if (!created.ok) {
    if (created.motivo === "label_em_uso")
      return fail("label_already_used", "Já existe uma credencial com este nome.", 409, {
        requestId,
      });
    return fail("internal_error", "Falha ao armazenar a credencial.", 500, { requestId });
  }
  // A prova foi refeita pelo servidor e escrita pela capability canônica.
  // A versão publicada do agente permanece intocada até decisão explícita.
  return ok({ id: created.id, status: "validated" }, { status: 201, requestId });
}
