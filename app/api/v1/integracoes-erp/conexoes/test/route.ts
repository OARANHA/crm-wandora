import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { testarConexaoVendaErpSalva } from "@/lib/integracoes-erp/service";
import { createAdminClient } from "@/lib/supabase/admin";

import { seModuloErpDesligado } from "../../_falha";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const desligado = await seModuloErpDesligado(requestId);
  if (desligado) return desligado;

  const authz = await requireRole("admin", { requestId, resource: "erp_connections" });
  if (!authz.ok) return authz.response;

  const resultado = await testarConexaoVendaErpSalva(createAdminClient(), authz.org.orgId);

  await audit({
    action: "integracao_erp.conexao_testada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "erp_connection",
    requestId,
    metadata: {
      provider: "vendaerp",
      ok: resultado.ok,
      motivo: resultado.ok ? null : resultado.motivo,
    },
  });

  if (!resultado.ok) {
    if (resultado.motivo === "nao_encontrada") {
      return fail("not_found", "Conexão VendaERP não encontrada.", 404, { requestId });
    }
    if (resultado.motivo === "cifra_indisponivel") {
      return fail(
        "erp_crypto_unavailable",
        "A chave de criptografia da instalação não está disponível.",
        500,
        {
          requestId,
        },
      );
    }
    if (resultado.motivo === "rate_limited") {
      return fail(
        "rate_limited",
        "O VendaERP atingiu o limite da chave. Tente novamente mais tarde.",
        429,
        {
          requestId,
        },
      );
    }
    return fail("erp_test_failed", resultado.motivo, 422, { requestId });
  }

  return ok(resultado.conexao, { requestId });
}
