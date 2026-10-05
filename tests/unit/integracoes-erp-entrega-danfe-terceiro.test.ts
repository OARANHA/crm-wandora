import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { governedDeliveryPayloadSchema } from "@/lib/agent-engine/agent/governed-delivery";
import {
  conferirContatoComClienteErp,
  type IdentidadeContatoParaDocumento,
} from "@/lib/integracoes-erp/autoridade-documento";

const org = "11111111-1111-4111-8111-111111111111";
const contact = "22222222-2222-4222-8222-222222222222";
const conversation = "33333333-3333-4333-8333-333333333333";
const session = "44444444-4444-4444-8444-444444444444";
const originJob = "55555555-5555-4555-8555-555555555555";
const originConversation = "66666666-6666-4666-8666-666666666666";
const actor = "77777777-7777-4777-8777-777777777777";

function payload() {
  return {
    origin_job_id: originJob,
    origin_conversation_id: originConversation,
    actor_user_id: actor,
    operation: "erp_danfe_to_invoice_customer" as const,
    codigo_nfe: 64996397,
    conversation_id: conversation,
    expected_contact_id: contact,
    expected_channel_session_id: session,
    service_boundary: {
      organization_id: org,
      contact_id: contact,
      conversation_id: conversation,
      service_revision: 3,
      demanda_id: null,
      demanda_revision: null,
    },
    agent_id: "agent-test",
    body: "DANFE da NFe 64996397.",
    media: {
      storage_path: `${org}/${conversation}/danfe.pdf`,
      mime: "application/pdf" as const,
      kind: "document" as const,
    },
  };
}

describe("ERP → cliente → entrega governada", () => {
  it("contrato do job carrega destino interno, fronteira destino e PDF", () => {
    const parsed = governedDeliveryPayloadSchema.parse(payload());
    expect(parsed.conversation_id).toBe(conversation);
    expect(parsed.service_boundary.conversation_id).toBe(conversation);
    expect(parsed.media).toEqual({
      storage_path: `${org}/${conversation}/danfe.pdf`,
      mime: "application/pdf",
      kind: "document",
    });
  });

  it("identidade continua recusando divergência mesmo quando o nome coincide", () => {
    const contato: IdentidadeContatoParaDocumento = {
      id: contact,
      phone_number: "+5551999999999",
      email_normalized: "cliente@example.test",
      cpf_hash: null,
      is_anonymized: false,
    };
    expect(
      conferirContatoComClienteErp(contato, {
        id: "erp-1",
        nome: "Mesmo Nome",
        nomeFantasia: "Mesmo Nome",
        razaoSocial: null,
        cpfCnpj: null,
        email: "outra@example.test",
        telefone: null,
        celular: "+5551999999999",
        cidade: null,
        uf: null,
      }),
    ).toEqual({ ok: false, motivo: "identidade_nao_confere" });
  });

  it("consumer termina no seam governado e não chama WAHA diretamente", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/agent-engine/agent/governed-delivery.ts"),
      "utf8",
    );
    expect(source).toContain("deliverGovernedMessageToConversation");
    expect(source).not.toContain("sendMessageHandler(");
    expect(source).not.toContain("waha");
    expect(source).not.toContain("fetch(");
  });

  it("produtor não aceita telefone/nome como input da tool e materializa no destino", () => {
    const bridge = readFileSync(
      join(process.cwd(), "lib/agent-engine/edge/crm/mcp-tools.ts"),
      "utf8",
    );
    const composer = readFileSync(
      join(process.cwd(), "lib/integracoes-erp/entrega-danfe-terceiro.ts"),
      "utf8",
    );
    expect(bridge).toContain("crm_erp_send_danfe_to_invoice_customer");
    expect(bridge).toContain("codigo_nfe: z.number()");
    expect(bridge).not.toContain("crm_erp_send_danfe_to_invoice_customer: z.object({ phone");
    expect(composer).toContain("fn_service_boundary");
    expect(composer).toContain("conversationId: resolucao.destino.conversationId");
    expect(composer).toContain('filenamePrefix: "danfe-nfe"');
    expect(bridge).toContain("await guardServiceEffect()");
  });

  it("worker e fronteira reconhecem o job derivado", () => {
    const worker = readFileSync(join(process.cwd(), "workers/agent-worker/main.ts"), "utf8");
    const boundary = readFileSync(
      join(process.cwd(), "lib/atendimento/fronteira-server.ts"),
      "utf8",
    );
    expect(worker).toContain('handlers.set("governed_delivery"');
    expect(boundary).toContain('"governed_delivery"');
  });

  it("migration deduplica replay da mesma ordem/NFe", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20261005150000_0504_integracoes_erp_entrega_danfe_governada.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("uniq_job_queue_governed_delivery_origin_invoice");
    expect(sql).toContain("where kind='governed_delivery'");
    expect(sql).toContain("payload->>'origin_job_id'");
    expect(sql).toContain("payload->>'codigo_nfe'");
  });
});
