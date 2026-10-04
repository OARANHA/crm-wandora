import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  CAPACIDADE_ERP_ADMIN_READ,
  obterVinculoAdminWhatsappDoUsuario,
  removerVinculoAdminWhatsappDoUsuario,
  salvarVinculoAdminWhatsappDoUsuario,
} from "@/lib/integracoes-erp/autoridade-admin-whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

import { seModuloErpDesligado } from "../_falha";

export const dynamic = "force-dynamic";

const schema = z.object({
  phone_number: z.string().trim().min(8).max(40),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const desligado = await seModuloErpDesligado(requestId);
  if (desligado) return desligado;

  const authz = await requireRole("admin", {
    requestId,
    resource: "erp_admin_whatsapp_binding",
  });
  if (!authz.ok) return authz.response;

  const vinculo = await obterVinculoAdminWhatsappDoUsuario(
    createAdminClient(),
    authz.org.orgId,
    authz.user.id,
  );
  return ok(vinculo, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const desligado = await seModuloErpDesligado(requestId);
  if (desligado) return desligado;

  const authz = await requireRole("admin", {
    requestId,
    resource: "erp_admin_whatsapp_binding",
  });
  if (!authz.ok) return authz.response;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      "validation_failed",
      "Informe o seu WhatsApp com código do país, por exemplo +5551999999999.",
      422,
      { requestId },
    );
  }

  const resultado = await salvarVinculoAdminWhatsappDoUsuario(
    createAdminClient(),
    authz.org.orgId,
    authz.user.id,
    parsed.data.phone_number,
  );
  if (!resultado.ok) {
    if (resultado.motivo === "membership_invalido") {
      return fail(
        "admin_membership_required",
        "Este número só pode ser vinculado a um administrador ativo desta organização.",
        403,
        { requestId },
      );
    }
    if (resultado.motivo === "telefone_ja_vinculado") {
      return fail(
        "phone_already_linked",
        "Este WhatsApp já está vinculado a outro administrador desta organização.",
        409,
        { requestId },
      );
    }
    if (resultado.motivo === "telefone_invalido") {
      return fail("validation_failed", "Use o formato internacional com + e código do país.", 422, {
        requestId,
      });
    }
    return fail("erp_admin_binding_failed", "Não foi possível salvar o vínculo agora.", 500, {
      requestId,
    });
  }

  await audit({
    action: "integracao_erp.admin_whatsapp_vinculado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "erp_admin_whatsapp_binding",
    resourceId: resultado.vinculo.id,
    requestId,
    metadata: { capability: CAPACIDADE_ERP_ADMIN_READ, channel: "whatsapp" },
  });

  return ok(resultado.vinculo, { requestId });
}

export async function DELETE(): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const desligado = await seModuloErpDesligado(requestId);
  if (desligado) return desligado;

  const authz = await requireRole("admin", {
    requestId,
    resource: "erp_admin_whatsapp_binding",
  });
  if (!authz.ok) return authz.response;

  const id = await removerVinculoAdminWhatsappDoUsuario(
    createAdminClient(),
    authz.org.orgId,
    authz.user.id,
  );
  if (!id) {
    return fail("not_found", "Não há WhatsApp administrativo vinculado a este usuário.", 404, {
      requestId,
    });
  }

  await audit({
    action: "integracao_erp.admin_whatsapp_desvinculado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "erp_admin_whatsapp_binding",
    resourceId: id,
    requestId,
    metadata: { capability: CAPACIDADE_ERP_ADMIN_READ, channel: "whatsapp" },
  });

  return ok({ removed: true }, { requestId });
}
