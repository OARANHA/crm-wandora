import { describe, expect, it } from "vitest";

import {
  cabecalhosDanfeVendaErp,
  cabecalhosVendaErp,
  montarUrlVendaErp,
} from "@/lib/integracoes-erp/vendaerp";

describe("cliente VendaERP", () => {
  it("monta endpoints sem perder um prefixo configurado na base", () => {
    expect(
      montarUrlVendaErp("https://erp.exemplo.test/integracao", "/api/request/Pedidos/Pesquisar", {
        codigo: 42,
        skip: 0,
      }),
    ).toBe("https://erp.exemplo.test/integracao/api/request/Pedidos/Pesquisar?codigo=42&skip=0");
  });

  it("preserva o nome do depósito e booleano na consulta de estoque", () => {
    expect(
      montarUrlVendaErp("https://erp.exemplo.test", "/api/request/Estoque/BuscarQuantidades", {
        deposito: "PADRÃO",
        visivelCatalogo: false,
      }),
    ).toBe(
      "https://erp.exemplo.test/api/request/Estoque/BuscarQuantidades?deposito=PADR%C3%83O&visivelCatalogo=false",
    );
  });

  it("preserva o casing dos parâmetros fiscais do VendaERP", () => {
    expect(
      montarUrlVendaErp("https://erp.exemplo.test", "/api/request/Fiscal/ConsultarNFE", {
        CodigoNFe: 64996396,
      }),
    ).toBe("https://erp.exemplo.test/api/request/Fiscal/ConsultarNFE?CodigoNFe=64996396");

    expect(
      montarUrlVendaErp("https://erp.exemplo.test", "/api/request/Fiscal/InformacoesVenda", {
        Codigo: 50,
      }),
    ).toBe("https://erp.exemplo.test/api/request/Fiscal/InformacoesVenda?Codigo=50");
  });

  it("usa exatamente os três cabeçalhos de autenticação do contrato", () => {
    expect(
      cabecalhosVendaErp({ authorizationToken: "segredo", user: "usuario", app: "app" }),
    ).toMatchObject({
      "Authorization-Token": "segredo",
      User: "usuario",
      App: "app",
    });
  });

  it("só envia autenticação ao DANFE quando a URL mantém o mesmo origin do VendaERP", () => {
    const credenciais = {
      baseUrl: "https://erp.exemplo.test/integracao",
      authorizationToken: "segredo",
      user: "usuario",
      app: "app",
    };

    expect(
      cabecalhosDanfeVendaErp(
        credenciais,
        "https://erp.exemplo.test/api/request/Fiscal/ImprimirDanfe?id=1",
      ),
    ).toMatchObject({
      "Authorization-Token": "segredo",
      User: "usuario",
      App: "app",
    });

    expect(
      cabecalhosDanfeVendaErp(credenciais, "https://cdn.exemplo.test/danfe/1.pdf"),
    ).toBeUndefined();

    expect(
      cabecalhosDanfeVendaErp(credenciais, "https://erp.exemplo.test.evil.invalid/danfe"),
    ).toBeUndefined();
  });
});
