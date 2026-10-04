import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { listarConexoesErp, salvarConexaoVendaErp } from "@/lib/integracoes-erp/service";
import { createAdminClient } from "@/lib/supabase/admin";

import { seModuloErpDesligado } from "../_falha";

export const dynamic = "force-dynamic";

const schema = z.object({
  base_url: z.string().trim().url().max(500),
  authorization_token: z.string().trim().min(1).max(500),
  user: z.string().trim().min(1).max(200),
  app: z.string().trim().min(1).max(200),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const desligado = await seModuloErpDesligado(requestId);
  if (desligado) return desligado;

  const authz = await requireRole("viewer", { requestId, resource: "erp_connections" });
  if (!authz.ok) return authz.response;

  const data = await listarConexoesErp(createAdminClient(), authz.org.orgId);
  return ok(data, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const desligado = await seModuloErpDesligado(requestId);
  if (desligado) return desligado;

  const authz = await requireRole("admin", { requestId, resource: "erp_connections" });
  if (!authz.ok) return authz.response;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Confira URL, token, User e App.", 422, { requestId });
  }

  const resultado = await salvarConexaoVendaErp(
    createAdminClient(),
    authz.org.orgId,
    authz.user.id,
    {
      baseUrl: parsed.data.base_url,
      authorizationToken: parsed.data.authorization_token,
      user: parsed.data.user,
      app: parsed.data.app,
    },
  );

  if (!resultado.ok) {
    const status = resultado.motivo === "cifra_indisponivel" ? 500 : 422;
    return fail("erp_connection_invalid", resultado.motivo, status, { requestId });
  }

  await audit({
    action: "integracao_erp.conexao_salva",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "erp_connection",
    resourceId: resultado.conexao.id,
    requestId,
    metadata: { provider: "vendaerp", access_mode: "read" },
  });

  return ok(resultado.conexao, { status: 201, requestId });
}
