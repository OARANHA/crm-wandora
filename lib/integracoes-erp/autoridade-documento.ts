import type { SupabaseClient } from "@supabase/supabase-js";

import { samePhone } from "@/lib/channels/phone-variants";
import { hashCpf, normalizeCpf } from "@/lib/contacts/cpf";

import {
  buscarClientesErp,
  type PedidoErpComIdentidadeInterna,
} from "./service";
import type { ClienteErp } from "./tipos";

export type EvidenciaIdentidadeDocumento = "cpf" | "email" | "telefone";

export type MotivoAutoridadeDocumento =
  | "banco"
  | "contato_nao_encontrado"
  | "contato_anonimizado"
  | "identidade_erp_insuficiente"
  | "cliente_erp_nao_encontrado"
  | "cliente_erp_ambiguo"
  | "contato_sem_identidade_comparavel"
  | "identidade_nao_confere"
  | "erp_read_failed";

export interface IdentidadeContatoParaDocumento {
  id: string;
  phone_number: string | null;
  email_normalized: string | null;
  cpf_hash: string | null;
  is_anonymized: boolean;
}

export type ProvaPedidoDoContato =
  | {
      ok: true;
      evidencias: EvidenciaIdentidadeDocumento[];
    }
  | {
      ok: false;
      motivo: MotivoAutoridadeDocumento;
      motivoProvider?: string;
    };

function emailNormalizado(valor: string | null | undefined): string | null {
  const email = valor?.trim().toLowerCase();
  return email ? email : null;
}

function documentoNormalizado(valor: string | null | undefined): string | null {
  const digitos = normalizeCpf(valor ?? "");
  return digitos ? digitos : null;
}

function telefoneComPaisDaConversa(telefoneContato: string, telefoneErp: string): string {
  const contato = telefoneContato.replace(/\D/g, "");
  const erp = telefoneErp.replace(/\D/g, "");

  // O contato do CRM já é a autoridade de país. Só acrescentamos 55 quando
  // ELE é brasileiro e o ERP trouxe exatamente DDD+número (10/11 dígitos).
  if (contato.startsWith("55") && (erp.length === 10 || erp.length === 11)) {
    return `55${erp}`;
  }
  return telefoneErp;
}

export function telefoneVendaErpConfere(
  telefoneContato: string,
  telefoneErp: string | null | undefined,
): boolean {
  if (!telefoneErp?.trim()) return false;
  if (samePhone(telefoneContato, telefoneErp)) return true;
  return samePhone(telefoneContato, telefoneComPaisDaConversa(telefoneContato, telefoneErp));
}

function clienteConfereComPedido(
  pedido: PedidoErpComIdentidadeInterna,
  cliente: ClienteErp,
): boolean {
  const identidade = pedido.identidadeCliente;

  // pessoaID é o elo nominalmente compartilhado pelo schema Pedido -> Pessoa.
  // Se veio preenchido, não aceitamos uma Pessoa diferente só porque nome bate.
  if (identidade.pessoaId && cliente.id !== identidade.pessoaId) return false;

  const comparacoes: boolean[] = [];
  const documentoPedido = documentoNormalizado(identidade.cpfCnpj);
  const documentoCliente = documentoNormalizado(cliente.cpfCnpj);
  if (documentoPedido && documentoCliente) {
    comparacoes.push(documentoPedido === documentoCliente);
  }

  const emailPedido = emailNormalizado(identidade.email);
  const emailCliente = emailNormalizado(cliente.email);
  if (emailPedido && emailCliente) {
    comparacoes.push(emailPedido === emailCliente);
  }

  return comparacoes.length > 0 && comparacoes.every(Boolean);
}

export type SelecaoClienteDoPedido =
  | { ok: true; cliente: ClienteErp }
  | { ok: false; motivo: "cliente_erp_nao_encontrado" | "cliente_erp_ambiguo" };

