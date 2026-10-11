/**
 * Gate interno da mesma resposta GET Fiscal/ConsultarNFE.
 * O XML nunca sai desta função e nenhum valor textual do provider entra nos motivos.
 * ATENÇÃO: consistência do provider NÃO é autenticidade ou autorização SEFAZ.
 */
export type MotivoProvaFiscalPendente =
  | "entrada_invalida"
  | "resposta_invalida"
  | "identidade_ausente"
  | "identidade_divergente"
  | "xml_ausente"
  | "xml_limite"
  | "xml_tipo_invalido"
  | "xml_proibido"
  | "assinatura_e_autorizacao_externa_pendentes";

export interface ProvaFiscalInternaPendente {
  estado: "nao_comprovado";
  integridadeCriptografica: "nao_verificada";
  autorizacaoSefaz: "nao_verificada";
  motivo: MotivoProvaFiscalPendente;
}

function pendente(motivo: MotivoProvaFiscalPendente): ProvaFiscalInternaPendente {
  return {
    estado: "nao_comprovado",
    integridadeCriptografica: "nao_verificada",
    autorizacaoSefaz: "nao_verificada",
    motivo,
  };
}

function registro(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

/**
 * Resultado sanitizado e fail-closed. A presença de Xml, CodigoStatus=100,
 * nProt, ChaveNFe ou elementos Signature não comprova integridade.
 * Esta função NÃO é, e não deve ser usada como, autorização de emissão/envio.
 */
export function examinarEnvelopeFiscalDaRespostaPrivada(
  resposta: unknown,
  codigoNfeEsperado: number,
): ProvaFiscalInternaPendente {
  if (!Number.isSafeInteger(codigoNfeEsperado) || codigoNfeEsperado <= 0 || codigoNfeEsperado > 2147483647) {
    return pendente("entrada_invalida");
  }
  const dados = registro(resposta);
  if (!dados) return pendente("resposta_invalida");

  const numero = dados.Numero ?? dados.numero;
  const chave = dados.ChaveNFe ?? dados.chaveNFe;
  if (typeof numero !== "number" || !Number.isSafeInteger(numero) ||
      typeof chave !== "string" || !/^\d{44}$/.test(chave)) {
    return pendente("identidade_ausente");
  }
  if (numero !== codigoNfeEsperado || Number(chave.slice(25, 34)) !== numero) {
    // A chave codifica o número NF-e nos dígitos 26..34 (index 25..33).
    // Não corrigir resposta divergente nem aceitar número somente por proximidade.
    return pendente("identidade_divergente");
  }

  const xml = dados.Xml ?? dados.xml;
  if (xml === null || xml === undefined || xml === "") return pendente("xml_ausente");
  if (typeof xml !== "string") return pendente("xml_tipo_invalido");
  if (Buffer.byteLength(xml, "utf8") > 262_144 || xml.length < 80) return pendente("xml_limite");
  // Pré-filtro, NÃO parser XML. Os controles estruturais da PR #95 são
  // experimentais e não habilitam autorização fiscal em produção.
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<\?[^x]|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/i.test(xml)) {
    return pendente("xml_proibido");
  }
  // Nenhum status ou XML autoafirmado promove o documento à categoria autorizada.
  return pendente("assinatura_e_autorizacao_externa_pendentes");
}
