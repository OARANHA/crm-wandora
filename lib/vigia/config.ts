import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets"

export interface VigiaIntegrationConfig {
  readonly projectId: string
  readonly projectSlug: string
  readonly ingestUrl: string
  readonly apiUrl: string
  readonly apiKey: string
}

interface StoredVigiaIntegration {
  project_id: string
  project_slug: string
  ingest_url: string
  api_url: string
  api_key_encrypted: string
  connected_at: string
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export async function salvarIntegracaoVigia(
  organizationId: string,
  config: VigiaIntegrationConfig,
): Promise<void> {
  const admin = createAdminClient()
  const encrypted = await encryptWebhookSecret(admin, config.apiKey)
  if (!encrypted) throw new Error("vigia_secret_encryption_unavailable")

  const { data: org, error: readError } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle()
  if (readError) throw new Error(`vigia_settings_read_failed: ${readError.message}`)
  if (!org) throw new Error("vigia_organization_not_found")

  const settings = asRecord(org.settings)
  const stored: StoredVigiaIntegration = {
    project_id: config.projectId,
    project_slug: config.projectSlug,
    ingest_url: config.ingestUrl.replace(/\/+$/, ""),
    api_url: config.apiUrl.replace(/\/+$/, ""),
    api_key_encrypted: encrypted.replace(/^\\x/, ""),
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
  const projectId = raw.project_id
  const projectSlug = raw.project_slug
  const ingestUrl = raw.ingest_url
  const apiUrl = raw.api_url
  const encrypted = raw.api_key_encrypted
  if (
    typeof projectId !== "string" ||
    typeof projectSlug !== "string" ||
    typeof ingestUrl !== "string" ||
    typeof apiUrl !== "string" ||
    typeof encrypted !== "string"
  ) {
    return null
  }

  const apiKey = await decryptWebhookSecret(admin, encrypted)
  if (!apiKey) return null
  return { projectId, projectSlug, ingestUrl, apiUrl, apiKey }
}
