import { describe, expect, it } from "vitest";

import { deModuloDesligado, catalogEntry } from "@/lib/mcp/tools/catalog";
import {
  crmErpGetInvoice,
  crmErpReadStock,
  crmErpSearchCustomers,
  crmErpSearchOrders,
  crmErpSearchProducts,
} from "@/lib/mcp/tools/integracoes-erp";

const TOOLS = [
  crmErpSearchProducts,
  crmErpReadStock,
  crmErpSearchCustomers,
  crmErpSearchOrders,
  crmErpGetInvoice,
] as const;

describe("tools READ-ONLY de Integrações ERP", () => {
  it("expõe exatamente as cinco capacidades de leitura da V1", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "crm_erp_search_products",
      "crm_erp_read_stock",
      "crm_erp_search_customers",
      "crm_erp_search_orders",
      "crm_erp_get_invoice",
    ]);
    expect(TOOLS.every((t) => t.category === "read")).toBe(true);
    expect(TOOLS.every((t) => t.requiresRole === "agent")).toBe(true);
    expect(TOOLS.every((t) => t.requiresScope === "mcp:read")).toBe(true);
  });

  it("some quando o módulo não está instalado e aparece quando está ativo", () => {
    for (const tool of TOOLS) {
      expect(catalogEntry(tool.name)?.modulo).toBe("integracoes_erp");
      expect(deModuloDesligado(tool.name, [])).toBe(true);
      expect(deModuloDesligado(tool.name, ["integracoes_erp"])).toBe(false);
    }
  });
});
