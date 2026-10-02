import type { NextResponse } from "next/server";

import { fail, type ApiError } from "@/lib/api/wrappers";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

export async function seModuloErpDesligado(
  requestId: string,
): Promise<NextResponse<ApiError> | null> {
  if (await moduloLigado(createAdminClient(), "integracoes_erp")) return null;
  return fail("not_found", "Not found.", 404, { requestId });
}
