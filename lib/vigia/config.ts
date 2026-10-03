import { decryptKey, encryptKey } from "@/lib/crypto/aes_gcm"
import { createAdminClient } from "@/lib/supabase/admin"

export interface VigiaIntegrationConfig {
  readonly organizationId: string
  readonly projectId: string
  readonly projectSlug: string
  readonly ingestUrl: string
  readonly apiUrl: string
  readonly apiKey: string
}

interface StoredVigiaIntegration {
  organization_id: string
  project_id: string
  project_slug: string
  ingest_url: string
  api_url: string
  credential_cipher: "aes-256-gcm-ai-cred-v1"
  api_key_ciphertext: string
  api_key_iv: string
  api_key_tag: string
  connected_at: string
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const hex = (value: Buffer): string => value.toString("hex")

export async function salvarIntegracaoVigia(
  organizationId: string,
  config: VigiaIntegrationConfig,
): Promise<void> {
  // A mesma chave server-side que protege credenciais de provedores LLM.
  // Nunca persiste plaintext e funciona no app e no worker, que já recebem
  // AI_CRED_AES_KEY em produção.
  const encrypted = encryptKey(config.apiKey)

  const admin = createAdminClient()
  const { data: org, error: readError } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle()
  if (readError) throw new Error(`vigia_settings_read_failed: ${readError.message}`)
  if (!org) throw new Error("vigia_organization_not_found")

  const settings = asRecord(org.settings)
  const stored: StoredVigiaIntegration = {
    organization_id: config.organizationId,
    project_id: config.projectId,
    project_slug: config.projectSlug,
    ingest_url: config.ingestUrl.replace(/\/+$/, ""),
    api_url: config.apiUrl.replace(/\/+$/, ""),
    credential_cipher: "aes-256-gcm-ai-cred-v1",
    api_key_ciphertext: hex(encrypted.ciphertext),
    api_key_iv: hex(encrypted.iv),
    api_key_tag: hex(encrypted.tag),
    connected_at: new Date().toISOString(),
  }

  const { error: writeError } = await admin
    .from("organizations")
    .update({ settings: { ...settings, vigia_integration: stored } })
    .eq("id", organizationId)
  if (writeError) throw new Error(`vigia_settings_write_failed: ${writeError.message}`)
}

export async function carregarIntegracaoVigia(
  organizationId: string,
): Promise<VigiaIntegrationConfig | null> {
  const admin = createAdminClient()
  const { data: org, error } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle()
  if (error || !org) return null

  const raw = asRecord(asRecord(org.settings).vigia_integration)
  const vigiaOrganizationId = raw.organization_id
  const projectId = raw.project_id
  const projectSlug = raw.project_slug
  const ingestUrl = raw.ingest_url
  const apiUrl = raw.api_url
  const credentialCipher = raw.credential_cipher
  const ciphertext = raw.api_key_ciphertext
  const iv = raw.api_key_iv
  const tag = raw.api_key_tag
  if (
    typeof vigiaOrganizationId !== "string" ||
    typeof projectId !== "string" ||
    typeof projectSlug !== "string" ||
    typeof ingestUrl !== "string" ||
    typeof apiUrl !== "string" ||
    credentialCipher !== "aes-256-gcm-ai-cred-v1" ||
    typeof ciphertext !== "string" ||
    typeof iv !== "string" ||
    typeof tag !== "string"
  ) {
    return null
  }

  let apiKey: string
  try {
    apiKey = decryptKey({
      ciphertext: Buffer.from(ciphertext, "hex"),
      iv: Buffer.from(iv, "hex"),
      tag: Buffer.from(tag, "hex"),
    })
  } catch {
    return null
  }

  return {
    organizationId: vigiaOrganizationId,
    projectId,
    projectSlug,
    ingestUrl,
    apiUrl,
    apiKey,
  }
}
