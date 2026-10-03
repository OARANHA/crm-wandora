import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/auth/require-role"
import { loadAuthUser } from "@/lib/auth/server"
import { authenticatedSessionId } from "@/lib/impersonate/support"
import { issueState } from "@/lib/nuvemshop/state"
import { gerarPkce, VIGIA_PKCE_COOKIE, VIGIA_PKCE_TTL_SECONDS } from "@/lib/vigia/pkce"

const querySchema = z.object({
  vigia_project: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/),
})

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? undefined
  const url = new URL(request.url)

  const currentUser = await loadAuthUser()
  if (!currentUser) {
    const next = `${url.pathname}${url.search}`
    const loginUrl = new URL("/login", url.origin)
    loginUrl.searchParams.set("next", next)
    return NextResponse.redirect(loginUrl)
  }

  const authz = await requireRole("admin", { requestId, resource: "vigia_integration" })
  if (!authz.ok) return authz.response
  const parsed = querySchema.safeParse({ vigia_project: url.searchParams.get("vigia_project") })
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_project" }, { status: 400 })
  }

  const { verifier, challenge } = gerarPkce()
  const state = issueState(authz.org.orgId, {
    userId: authz.user.id,
    authSessionId: await authenticatedSessionId(),
  })

  const store = await cookies()
  store.set(VIGIA_PKCE_COOKIE, verifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/integrations/vigia",
    maxAge: VIGIA_PKCE_TTL_SECONDS,
  })

  const vigiaWebUrl = (process.env.VIGIA_WEB_URL || "https://app-vigia.wandora.com.br").replace(/\/+$/, "")
  const redirectUrl = new URL(
    `/projects/${encodeURIComponent(parsed.data.vigia_project)}/onboarding`,
    vigiaWebUrl,
  )
  redirectUrl.searchParams.set("step", "connect")
  redirectUrl.searchParams.set("source", "elus")
  redirectUrl.searchParams.set("elus_state", state)
  redirectUrl.searchParams.set("elus_challenge", challenge)
  return NextResponse.redirect(redirectUrl)
}
