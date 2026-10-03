import { describe, expect, it } from "vitest"

import { gerarPkce } from "@/lib/vigia/pkce"

describe("Vigia native integration PKCE", () => {
  it("creates a standards-shaped verifier and challenge without reusing values", () => {
    const first = gerarPkce()
    const second = gerarPkce()

    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second.verifier).not.toBe(first.verifier)
    expect(second.challenge).not.toBe(first.challenge)
  })
})
