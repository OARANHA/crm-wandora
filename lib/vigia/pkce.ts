import { createHash, randomBytes } from "node:crypto"

export const VIGIA_PKCE_COOKIE = "elus_vigia_pkce"
export const VIGIA_PKCE_TTL_SECONDS = 10 * 60

export function gerarPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url")
  const challenge = createHash("sha256").update(verifier, "utf8").digest("base64url")
  return { verifier, challenge }
}
