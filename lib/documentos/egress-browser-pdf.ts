import { isIPv4 } from "node:net";

import { ipEhEspecial } from "@/lib/automation/outbound-ip";

/**
 * Controle de rede do browser que materializa um documento remoto.
 * O navegador somente recebe a URL de bootstrap loopback (nonce) e pode
 * alcançar recursos HTTPS na mesma origem já autorizada pela policy externa.
 *
 * Nunca logar as URLs: o querystring fiscal pode carregar tokens.
 */
export function recursoPermitidoNoBrowserDeDocumento(
  urlBruta: string,
  origemDocumentoBruta: string,
  bootstrapUrl: string,
  metodo: string,
): boolean {
  if (metodo !== "GET" && metodo !== "HEAD") return false;
  if (urlBruta === bootstrapUrl) return metodo === "GET";

  try {
    const destino = new URL(urlBruta);
    const origem = new URL(origemDocumentoBruta);
    return (
      destino.protocol === "https:" &&
      origem.protocol === "https:" &&
      destino.origin === origem.origin &&
      destino.username === "" &&
      destino.password === "" &&
      destino.port === "" &&
      origem.username === "" &&
      origem.password === "" &&
      origem.port === ""
    );
  } catch {
    return false;
  }
}

/**
 * Browser precisa usar UMA resolução DNS pública fixada na conexão, sem segunda
 * consulta insegura no Chrome. Endereço privado em QUALQUER registro recusa tudo,
 * mesmo que também exista um IP público. IPv6 não é escolhido neste slice:
 * prefira falhar fechado a criar um MAP sem semântica comprovada.
 */
export function selecionarIpPublicoFixadoParaBrowser(ips: readonly string[]): string | null {
  if (ips.length === 0 || ips.some((ip) => ipEhEspecial(ip))) return null;
  return ips.find((ip) => isIPv4(ip)) ?? null;
}
