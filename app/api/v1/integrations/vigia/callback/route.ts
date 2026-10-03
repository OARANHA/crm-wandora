import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"

import { audit } from "@/lib/audit"
import { supportCallbackWriteAllowed } from "@/lib/impersonate/support"
import { verifyState } from "@/lib/nuvemshop/state"
import { salvarIntegracaoVigia } from "@/lib/vigia/config"
import { VIGIA_PKCE_COOKIE } from "@/lib/vigia/pkce"

const callbackSchema = z.object({
  code: z.string().min(1).max(12_000),
  state: z.string().min(1).max(4096),
})

const exchangeSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  projectSlug: z.string().min(1).max(256),
  ingestUrl: z.string().url(),
  apiUrl: z.string().url(),
  apiKey: z.string().min(1),
})

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? undefined
  const url = new URL(request.url)
  const parsed = callbackSchema.safeParse({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_callback" }, { status: 400 })
  }

  const state = verifyState(parsed.data.state)
  if (!state?.userId || !state.authSessionId) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 })
  }
  if (!(await supportCallbackWriteAllowed(state.orgId, state.userId, state.authSessionId))) {
    return NextResponse.json({ error: "invalid_session" }, { status: 400 })
  }

  const store = await cookies()
  const verifier = store.get(VIGIA_PKCE_COOKIE)?.value
  if (!verifier) {
    return NextResponse.json({ error: "missing_verifier" }, { status: 400 })
  }

  const vigiaApiUrl = (process.env.VIGIA_API_URL || "https://vigia.wandora.com.br").replace(/\/+$/, "")
  const exchange = await fetch(`${vigiaApiUrl}/v1/integrations/elus/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: parsed.data.code, codeVerifier: verifier }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!exchange?.ok) {
    return NextResponse.json({ error: "vigia_exchange_failed" }, { status: 502 })
  }

  const config = exchangeSchema.safeParse(await exchange.json().catch(() => null))
  if (!config.success) {
    return NextResponse.json({ error: "invalid_vigia_response" }, { status: 502 })
  }

  await salvarIntegracaoVigia(state.orgId, config.data)
  store.delete(VIGIA_PKCE_COOKIE)

  await audit({
    action: "vigia.integration.connected",
    actorUserId: state.userId,
    actorAuthSessionId: state.authSessionId,
    organizationId: state.orgId,
    resourceType: "vigia_integration",
    resourceId: null,
    requestId,
    metadata: {
      vigia_organization_id: config.data.organizationId,
      vigia_project_id: config.data.projectId,
      vigia_project_slug: config.data.projectSlug,
    },
  })

  const vigiaWebUrl = (process.env.VIGIA_WEB_URL || "https://app-vigia.wandora.com.br").replace(/\/+$/, "")
  const redirectUrl = new URL(
    `/projects/${encodeURIComponent(config.data.projectSlug)}/onboarding`,
    vigiaWebUrl,
  )
  redirectUrl.searchParams.set("step", "connect")
  redirectUrl.searchParams.set("source", "elus")
  redirectUrl.searchParams.set("elus_connected", "1")
  return NextResponse.redirect(redirectUrl)
}
