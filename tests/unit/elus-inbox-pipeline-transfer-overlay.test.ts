import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas de integração: importar a ação do Kanban não pode descartar o
 * overlay ERP do ELUS, esconder erros de leitura ou abrir escrita para viewer.
 */
describe("fatia upstream v1.84.0 — movimentação da Inbox com overlay ELUS", () => {
  const painel = readFileSync(join(process.cwd(), "components/inbox/CRMSidePanel.tsx"), "utf8");

  it("mantém DANFE do ELUS e painel de leitura fail-closed", () => {
    expect(painel).toContain('import { ErpDanfeCard }');
    expect(painel).toContain("<ErpDanfeCard");
    expect(painel).toContain("setErro(true)");
    expect(painel).toContain("setSummaryContactId(contactId)");
  });

  it("reusa o diálogo do Kanban e a mesma autorização do endpoint agent+", () => {
    expect(painel).toContain('from "@/components/kanban/MoveToOtherPipelineDialog"');
    expect(painel).toContain("roleAtLeast(activeOrg?.role, \"agent\")");
    expect(painel).toContain("!readonly &&");
    expect(painel).toContain('data-testid="inbox-levar-para-outro-funil"');
  });

  it("seleciona negócio novo somente após releitura da transferência", () => {
    expect(painel).toContain("procurarNovoNegocio.current = true");
    expect(painel).toContain("idsDeNegocioVistos.current = idsAgora");
    expect(painel).toContain("if (novo) setLeadAtivoId(novo.id)");
  });
});
