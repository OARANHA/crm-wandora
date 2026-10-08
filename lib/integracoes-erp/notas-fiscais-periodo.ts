/**
 * Projeção mínima do Fiscal/ConsultarNfePeriodo.
 * O XML bruto fica confinado ao adapter e NUNCA é exposto ao agente, auditoria ou WhatsApp.
 * O schema HTTP 200 não é tipado no Swagger: exigimos evidência fiscal explícita.
 */
export interface NotaFiscalPeriodoErp {
  numero: number;
  serie: string;
  chave: string;
  dataEmissao: string;
  instanteFiscal: number;
  documentoDestinatario: string;
  danfeDisponivel: boolean;
}

function campoXml(xml: string, campo: string): string | null {
  const match = xml.match(new RegExp("<" + campo + ">([^<]{1,160})</" + campo + ">", "i"));
  return match?.[1]?.trim() ?? null;
}

export function instanteFiscalVendaErp(valor: unknown): number | null {
  if (typeof valor !== "string") return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}):(\d{2})$/.exec(valor.trim());
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  const hora = Number(m[4]);
  const minuto = Number(m[5]);
  const data = new Date(Date.UTC(ano, mes - 1, dia, hora, minuto));
  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia ||
    data.getUTCHours() !== hora ||
    data.getUTCMinutes() !== minuto
  )
    return null;
  return data.getTime();
}

export function normalizarNfesPeriodoVendaErp(resposta: unknown): NotaFiscalPeriodoErp[] {
  if (!Array.isArray(resposta)) throw new Error("invalid_response");
  const notas: NotaFiscalPeriodoErp[] = [];
  for (const entrada of resposta) {
    if (!entrada || typeof entrada !== "object" || Array.isArray(entrada))
      throw new Error("invalid_response");
    const item = entrada as Record<string, unknown>;
    // NFC-e e outros documentos não se confundem com NF-e.
    if (item.Tipo !== "NFe") continue;
    const xml = item.XML;
    if (typeof xml !== "string" || xml.length > 1_000_000)
      throw new Error("invalid_response");
    const dest = xml.match(/<dest(?:\s[^>]*)?>([\s\S]*?)<\/dest>/i)?.[1];
    const protocolo = xml.match(/<protNFe(?:\s[^>]*)?>([\s\S]*?)<\/protNFe>/i)?.[1];
    if (!dest || !protocolo) throw new Error("invalid_response");
    if (campoXml(protocolo, "cStat") !== "100") continue; // não autorizada
    const documento = (campoXml(dest, "CNPJ") ?? campoXml(dest, "CPF") ?? "").replace(/\D/g, "");
    const numero = item.Numero;
    const serie = item.Serie;
    const chave = item.ChaveAcesso;
    const instante = instanteFiscalVendaErp(item.DataEmissao);
    if (
      ![11, 14].includes(documento.length) ||
      typeof numero !== "number" ||
      !Number.isSafeInteger(numero) ||
      numero <= 0 ||
      typeof serie !== "string" ||
      !serie.trim() ||
      typeof chave !== "string" ||
      !/^\d{44}$/.test(chave) ||
      instante === null
    )
      throw new Error("invalid_response");
    notas.push({
      numero,
      serie: serie.trim(),
      chave,
      dataEmissao: (item.DataEmissao as string).trim(),
      instanteFiscal: instante,
      documentoDestinatario: documento,
      danfeDisponivel:
        typeof item.UrlImpressaoUrl === "string" && item.UrlImpressaoUrl.trim().length > 0,
    });
  }
  return notas;
}

/** Dedupe por chave fiscal; jamais por número ou posição do provider. */
export function selecionarNotasRecentes(
  notas: readonly NotaFiscalPeriodoErp[],
  quantidade: number,
  documento?: string,
): NotaFiscalPeriodoErp[] {
  const alvo = documento?.replace(/\D/g, "") ?? null;
  const unicas = new Map<string, NotaFiscalPeriodoErp>();
  for (const nota of notas) {
    if (alvo && nota.documentoDestinatario !== alvo) continue;
    const anterior = unicas.get(nota.chave);
    if (
      anterior &&
      (anterior.numero !== nota.numero || anterior.instanteFiscal !== nota.instanteFiscal)
    )
      throw new Error("invalid_response");
    unicas.set(nota.chave, nota);
  }
  return [...unicas.values()]
    .sort(
      (a, b) => b.instanteFiscal - a.instanteFiscal || a.chave.localeCompare(b.chave),
    )
    .slice(0, quantidade);
}
