import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { audit } from "@/lib/audit";
import {
  CAPACIDADE_ERP_ADMIN_READ,
  auditarConsultaAdminWhatsapp,
  decidirAutoridadeAdminWhatsapp,
  filtrarFerramentasErpPorAutoridadeAdminWhatsapp,
  normalizarTelefoneAdminWhatsapp,
  type AutoridadeAdminWhatsapp,
} from "@/lib/integracoes-erp/autoridade-admin-whatsapp";
import {
  crmErpGetInvoice,
  crmErpSearchCustomers,
  crmErpSearchOrders,
} from "@/lib/mcp/tools/integracoes-erp";

const org = "11111111-1111-4111-8111-111111111111";
const outroOrg = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const contactId = "44444444-4444-4444-8444-444444444444";
const telefone = "+5551999999999";

const contact = {
  id: contactId,
  organization_id: org,
  phone_number: telefone,
  is_anonymized: false,
  is_merged_into: null,
};
const binding = {
  id: "55555555-5555-4555-8555-555555555555",
  organization_id: org,
  user_id: user,
  phone_e164: telefone,
  capability: CAPACIDADE_ERP_ADMIN_READ,
  enabled: true,
};
const membership: {
  user_id: string;
  organization_id: string;
  role: string;
  revoked_at: string | null;
} = {
  user_id: user,
  organization_id: org,
  role: "admin",
  revoked_at: null,
};

function resolver(
  patch: {
    organizationId?: string;
    contact?: typeof contact | null;
    binding?: typeof binding | null;
    membership?: typeof membership | null;
  } = {},
) {
  return decidirAutoridadeAdminWhatsapp({
    organizationId: patch.organizationId ?? org,
    contact: patch.contact === undefined ? contact : patch.contact,
    binding: patch.binding === undefined ? binding : patch.binding,
    membership: patch.membership === undefined ? membership : patch.membership,
  });
}

