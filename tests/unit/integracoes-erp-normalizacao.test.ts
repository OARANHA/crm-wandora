import { describe, expect, it } from "vitest";

import {
  normalizarClientesVendaErp,
  normalizarDepositosVendaErp,
  normalizarEstoqueVendaErp,
  normalizarInformacaoFiscalVendaVendaErp,
  normalizarNotaVendaErp,
  normalizarPedidosVendaErp,
  normalizarPedidosVendaErpComIdentidadeInterna,
  normalizarProdutosVendaErp,
  resolverDepositoEstoque,
} from "@/lib/integracoes-erp/service";
import { VENDAERP_ENDPOINTS } from "@/lib/integracoes-erp/vendaerp";

describe("adapter seguro do VendaERP", () => {
  it("mantém os paths e o casing confirmados pelo Swagger", () => {
    expect(VENDAERP_ENDPOINTS).toEqual({
      configuracoesGet: "/api/request/Configuracoes/Get",
      depositosGetTodos: "/api/request/Depositos/GetTodosDepositos",
      produtosPesquisar: "/api/request/Produtos/Pesquisar",
      estoqueBuscarQuantidades: "/api/request/Estoque/BuscarQuantidades",
      pessoasPesquisar: "/api/request/Pessoas/Pesquisar",
      pedidosPesquisar: "/api/request/Pedidos/Pesquisar",
      fiscalInformacoesVenda: "/api/request/Fiscal/InformacoesVenda",
      fiscalConsultarNfe: "/api/request/Fiscal/ConsultarNFE",
    });
  });

  it("normaliza depósitos tanto no casing do Swagger quanto no observado ao vivo", () => {
    expect(
      normalizarDepositosVendaErp([
        { id: "d1", nome: "PADRÃO", empresaID: "e1", empresa: "Empresa A" },
        { ID: "d2", Nome: "FILIAL", EmpresaID: "e2", Empresa: "Empresa B" },
      ]),
    ).toEqual([
      { id: "d1", nome: "PADRÃO", empresaId: "e1", empresa: "Empresa A" },
      { id: "d2", nome: "FILIAL", empresaId: "e2", empresa: "Empresa B" },
    ]);
  });

  it("normaliza a resposta real observada de Estoque/BuscarQuantidades sem inventar disponível", () => {
    expect(
      normalizarEstoqueVendaErp({
        EstoqueItens: [
          { ProdutoCodigo: "316", EstoqueAtual: -37, SaldoReservado: 0 },
          { ProdutoCodigo: "316-1", EstoqueAtual: -7, SaldoReservado: 0 },
        ],
      }),
    ).toEqual([
      { codigo: "316", estoqueAtual: -37, saldoReservado: 0 },
      { codigo: "316-1", estoqueAtual: -7, saldoReservado: 0 },
    ]);
  });

  it("só escolhe depósito automaticamente quando existe um único", () => {
    expect(
      resolverDepositoEstoque(undefined, [
        { id: "d1", nome: "PADRÃO", empresaId: "e1", empresa: "Empresa" },
      ]),
    ).toEqual({ ok: true, deposito: "PADRÃO", origem: "unico" });

    const ambiguo = resolverDepositoEstoque(undefined, [
      { id: "d1", nome: "PADRÃO", empresaId: "e1", empresa: "Empresa" },
      { id: "d2", nome: "FILIAL", empresaId: "e1", empresa: "Empresa" },
    ]);
    expect(ambiguo.ok).toBe(false);
    if (!ambiguo.ok) expect(ambiguo.motivo).toBe("deposito_ambiguo");

    expect(
      resolverDepositoEstoque("CENTRAL", [
        { id: "d1", nome: "PADRÃO", empresaId: "e1", empresa: "Empresa" },
      ]),
    ).toEqual({ ok: true, deposito: "CENTRAL", origem: "informado" });
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

  it("projeta ConsultarNFE sem carregar o XML fiscal bruto", () => {
    const nota = normalizarNotaVendaErp({
      CodigoStatus: 100,
      MsgStatus: "Autorizado o uso da NF-e",
      ChaveNFe: "43261046793999000174550020649963961404794580",
      Numero: 64996396,
      Lote: 89,
      UrlImpressaoDanfe: "https://app.vendaerp.com.br/danfe",
      Xml: "<nfe>conteudo sensivel e grande</nfe>",
    });

    expect(nota).toEqual({
      numero: 64996396,
      codigoStatus: 100,
      mensagemStatus: "Autorizado o uso da NF-e",
      chave: "43261046793999000174550020649963961404794580",
      lote: 89,
      danfeUrl: "https://app.vendaerp.com.br/danfe",
    });
    expect(nota).not.toHaveProperty("Xml");
    expect(nota).not.toHaveProperty("xml");
  });

  it("normaliza InformacoesVenda sem inventar timezone para DataEmissao", () => {
    expect(
      normalizarInformacaoFiscalVendaVendaErp({
        Tipo: "NFe",
        Numero: 64996340,
        Serie: "02",
        ChaveAcesso: "43260546793999000174550020649963401293730147",
        DataEmissao: "27/05/2026 - 13:14",
        UrlImpressaoUrl: "https://app.vendaerp.com.br/danfe-venda",
      }),
    ).toEqual({
      tipo: "NFe",
      numero: 64996340,
      serie: "02",
      chave: "43260546793999000174550020649963401293730147",
      dataEmissao: "27/05/2026 - 13:14",
      danfeUrl: "https://app.vendaerp.com.br/danfe-venda",
    });
  });

  it("projeta do Pedido somente os campos necessários a pedido e nota", () => {
    expect(
      normalizarPedidosVendaErp([
        {
          id: "v1",
          codigo: 42,
          cliente: "Cliente",
          pessoaID: "pessoa-erp-1",
          clienteCNPJ: "12345678909",
          clienteEmail: "cliente@example.test",
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

    const [publico] = normalizarPedidosVendaErp([
      {
        id: "v2",
        codigo: 43,
        cliente: "Cliente",
        pessoaID: "pessoa-erp-2",
        clienteCNPJ: "98765432100",
        clienteEmail: "outro@example.test",
      },
    ]);
    expect(publico).not.toHaveProperty("pessoaID");
    expect(publico).not.toHaveProperty("pessoaId");
    expect(publico).not.toHaveProperty("clienteCNPJ");
    expect(publico).not.toHaveProperty("clienteEmail");
    expect(publico).not.toHaveProperty("identidadeCliente");

    const [interno] = normalizarPedidosVendaErpComIdentidadeInterna([
      {
        id: "v2",
        codigo: 43,
        cliente: "Cliente",
        pessoaID: "pessoa-erp-2",
        clienteCNPJ: "98765432100",
        clienteEmail: "outro@example.test",
      },
    ]);
    expect(interno?.identidadeCliente).toEqual({
      pessoaId: "pessoa-erp-2",
      cpfCnpj: "98765432100",
      email: "outro@example.test",
    });
  });
});
