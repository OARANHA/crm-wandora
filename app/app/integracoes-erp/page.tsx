import { redirect } from "next/navigation";

import { PainelIntegracoesErp } from "./_components/PainelIntegracoesErp";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { obterVinculoAdminWhatsappDoUsuario } from "@/lib/integracoes-erp/autoridade-admin-whatsapp";
import { listarConexoesErp } from "@/lib/integracoes-erp/service";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Integrações ERP" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const admin = createAdminClient();
  const canWrite =
    (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;
  const canBindWhatsapp = !user.support && ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  const [conexoes, vinculoAdminWhatsapp] = await Promise.all([
    listarConexoesErp(admin, activeOrg.orgId),
    canBindWhatsapp
      ? obterVinculoAdminWhatsappDoUsuario(admin, activeOrg.orgId, user.id)
      : Promise.resolve(null),
  ]);

  return (
    <PainelIntegracoesErp
      inicial={conexoes}
      canWrite={canWrite}
      canBindWhatsapp={canBindWhatsapp}
      vinculoAdminWhatsapp={vinculoAdminWhatsapp}
    />
  );
}
