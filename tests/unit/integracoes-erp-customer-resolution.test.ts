import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolverClienteVendaErp,
  selecionarClientesVendaErpCompativeisPorNome,
  selecionarClientesVendaErpExatos,
} from "@/lib/integracoes-erp/resolucao-cliente-vendaerp";
import { normalizarClientesVendaErp } from "@/lib/integracoes-erp/service";
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
  it("preserva identidade quando Pessoas/Pesquisar responde em PascalCase", () => {
    expect(
      normalizarClientesVendaErp([
        {
          ID: "erp-pascal",
          NomeFantasia: "Eco Projetos Engenharia",
          RazaoSocial: "ECO PROJETOS ENGENHARIA LTDA",
          CNPJ_CPF: "12.345.678/0001-90",
          Email: "financeiro@eco.test",
          Telefone: "5130000000",
          Celular: "51999999999",
          Cidade: "Porto Alegre",
          UF: "RS",
        },
      ]),
    ).toEqual([
      {
        id: "erp-pascal",
        nome: "Eco Projetos Engenharia",
        nomeFantasia: "Eco Projetos Engenharia",
        razaoSocial: "ECO PROJETOS ENGENHARIA LTDA",
        cpfCnpj: "12.345.678/0001-90",
        email: "financeiro@eco.test",
        telefone: "5130000000",
        celular: "51999999999",
        cidade: "Porto Alegre",
        uf: "RS",
      },
    ]);
  });

  it("aceita nome fantasia ou razão social somente quando o match normalizado é exato", () => {
    const c = cliente();
    expect(selecionarClientesVendaErpExatos({ nome: "ÉCO PROJETOS" }, [c])).toEqual([c]);
    expect(selecionarClientesVendaErpExatos({ nome: "eco projetos ltda" }, [c])).toEqual([c]);
    expect(selecionarClientesVendaErpExatos({ nome: "Eco Projeto" }, [c])).toEqual([]);
  });

  it("aceita um único nome compatível do provider, sem aceitar busca genérica", () => {
    const c = cliente({
      nome: "Eco Projetos Engenharia",
      nomeFantasia: "Eco Projetos Engenharia",
      razaoSocial: "ECO PROJETOS ENGENHARIA E CONSULTORIA LTDA",
    });

    expect(selecionarClientesVendaErpCompativeisPorNome("Eco Projetos", [c])).toEqual([c]);
    expect(selecionarClientesVendaErpCompativeisPorNome("Eco", [c])).toEqual([]);
    expect(selecionarClientesVendaErpCompativeisPorNome("Eco Projeto", [c])).toEqual([]);
  });

  it("não escolhe o primeiro quando dois clientes são compatíveis", () => {
    const a = cliente({
      id: "erp-a",
      nome: "Eco Projetos Engenharia",
      nomeFantasia: "Eco Projetos Engenharia",
    });
    const b = cliente({
      id: "erp-b",
      nome: "Eco Projetos Arquitetura",
      nomeFantasia: "Eco Projetos Arquitetura",
    });
    expect(selecionarClientesVendaErpCompativeisPorNome("Eco Projetos", [a, b])).toHaveLength(2);
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
