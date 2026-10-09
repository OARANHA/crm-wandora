/**
 * Recuperação fiscal de vínculo ERP antigo sem confiar no nome como identidade.
 * Somente Pessoa.id ou Pedido.pessoaID iguais ao external_id persistido podem
 * provar a origem do CPF/CNPJ usado para filtrar NFes.
 *
 * Nenhum documento bruto retorna ao modelo: o caller o usa só no backend.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeCnpj } from "@/lib/crm-b2b/normalize";
import { isValidCpf } from "@/lib/legal/perfil-do-pais";

import { buscarClientesErp, buscarPedidosErpComIdentidadeInterna } from "./service";

const TAMANHO_PAGINA = 100;
const MAX_PAGINAS = 5;

export type DocumentoFiscalDoVinculo =
  | { ok: true; documento: string; fonte: "pessoa_id" | "pedido_pessoa_id" }
  | {
      ok: false;
      motivo:
        | "identidade_fiscal_nao_confirmada"
        | "identidade_fiscal_conflitante"
        | "consulta_parcial"
        | "erp_read_failed";
    };

/**
 * O normalizador B2B confere formato, mas não dígitos verificadores.
 * A identidade fiscal requer ambas as verificações antes de filtrar NFes.
 */
function cnpjTemDigitosValidos(cnpj: string): boolean {
  const confere = (pesos: readonly number[], posicao: number): boolean => {
    const soma = pesos.reduce(
      (acumulado, peso, indice) => acumulado + Number(cnpj[indice]) * peso,
      0,
    );
    const resto = soma % 11;
    const digito = resto < 2 ? 0 : 11 - resto;
    return Number(cnpj[posicao]) === digito;
  };
  return (
    confere([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], 12) &&
    confere([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], 13)
  );
}

export function documentoFiscalValido(raw: string | null | undefined): string | null {
  const digits = raw?.replace(/\D/g, "") ?? "";
  if (digits.length === 11) return isValidCpf(digits) ? digits : null;
  if (digits.length === 14) {
    const cnpj = normalizeCnpj(digits);
    return cnpj && cnpjTemDigitosValidos(cnpj) ? cnpj : null;
  }
  return null;
}

export async function comprovarDocumentoFiscalDoVinculo(
  db: SupabaseClient,
  organizationId: string,
  vinculo: { externalId: string; providerLookupLabel: string },
): Promise<DocumentoFiscalDoVinculo> {
  const externalId = vinculo.externalId.trim();
  const label = vinculo.providerLookupLabel.trim();
  if (!externalId || !label) {
    return { ok: false, motivo: "identidade_fiscal_nao_confirmada" };
  }

  // Busca por rótulo é apenas descoberta. Nunca filtrar NFe por nome.
  const pessoas = await buscarClientesErp(db, organizationId, {
    nomefantasia: label,
    pageSize: TAMANHO_PAGINA,
    skip: 0,
  });
  if (!pessoas.ok) return { ok: false, motivo: "erp_read_failed" };
  const exatas = pessoas.dados.filter((p) => p.id?.trim() === externalId);
  if (exatas.length > 1) return { ok: false, motivo: "identidade_fiscal_conflitante" };
  if (exatas.length === 1) {
    const bruto = exatas[0]!.cpfCnpj;
    const documento = documentoFiscalValido(bruto);
    if (documento) return { ok: true, documento, fonte: "pessoa_id" };
    if (bruto?.trim()) {
      return { ok: false, motivo: "identidade_fiscal_nao_confirmada" };
    }
  }

  // Em vínculos antigos, a busca Pessoas por nomefantasia pode não alcançar
  // razão social. Pedidos traz pessoaID e clienteCNPJ no envelope privado.
  // Exigir ID exato e varredura completa antes de aproveitar esse sinal.
  const documentos = new Set<string>();
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const pedidos = await buscarPedidosErpComIdentidadeInterna(db, organizationId, {
      cliente: label,
      pageSize: TAMANHO_PAGINA,
      skip: pagina * TAMANHO_PAGINA,
    });
    if (!pedidos.ok) return { ok: false, motivo: "erp_read_failed" };

    for (const item of pedidos.dados) {
      if (item.identidadeCliente.pessoaId?.trim() !== externalId) continue;
      const bruto = item.identidadeCliente.cpfCnpj;
      const documento = documentoFiscalValido(bruto);
      if (bruto?.trim() && !documento) {
        return { ok: false, motivo: "identidade_fiscal_nao_confirmada" };
      }
      if (documento) documentos.add(documento);
      if (documentos.size > 1) {
        return { ok: false, motivo: "identidade_fiscal_conflitante" };
      }
    }

    if (pedidos.dados.length < TAMANHO_PAGINA) {
      const documento = [...documentos][0];
      return documento
        ? { ok: true, documento, fonte: "pedido_pessoa_id" }
        : { ok: false, motivo: "identidade_fiscal_nao_confirmada" };
    }
  }
  return { ok: false, motivo: "consulta_parcial" };
}
