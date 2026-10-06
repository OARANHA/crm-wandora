import type { SupabaseClient } from "@supabase/supabase-js";

import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import { hashCpf, normalizeCpf } from "@/lib/contacts/cpf";
import type { ClienteErp } from "./tipos";

export interface IdentidadeContatoCandidato {
  id: string;
  phone_number: string | null;
  email_normalized: string | null;
  cpf_hash: string | null;
  is_anonymized: boolean;
}

function emailNormalizado(valor: string | null | undefined): string | null {
  const v = valor?.trim().toLowerCase();
  return v || null;
}
function documentoNormalizado(valor: string | null | undefined): string | null {
  const v = normalizeCpf(valor ?? "");
  return v || null;
}

/** Descobre candidatos locais; a confirmação final continua fail-closed. */
export async function localizarContatosCandidatosClienteErp(
  db: SupabaseClient,
  organizationId: string,
  cliente: ClienteErp,
): Promise<{ ok: true; contatos: IdentidadeContatoCandidato[] } | { ok: false }> {
  const achados = new Map<string, IdentidadeContatoCandidato>();
  const select = "id, phone_number, email_normalized, cpf_hash, is_anonymized";

  const doc = documentoNormalizado(cliente.cpfCnpj);
  if (doc?.length === 11) {
    const { data, error } = await db.from("contacts").select(select)
      .eq("organization_id", organizationId).eq("cpf_hash", hashCpf(doc))
      .eq("is_anonymized", false).is("is_merged_into", null).limit(3);
    if (error) return { ok: false };
    for (const row of data ?? []) achados.set(row.id, row as IdentidadeContatoCandidato);
  }

  const email = emailNormalizado(cliente.email);
  if (email) {
    const { data, error } = await db.from("contacts").select(select)
      .eq("organization_id", organizationId).eq("email_normalized", email)
      .eq("is_anonymized", false).is("is_merged_into", null).limit(3);
    if (error) return { ok: false };
    for (const row of data ?? []) achados.set(row.id, row as IdentidadeContatoCandidato);
  }

  for (const bruto of [cliente.celular, cliente.telefone]) {
    if (!bruto?.trim()) continue;
    const digits = bruto.replace(/\D/g, "");
    const e164 = digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
    const variantes = phoneLookupVariants(e164);
    if (variantes.length === 0) continue;
    const { data, error } = await db.from("contacts").select(select)
      .eq("organization_id", organizationId).in("phone_number", variantes)
      .eq("is_anonymized", false).is("is_merged_into", null).limit(3);
    if (error) return { ok: false };
    for (const row of data ?? []) achados.set(row.id, row as IdentidadeContatoCandidato);
  }
  return { ok: true, contatos: [...achados.values()] };
}