describe("Admin WhatsApp Read-Only V1", () => {
  beforeEach(() => vi.mocked(audit).mockReset());

  it("normaliza celular BR e exige código de país explícito", () => {
    expect(normalizarTelefoneAdminWhatsapp("+55 (51) 99999-9999")).toBe(telefone);
    expect(normalizarTelefoneAdminWhatsapp("(51) 99999-9999")).toBeNull();
  });

  it("admin vinculado da mesma organização recebe autoridade sem identidade do cliente ERP", () => {
    expect(resolver()).toEqual({
      kind: "whatsapp_admin",
      organizationId: org,
      userId: user,
      contactId,
      capability: CAPACIDADE_ERP_ADMIN_READ,
    });
  });

  it("usuário comum, membership revogada, tenant cruzado e telefone não vinculado falham fechado", () => {
    expect(resolver({ membership: { ...membership, role: "agent" } })).toBeNull();
    expect(
      resolver({ membership: { ...membership, revoked_at: "2026-10-03T20:00:00Z" } }),
    ).toBeNull();
    expect(resolver({ organizationId: outroOrg })).toBeNull();
    expect(resolver({ binding: null })).toBeNull();
    expect(resolver({ contact: { ...contact, phone_number: "+5551988888888" } })).toBeNull();
  });

  it("as três consultas administrativas só aparecem com a autoridade correta", () => {
    const ids = [
      "crm_erp_search_products",
      "crm_erp_read_stock",
      "crm_erp_search_customers",
      "crm_erp_search_orders",
      "crm_erp_get_invoice",
    ];
    expect(filtrarFerramentasErpPorAutoridadeAdminWhatsapp(ids, null)).toEqual([
      "crm_erp_search_products",
      "crm_erp_read_stock",
    ]);
    expect(filtrarFerramentasErpPorAutoridadeAdminWhatsapp(ids, resolver())).toEqual(ids);
  });

  it("nenhuma capability administrativa deste V1 escreve no VendaERP", () => {
    expect([
      crmErpSearchCustomers.category,
      crmErpSearchOrders.category,
      crmErpGetInvoice.category,
    ]).toEqual(["read", "read", "read"]);
    expect([
      crmErpSearchCustomers.requiresScope,
      crmErpSearchOrders.requiresScope,
      crmErpGetInvoice.requiresScope,
    ]).toEqual(["mcp:read", "mcp:read", "mcp:read"]);
  });

  it("o fluxo cliente continua separado e não recebe bypass administrativo", () => {
    const cliente = readFileSync(
      join(process.cwd(), "lib/integracoes-erp/autoridade-documento.ts"),
      "utf8",
    );
    expect(cliente).toContain("export async function provarPedidoDoContato");
    expect(cliente).toContain("conferirContatoComClienteErp");
    expect(cliente).not.toContain("CAPACIDADE_ERP_ADMIN_READ");
    expect(cliente).not.toContain("isAdmin");
  });

  it("a auditoria administrativa usa o usuário Elus e não grava telefone, filtro ou DANFE", async () => {
    const autoridade = resolver() as AutoridadeAdminWhatsapp;
    await auditarConsultaAdminWhatsapp({
      autoridade,
      toolName: "crm_erp_get_invoice",
      requestId: "run-1",
      success: true,
    });

    expect(audit).toHaveBeenCalledWith({
      action: "integracao_erp.admin_consulta",
      actorUserId: user,
      organizationId: org,
      resourceType: "erp_invoice",
      requestId: "run-1",
      metadata: {
        channel: "whatsapp",
        origem: "agent_inbound_turn",
        capability: CAPACIDADE_ERP_ADMIN_READ,
        tool: "crm_erp_get_invoice",
        success: true,
      },
    });
    const serializado = JSON.stringify(vi.mocked(audit).mock.calls[0]);
    expect(serializado).not.toContain(telefone);
    expect(serializado).not.toContain("danfeUrl");
    expect(serializado).not.toContain("authorization");
  });

  it("a auditoria aceita diagnóstico técnico sanitizado sem URL ou credencial", async () => {
    const autoridade = resolver() as AutoridadeAdminWhatsapp;
    await auditarConsultaAdminWhatsapp({
      autoridade,
      toolName: "crm_erp_prepare_admin_danfe",
      requestId: "run-danfe",
      success: false,
      motivo: "danfe_download_failed",
      codigoTecnico: "http_invalido",
      statusHttp: 403,
      autenticacaoSameOrigin: true,
    });

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "run-danfe",
        metadata: expect.objectContaining({
          motivo: "danfe_download_failed",
          codigo_tecnico: "http_invalido",
          status_http: 403,
          autenticacao_same_origin: true,
        }),
      }),
    );

    const serializado = JSON.stringify(vi.mocked(audit).mock.calls[0]);
    expect(serializado).not.toContain("http://");
    expect(serializado).not.toContain("https://");
    expect(serializado).not.toContain(telefone);
  });

  it("o bridge administrativo só cria a tool de DANFE para autoridade real e fora de preview", () => {
    const bridge = readFileSync(
      join(process.cwd(), "lib/agent-engine/edge/crm/mcp-tools.ts"),
      "utf8",
    );
    expect(bridge).toContain("autoridadeAdminWhatsapp &&");
    expect(bridge).toContain("ids.conversationId &&");
    expect(bridge).toContain('allowed.includes("crm_erp_get_invoice")');
    expect(bridge).toContain("options?.readOnly !== true");
    expect(bridge).toContain("crm_erp_prepare_admin_danfe");
    expect(bridge).toContain(
      "quando o administrador pedir para mandar, enviar, ver, baixar, obter ou receber uma DANFE",
    );
    expect(bridge).toContain("chame esta ferramenta ANTES de qualquer send_message");
    expect(bridge).toContain("use esse número em codigo_nfe");
    expect(bridge).toContain("Não diga que não consegue");
    expect(bridge).toContain("o runtime anexará o PDF automaticamente como documento");
    expect(bridge).toContain("Não copie nem envie preview_url");
    expect(bridge).toContain("onAdminDocumentPrepared");
    expect(bridge).toContain("storage_path: _interno");
  });

  it("o DANFE preparado entra no send_message canônico como documento sem expor storage_path ao modelo", () => {
    const turno = readFileSync(
      join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
      "utf8",
    );
    const sender = readFileSync(
      join(process.cwd(), "lib/agent-engine/edge/crm/send-message.ts"),
      "utf8",
    );

    expect(turno).toContain("let documentoAdminPreparado");
    expect(turno).toContain("onAdminDocumentPrepared: (documento)");
    expect(turno).toContain("kind: 'document'");
    expect(turno).toContain("return enviar(finalBody");
    expect(sender).toContain('kind?: "image" | "document"');
    expect(sender).toContain("type: (input.media.kind ?? 'image')");
  });

  it("pedido/NFe apresentados ao modelo não expõem a URL externa do DANFE", () => {
    const tools = readFileSync(join(process.cwd(), "lib/mcp/tools/integracoes-erp.ts"), "utf8");
    expect(tools).toContain("danfeDisponivel: Boolean(pedido.danfeUrl)");
    expect(tools).toContain("danfeDisponivel: Boolean(nota.danfeUrl)");
    expect(tools).not.toContain("return saida.erro ? saida : { nota: saida.dados }");
    expect(tools).not.toContain("return saida.erro ? saida : { pedidos: saida.dados }");
  });

  it("a migration aceita E.164 com + literal sem depender de escape de regex SQL", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261003231500_0503_integracoes_erp_admin_whatsapp_readonly.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("phone_e164 ~ '^[+][1-9][0-9]{7,14}$'");
    expect(sql).not.toContain("phone_e164 ~ '^\\\\+");
  });
});
