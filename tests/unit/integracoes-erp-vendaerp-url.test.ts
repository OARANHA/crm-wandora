import { describe, expect, it } from "vitest";

import { cabecalhosVendaErp, montarUrlVendaErp } from "@/lib/integracoes-erp/vendaerp";

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
      montarUrlVendaErp(
        "https://erp.exemplo.test",
        "/api/request/Estoque/BuscarQuantidades",
        { deposito: "PADRÃO", visivelCatalogo: false },
      ),
    ).toBe(
      "https://erp.exemplo.test/api/request/Estoque/BuscarQuantidades?deposito=PADR%C3%83O&visivelCatalogo=false",
    );
  });

  it("usa exatamente os três cabeçalhos de autenticação do contrato", () => {
    expect(cabecalhosVendaErp({ authorizationToken: "segredo", user: "usuario", app: "app" })).toMatchObject({
      "Authorization-Token": "segredo",
      User: "usuario",
      App: "app",
    });
  });
});
