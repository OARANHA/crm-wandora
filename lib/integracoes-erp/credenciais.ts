import type { SupabaseClient } from "@supabase/supabase-js";

import { bufToBytea, byteaToBuffer, decryptKey, encryptKey } from "@/lib/crypto/aes_gcm";

import type { ConexaoErpSegura, CredenciaisVendaErp } from "./tipos";

const PROVIDER = "vendaerp";

function cifrar(valor: string, prefixo: string): Record<string, string> {
  const e = encryptKey(valor);
  return {
    [prefixo + "_encrypted"]: bufToBytea(e.ciphertext),
    [prefixo + "_iv"]: bufToBytea(e.iv),
    [prefixo + "_tag"]: bufToBytea(e.tag),
    [prefixo + "_last4"]: e.last4,
  };
}

function decifrar(linha: Record<string, unknown>, prefixo: string): string {
  return decryptKey({
    ciphertext: byteaToBuffer(linha[prefixo + "_encrypted"]),
    iv: byteaToBuffer(linha[prefixo + "_iv"]),
    tag: byteaToBuffer(linha[prefixo + "_tag"]),
  });
}

export function dadosCifradosVendaErp(
  credenciais: Omit<CredenciaisVendaErp, "baseUrl">,
): Record<string, string> {
  return {
    ...cifrar(credenciais.authorizationToken, "auth_token"),
    ...cifrar(credenciais.user, "user"),
    ...cifrar(credenciais.app, "app"),
  };
}

export type LeituraDaConexaoVendaErp =
  | { ok: true; conexao: ConexaoErpSegura; credenciais: CredenciaisVendaErp }
  | { ok: false; motivo: "nao_encontrada" | "desativada" | "cifra_indisponivel" | "banco" };

export async function carregarConexaoVendaErp(
  admin: SupabaseClient,
  organizationId: string,
): Promise<LeituraDaConexaoVendaErp> {
  const { data, error } = await admin
    .from("erp_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (error) return { ok: false, motivo: "banco" };
  if (!data) return { ok: false, motivo: "nao_encontrada" };
  if (!(data as { enabled?: boolean }).enabled) return { ok: false, motivo: "desativada" };

  try {
    const linha = data as Record<string, unknown>;
    const conexao = data as unknown as ConexaoErpSegura;
    return {
      ok: true,
      conexao,
      credenciais: {
        baseUrl: String(linha.base_url ?? ""),
        authorizationToken: decifrar(linha, "auth_token"),
        user: decifrar(linha, "user"),
        app: decifrar(linha, "app"),
      },
    };
  } catch {
    return { ok: false, motivo: "cifra_indisponivel" };
  }
}
