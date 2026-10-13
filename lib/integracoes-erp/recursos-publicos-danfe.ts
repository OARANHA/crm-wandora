/**
 * Apenas dependências observadas no navegador humano da DANFE pública VendaERP.
 * Nunca reutilizar como uma allowlist genérica de endpoints ou de escrita ERP.
 */
export const HOSTS_RECURSOS_DANFE_VENDAERP = [
  "novaapi.vendaerp.com.br",
  "d1fkuoqvag3bur.cloudfront.net",
] as const;

const ORIGEM_DANFE = "https://app.vendaerp.com.br";
const API_PUBLICA = "https://novaapi.vendaerp.com.br";
const CDN_PUBLICA = "https://d1fkuoqvag3bur.cloudfront.net";

export function recursoPublicoDanfeVendaErpPermitido(
  urlBruta: string,
  metodo: string,
  gEsperado?: string,
): boolean {
  try {
    const url = new URL(urlBruta);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) {
      return false;
    }

    // Consulta da página pública, NÃO Fiscal/ConsultarNFE, não ERP write.
    if (url.origin === API_PUBLICA) {
      if (metodo !== "POST" && metodo !== "OPTIONS") return false;
      if (url.pathname !== "/v3/CriaDANFE/GetDanfeInfoPublic") return false;
      const chaves = [...url.searchParams.keys()];
      if (chaves.length !== 1 || chaves[0] !== "g") return false;
      const g = url.searchParams.get("g") ?? "";
      return (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(g) &&
        (!gEsperado || g === gEsperado)
      );
    }

    if (url.origin === CDN_PUBLICA) {
      if (metodo !== "GET" && metodo !== "HEAD") return false;
      if (url.search) return false;
      // Bundles Angular/webpack: main, styles e chunks compartilhados com ~.
      // Sem wildcards de host, paths de API, extensões arbitrárias nem traversal.
      return /^\/v3\/[a-z0-9_~-]+\.[a-f0-9]{8,64}\.(?:js|css)$/i.test(url.pathname);
    }

    // Origem da própria página segue a régua genérica, não esta exceção.
    if (url.origin === ORIGEM_DANFE) return false;
    return false;
  } catch {
    return false;
  }
}
