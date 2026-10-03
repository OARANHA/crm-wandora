import { randomBytes } from "node:crypto"

import { carregarIntegracaoVigia, type VigiaIntegrationConfig } from "@/lib/vigia/config"

const stringValue = (value: string) => ({ stringValue: value })
const boolValue = (value: boolean) => ({ boolValue: value })
const attribute = (key: string, value: ReturnType<typeof stringValue> | ReturnType<typeof boolValue>) => ({
  key,
  value,
})

export interface VigiaTraceInput {
  readonly kind: string
  readonly startedAt: number
  readonly endedAt: number
  readonly success: boolean
}

export interface VigiaTracePayload {
  readonly traceIdHex: string
  readonly body: unknown
}

export function criarPayloadOtlpVigia(input: VigiaTraceInput): VigiaTracePayload {
  const traceBytes = randomBytes(16)
  const spanBytes = randomBytes(8)
  const traceIdHex = traceBytes.toString("hex")
  const startTimeUnixNano = String(BigInt(input.startedAt) * 1_000_000n)
  const endTimeUnixNano = String(BigInt(Math.max(input.endedAt, input.startedAt + 1)) * 1_000_000n)

  return {
    traceIdHex,
    body: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              attribute("service.name", stringValue("elus")),
              attribute("service.namespace", stringValue("wandora")),
              attribute("deployment.environment.name", stringValue(process.env.NODE_ENV || "unknown")),
            ],
          },
          scopeSpans: [
            {
              scope: { name: "elus.vigia.native", version: "1" },
              spans: [
                {
                  traceId: traceIdHex,
                  spanId: spanBytes.toString("hex"),
                  name: `elus.${input.kind}`,
                  kind: 1,
                  startTimeUnixNano,
                  endTimeUnixNano,
                  attributes: [
                    attribute("vigia.integration", stringValue("elus")),
                    attribute("elus.job.kind", stringValue(input.kind)),
                    attribute("elus.job.success", boolValue(input.success)),
                  ],
                  status: { code: input.success ? 1 : 2 },
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

async function enviarTrace(
  config: VigiaIntegrationConfig,
  input: VigiaTraceInput,
): Promise<string | null> {
  const payload = criarPayloadOtlpVigia(input)
  const response = await fetch(`${config.ingestUrl}/v1/traces`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "X-Vigia-Project": config.projectSlug,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload.body),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  })
  return response.ok ? payload.traceIdHex : null
}

export async function emitirExecucaoAoVigia(input: {
  readonly organizationId: string
  readonly kind: string
  readonly startedAt: number
  readonly success: boolean
}): Promise<string | null> {
  try {
    const config = await carregarIntegracaoVigia(input.organizationId)
    if (!config) return null
    return await enviarTrace(config, {
      kind: input.kind,
      startedAt: input.startedAt,
      endedAt: Date.now(),
      success: input.success,
    })
  } catch {
    // Observabilidade nunca pode quebrar o atendimento do Elus.
    return null
  }
}

export async function emitirEventoDeNegocioAoVigia(input: {
  readonly organizationId: string
  readonly traceId: string
  readonly event: string
  readonly success: boolean
  readonly label?: string
  readonly value?: number
  readonly currency?: string
  readonly metadata?: Record<string, unknown>
}): Promise<boolean> {
  try {
    const config = await carregarIntegracaoVigia(input.organizationId)
    if (!config) return false

    const response = await fetch(
      `${config.apiUrl}/v1/projects/${encodeURIComponent(config.projectSlug)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          traceId: input.traceId,
          event: input.event,
          success: input.success,
          ...(input.label ? { label: input.label } : {}),
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.currency ? { currency: input.currency } : {}),
          metadata: input.metadata ?? {},
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    )
    return response.ok
  } catch {
    return false
  }
}
