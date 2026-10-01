import { describe, expect, it } from "vitest";

import {
  normalizarClientesVendaErp,
  normalizarPedidosVendaErp,
  normalizarProdutosVendaErp,
} from "@/lib/integracoes-erp/service";
import { VENDAERP_ENDPOINTS } from "@/lib/integracoes-erp/vendaerp";

describe("adapter seguro do VendaERP", () => {
  it("mantém os paths e o casing confirmados pelo Swagger", () => {
    expect(VENDAERP_ENDPOINTS).toEqual({
      configuracoesGet: "/api/request/Configuracoes/Get",
      produtosPesquisar: "/api/request/Produtos/Pesquisar",
      estoqueBuscarQuantidades: "/api/request/Estoque/BuscarQuantidades",
      pessoasPesquisar: "/api/request/Pessoas/Pesquisar",
      pedidosPesquisar: "/api/request/Pedidos/Pesquisar",
      fiscalConsultarNfe: "/api/request/Fiscal/ConsultarNFE",
    });
  });

  it("projeta produto para o contrato interno sem carregar payload bruto", () => {
    expect(
      normalizarProdutosVendaErp([
        {
          id: "p1",
          codigo: "ABC",
          nome: "Produto A",
          precoVenda: 12.5,
          estoqueSaldo: 7,
          estoqueUnidade: "UN",
          ean: "789",
          marca: "Marca",
          categoria: "Categoria",
          precoCusto: 3,
          informacoesAdicionaisNFe: "não deve sair",
        },
      ]),
    ).toEqual([
      {
        id: "p1",
        codigo: "ABC",
        nome: "Produto A",
        preco: 12.5,
        estoque: 7,
        unidade: "UN",
        ean: "789",
        marca: "Marca",
        categoria: "Categoria",
      },
    ]);
  });

  it("nunca projeta senha ou salt do objeto Pessoa para o agente", () => {
    const [cliente] = normalizarClientesVendaErp([
      {
        id: "c1",
        nomeFantasia: "Cliente",
        razaoSocial: "Cliente Ltda",
        cnpJ_CPF: "00000000000",
        email: "cliente@example.test",
        telefone: "1111",
        celular: "9999",
        cidade: "Cidade",
        uf: "RS",
        senha: "segredo-do-provider",
        salt: "salt-do-provider",
      },
    ]);
    expect(cliente).toEqual({
      id: "c1",
      nome: "Cliente",
      nomeFantasia: "Cliente",
      razaoSocial: "Cliente Ltda",
      cpfCnpj: "00000000000",
      email: "cliente@example.test",
      telefone: "1111",
      celular: "9999",
      cidade: "Cidade",
      uf: "RS",
    });
    expect(cliente).not.toHaveProperty("senha");
    expect(cliente).not.toHaveProperty("salt");
  });

  it("projeta do Pedido somente os campos necessários a pedido e nota", () => {
    expect(
      normalizarPedidosVendaErp([
        {
          id: "v1",
          codigo: 42,
          cliente: "Cliente",
          status: "Faturado",
          statusSistema: "Finalizado",
          valorFinal: 100,
          data: "2026-10-01T00:00:00Z",
          finalizado: true,
          numeroNFe: "123",
          dataFaturamento: "2026-10-01T01:00:00Z",
          chaveAcessoNFe: "chave",
          danfeURL: "https://exemplo.test/danfe",
          urlSefaz: "https://exemplo.test/sefaz",
          pagamentos: [{ valor: 100 }],
        },
      ]),
    ).toEqual([
      {
        id: "v1",
        codigo: 42,
        cliente: "Cliente",
        status: "Faturado",
        statusSistema: "Finalizado",
        total: 100,
        data: "2026-10-01T00:00:00Z",
        finalizado: true,
        numeroNFe: "123",
        dataFaturamento: "2026-10-01T01:00:00Z",
        chaveAcessoNFe: "chave",
        danfeUrl: "https://exemplo.test/danfe",
        urlSefaz: "https://exemplo.test/sefaz",
      },
    ]);
  });
});