export function selecionarClienteDoPedido(
  pedido: PedidoErpComIdentidadeInterna,
  clientes: readonly ClienteErp[],
): SelecaoClienteDoPedido {
  const candidatos = clientes.filter((cliente) => clienteConfereComPedido(pedido, cliente));
  if (candidatos.length === 0) return { ok: false, motivo: "cliente_erp_nao_encontrado" };
  if (candidatos.length > 1) return { ok: false, motivo: "cliente_erp_ambiguo" };
  return { ok: true, cliente: candidatos[0]! };
}

export function conferirContatoComClienteErp(
  contato: IdentidadeContatoParaDocumento,
  cliente: ClienteErp,
): ProvaPedidoDoContato {
  const verificacoes: Array<{ evidencia: EvidenciaIdentidadeDocumento; confere: boolean }> = [];

  const documentoCliente = documentoNormalizado(cliente.cpfCnpj);
  // contacts.cpf_hash é CPF de pessoa física. CNPJ (14 dígitos) nunca entra
  // nessa comparação e precisa de outro identificador em comum.
  if (contato.cpf_hash && documentoCliente?.length === 11) {
    verificacoes.push({
      evidencia: "cpf",
      confere: hashCpf(documentoCliente) === contato.cpf_hash,
    });
  }

  const emailContato = emailNormalizado(contato.email_normalized);
  const emailCliente = emailNormalizado(cliente.email);
  if (emailContato && emailCliente) {
    verificacoes.push({ evidencia: "email", confere: emailContato === emailCliente });
  }

  if (contato.phone_number) {
    const telefones = [cliente.celular, cliente.telefone].filter(
      (valor): valor is string => Boolean(valor?.trim()),
    );
    if (telefones.length > 0) {
      verificacoes.push({
        evidencia: "telefone",
        confere: telefones.some((telefone) =>
          telefoneVendaErpConfere(contato.phone_number!, telefone),
        ),
      });
    }
  }

  if (verificacoes.length === 0) {
    return { ok: false, motivo: "contato_sem_identidade_comparavel" };
  }
  if (verificacoes.some((verificacao) => !verificacao.confere)) {
    return { ok: false, motivo: "identidade_nao_confere" };
  }

  return {
    ok: true,
    evidencias: verificacoes.map((verificacao) => verificacao.evidencia),
  };
}

/**
 * Prova server-side de que o pedido pertence ao contato desta conversa.
 *
 * O pedido traz CPF/CNPJ/e-mail e, quando disponível, pessoaID. Esses campos
 * nunca voltam ao browser. Eles servem para localizar a Pessoa do VendaERP por
 * uma consulta GET e comparar CPF/e-mail/telefone com o contato canônico do CRM.
 */
export async function provarPedidoDoContato(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string,
  pedido: PedidoErpComIdentidadeInterna,
): Promise<ProvaPedidoDoContato> {
  const { data, error } = await admin
    .from("contacts")
    .select("id, phone_number, email_normalized, cpf_hash, is_anonymized")
    .eq("organization_id", organizationId)
    .eq("id", contactId)
    .maybeSingle();

  if (error) return { ok: false, motivo: "banco" };
  if (!data) return { ok: false, motivo: "contato_nao_encontrado" };

  const contato = data as IdentidadeContatoParaDocumento;
  if (contato.is_anonymized) return { ok: false, motivo: "contato_anonimizado" };

  const cpfCnpj = pedido.identidadeCliente.cpfCnpj?.trim();
  const email = pedido.identidadeCliente.email?.trim();
  if (!cpfCnpj && !email) {
    return { ok: false, motivo: "identidade_erp_insuficiente" };
  }

  const clientes = await buscarClientesErp(admin, organizationId, {
    ...(cpfCnpj ? { cpfcnpj: cpfCnpj } : { email }),
    pageSize: 20,
    skip: 0,
  });
  if (!clientes.ok) {
    return {
      ok: false,
      motivo: "erp_read_failed",
      motivoProvider: clientes.motivo,
    };
  }

  const selecionado = selecionarClienteDoPedido(pedido, clientes.dados);
  if (!selecionado.ok) return selecionado;

  return conferirContatoComClienteErp(contato, selecionado.cliente);
}
