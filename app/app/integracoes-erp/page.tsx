import { redirect } from "next/navigation";

import { PainelIntegracoesErp } from "./_components/PainelIntegracoesErp";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { listarConexoesErp } from "@/lib/integracoes-erp/service";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Integrações ERP" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const conexoes = await listarConexoesErp(createAdminClient(), activeOrg.orgId);
  const canWrite =
    (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  return <PainelIntegracoesErp inicial={conexoes} canWrite={canWrite} />;
}
