import type { CapacidadeDoProvedorErp } from "./tipos";

export const PROVEDOR_VENDAERP = {
  id: "vendaerp",
  nome: "VendaERP",
  limiteRequestsPorHora: 1000,
  capacidades: [
    { id: "products.search", nivel: "read", habilitada: true },
    { id: "stock.read", nivel: "read", habilitada: true },
    { id: "customers.search", nivel: "read", habilitada: true },
    { id: "orders.search", nivel: "read", habilitada: true },
    { id: "invoice.get", nivel: "read", habilitada: true },

    // O Swagger já oferece estas operações, mas a primeira etapa do módulo não
    // as expõe. Elas ficam nomeadas para a evolução não exigir outra fronteira.
    { id: "orders.save", nivel: "write", habilitada: false },
    { id: "orders.invoice", nivel: "write", habilitada: false },
    { id: "invoice.issue_nfe", nivel: "write", habilitada: false },
    { id: "invoice.issue_nfce", nivel: "write", habilitada: false },
    { id: "orders.delete", nivel: "destructive", habilitada: false },
  ] satisfies readonly CapacidadeDoProvedorErp[],
} as const;

export const PROVEDORES_ERP = [PROVEDOR_VENDAERP] as const;
export type ProvedorErpId = (typeof PROVEDORES_ERP)[number]["id"];
