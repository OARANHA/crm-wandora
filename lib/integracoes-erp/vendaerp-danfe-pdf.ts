import { type RenderizadorUrlPdf } from "@/lib/documentos/renderizar-url-pdf";
import { renderizarUrlParaPdfControlado } from "@/lib/documentos/renderizar-url-pdf-controlado";
import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";

const VENDAERP_DANFE_HOST = "app.vendaerp.com.br";
const VENDAERP_DANFE_PATH = "/v3/public/NFe/Danfe";

export function ehUrlDanfePublicoVendaErp(urlBruta: string): boolean {
  try {
    const url = new URL(urlBruta);
    if (
      url.protocol !== "https:" ||
      url.hostname !== VENDAERP_DANFE_HOST ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== VENDAERP_DANFE_PATH
    ) {
      return false;
    }

    const permitidos = new Set(["print", "Cod", "t", "trib", "g"]);
    for (const chave of url.searchParams.keys()) {
      if (!permitidos.has(chave)) return false;
    }

    const cod = url.searchParams.get("Cod") ?? "";
    const geren = url.searchParams.get("g") ?? "";
    const token = url.searchParams.get("t");
    const print = url.searchParams.get("print");
    const trib = url.searchParams.get("trib");

    if (!/^[a-f0-9]{24}$/i.test(cod)) return false;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(geren)) {
      return false;
    }
    if (token !== null && !/^[a-f0-9]{16,128}$/i.test(token)) return false;
    if (print !== null && print !== "true" && print !== "false") return false;
    if (trib !== null && trib !== "true" && trib !== "false") return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Capability semântica especializada: transforma o DANFE público do VendaERP
 * em PDF usando a capability genérica de documento com policy fechada.
 *
 * Não recebe nem encaminha credenciais do ERP.
 */
export async function renderizarDanfeVendaErpParaPdf(
  url: string,
  renderizador: RenderizadorUrlPdf = renderizarUrlParaPdfControlado,
): Promise<Buffer> {
  return renderizador(url, {
    nome: "erp.vendaerp.danfe_to_pdf",
    permiteUrl: ehUrlDanfePublicoVendaErp,
    maxBytes: MAX_MEDIA_BYTES,
    timeoutMs: 60_000,
  });
}
