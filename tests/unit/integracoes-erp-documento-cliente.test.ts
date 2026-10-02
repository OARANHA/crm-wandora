import { describe, expect, it } from "vitest";

import { hashCpf } from "@/lib/contacts/cpf";
import {
  conferirContatoComClienteErp,
  selecionarClienteDoPedido,
  telefoneVendaErpConfere,
  type IdentidadeContatoParaDocumento,
} from "@/lib/integracoes-erp/autoridade-documento";
import type { PedidoErpComIdentidadeInterna } from "@/lib/integracoes-erp/service";
import type { ClienteErp } from "@/lib/integracoes-erp/tipos";

function pedido(
  patch: Partial<PedidoErpComIdentidadeInterna["identidadeCliente"]> = {},
): PedidoErpComIdentidadeInterna {
  return {
    pedido: {
      id: "venda-1",
      codigo: 12345,
      cliente: "Cliente Teste",
      status: "Faturado",
      statusSistema: "Finalizado",
      total: 199.9,
      data: "2026-10-02T12:00:00",
      finalizado: true,
      numeroNFe: "98765",
      dataFaturamento: "2026-10-02T13:00:00",
      chaveAcessoNFe: "chave-nao-real",
      danfeUrl: "https://example.test/danfe",
      urlSefaz: null,
    },
    identidadeCliente: {
      clienteId: "cliente-erp-1",
      pessoaId: "pessoa-erp-1",
      cpfCnpj: "123.456.789-09",
      email: "cliente@example.test",
      ...patch,
    },
  };
}

function cliente(patch: Partial<ClienteErp> = {}): ClienteErp {
  return {
    id: "pessoa-erp-1",
    nome: "Cliente Teste",
    nomeFantasia: "Cliente Teste",
    razaoSocial: null,
    cpfCnpj: "12345678909",
    email: "cliente@example.test",
    telefone: null,
    celular: "(51) 99999-9999",
    cidade: "Porto Alegre",
    uf: "RS",
    ...patch,
  };
}

describe("autoridade do documento ERP", () => {
  it("não usa nome como identidade quando pessoaID aponta para outra Pessoa", () => {
    const selecao = selecionarClienteDoPedido(pedido(), [
      cliente({ id: "outra-pessoa", nome: "Cliente Teste" }),
    ]);
    expect(selecao).toEqual({ ok: false, motivo: "cliente_erp_nao_encontrado" });
  });

  it("seleciona a Pessoa única quando pessoaID + CPF/e-mail concordam", () => {
    const esperado = cliente();
    const selecao = selecionarClienteDoPedido(pedido(), [
      cliente({ id: "outra-pessoa", cpfCnpj: "99999999999", email: "outra@example.test" }),
      esperado,
    ]);
    expect(selecao).toEqual({ ok: true, cliente: esperado });
  });

  it("recusa ambiguidade quando o pedido não traz pessoaID e duas Pessoas têm a mesma identidade", () => {
    const semPessoaId = pedido({ pessoaId: null });
    const selecao = selecionarClienteDoPedido(semPessoaId, [
      cliente({ id: "pessoa-a" }),
      cliente({ id: "pessoa-b" }),
    ]);
    expect(selecao).toEqual({ ok: false, motivo: "cliente_erp_ambiguo" });
  });

  it("compara celular local do VendaERP com telefone brasileiro canônico do CRM", () => {
    expect(telefoneVendaErpConfere("+55 (51) 99999-9999", "(51) 99999-9999")).toBe(true);
    expect(telefoneVendaErpConfere("+55 (51) 99999-9999", "(51) 98888-8888")).toBe(false);
  });

  it("CPF/e-mail/telefone precisam concordar quando todos são comparáveis", () => {
    const contato: IdentidadeContatoParaDocumento = {
      id: "contato-1",
      phone_number: "+5551999999999",
      email_normalized: "cliente@example.test",
      cpf_hash: hashCpf("12345678909"),
      is_anonymized: false,
    };

    expect(conferirContatoComClienteErp(contato, cliente())).toEqual({
      ok: true,
      evidencias: ["cpf", "email", "telefone"],
    });

    expect(
      conferirContatoComClienteErp(
        contato,
        cliente({ email: "outra@example.test" }),
      ),
    ).toEqual({ ok: false, motivo: "identidade_nao_confere" });
  });

  it("falha fechado quando não existe identificador comparável", () => {
    const contato: IdentidadeContatoParaDocumento = {
      id: "contato-1",
      phone_number: null,
      email_normalized: null,
      cpf_hash: null,
      is_anonymized: false,
    };
    expect(conferirContatoComClienteErp(contato, cliente())).toEqual({
      ok: false,
      motivo: "contato_sem_identidade_comparavel",
    });
  });
});
