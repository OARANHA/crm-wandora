import { describe, expect, it } from "vitest";

import { PROVEDOR_VENDAERP } from "@/lib/integracoes-erp/provedores";

describe("VendaERP como primeiro provider do módulo Integrações ERP", () => {
  it("habilita somente capacidades de leitura nesta etapa", () => {
    const habilitadas = PROVEDOR_VENDAERP.capacidades.filter((c) => c.habilitada);
    expect(habilitadas.length).toBeGreaterThan(0);
    expect(habilitadas.every((c) => c.nivel === "read")).toBe(true);
    expect(habilitadas.map((c) => c.id)).toEqual([
      "products.search",
      "stock.read",
      "customers.search",
      "orders.search",
      "invoice.get",
    ]);
  });

  it("deixa escrita e destruição nomeadas, mas desabilitadas", () => {
    const mutacoes = PROVEDOR_VENDAERP.capacidades.filter((c) => c.nivel !== "read");
    expect(mutacoes.length).toBeGreaterThan(0);
    expect(mutacoes.every((c) => !c.habilitada)).toBe(true);
  });

  it("carrega o limite documentado de 1000 requests/hora", () => {
    expect(PROVEDOR_VENDAERP.limiteRequestsPorHora).toBe(1000);
  });
});
