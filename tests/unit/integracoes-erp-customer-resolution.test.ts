import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolverClienteVendaErp,
  selecionarClientesVendaErpExatos,
} from "@/lib/integracoes-erp/resolucao-cliente-vendaerp";
import type { ClienteErp } from "@/lib/integracoes-erp/tipos";

function cliente(overrides: Partial<ClienteErp> = {}): ClienteErp {
  return {
    id: "erp-1",
    nome: "Eco Projetos",
    nomeFantasia: "Eco Projetos",
    razaoSocial: "ECO PROJETOS LTDA",
    cpfCnpj: "12.345.678/0001-90",
    email: "financeiro@eco.test",
    telefone: null,
    celular: null,
    cidade: "Porto Alegre",
    uf: "RS",
    ...overrides,
  };
}

describe("Customer Resolution VendaERP — seleção fail-closed", () => {
  it("aceita nome fantasia ou razão social somente quando o match normalizado é exato", () => {
    const c = cliente();
    expect(selecionarClientesVendaErpExatos({ nome: "ÉCO PROJETOS" }, [c])).toEqual([c]);
    expect(selecionarClientesVendaErpExatos({ nome: "eco projetos ltda" }, [c])).toEqual([c]);
    expect(selecionarClientesVendaErpExatos({ nome: "Eco Projeto" }, [c])).toEqual([]);
  });

  it("CPF/CNPJ e e-mail precisam concordar quando ambos foram informados", () => {
    const c = cliente();
    expect(
      selecionarClientesVendaErpExatos(
        { cpfCnpj: "12345678000190", email: "FINANCEIRO@ECO.TEST" },
        [c],
      ),
    ).toEqual([c]);
    expect(
      selecionarClientesVendaErpExatos({ cpfCnpj: "12345678000190", email: "outro@eco.test" }, [c]),
    ).toEqual([]);
  });

  it("não transforma múltiplos clientes exatos em escolha pelo primeiro resultado", () => {
    const a = cliente({ id: "erp-a" });
    const b = cliente({ id: "erp-b" });
    expect(selecionarClientesVendaErpExatos({ nome: "Eco Projetos" }, [a, b])).toHaveLength(2);
  });
  it("recusa sinais conflitantes antes de tocar no banco/provider", async () => {
    const resultado = await resolverClienteVendaErp({} as SupabaseClient, "org-x", {
      contactId: "11111111-1111-4111-8111-111111111111",
      nome: "Outro cliente",
    });
    expect(resultado).toEqual({ status: "unresolved", motivo: "sinais_conflitantes" });
  });

  it("recusa resolução sem nenhum sinal", async () => {
    const resultado = await resolverClienteVendaErp({} as SupabaseClient, "org-x", {});
    expect(resultado).toEqual({ status: "unresolved", motivo: "sinais_insuficientes" });
  });
});
