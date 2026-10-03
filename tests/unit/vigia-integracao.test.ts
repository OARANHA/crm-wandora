import { describe, expect, it } from "vitest"

import { gerarPkce } from "@/lib/vigia/pkce"
import { criarPayloadOtlpVigia } from "@/lib/vigia/telemetry"

describe("Vigia native integration PKCE", () => {
  it("creates a standards-shaped verifier and challenge without reusing values", () => {
    const first = gerarPkce()
    const second = gerarPkce()

    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second.verifier).not.toBe(first.verifier)
    expect(second.challenge).not.toBe(first.challenge)
  })

describe("Vigia OTLP payload", () => {
  it("uses the hexadecimal ids expected by the Vigia JSON ingest", () => {
    const payload = criarPayloadOtlpVigia({
      kind: "inbound_turn",
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_000_250,
      success: true,
    })

    expect(payload.traceIdHex).toMatch(/^[0-9a-f]{32}$/)
    const body = payload.body as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ traceId: string; spanId: string }> }> }>
    }
    const span = body.resourceSpans[0]?.scopeSpans[0]?.spans[0]
    expect(span?.traceId).toBe(payload.traceIdHex)
    expect(span?.spanId).toMatch(/^[0-9a-f]{16}$/)
  })
})
})
