import type pg from "pg";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobRow } from "../queue/queue";

const mocks = vi.hoisted(() => ({
  deliver: vi.fn(),
}));

vi.mock("./governed-conversation-delivery", () => ({
  deliverGovernedMessageToConversation: mocks.deliver,
}));

import { StaleServiceBoundaryError } from "@/lib/atendimento/fronteira";
import { createGovernedDeliveryHandler } from "./governed-delivery";

const org = "11111111-1111-4111-8111-111111111111";
const contact = "22222222-2222-4222-8222-222222222222";
const conversation = "33333333-3333-4333-8333-333333333333";
const session = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";
const originJob = "66666666-6666-4666-8666-666666666666";
const originConversation = "77777777-7777-4777-8777-777777777777";
const actor = "88888888-8888-4888-8888-888888888888";

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: jobId,
    organization_id: org,
    contact_id: contact,
    kind: "governed_delivery",
    source_event_id: null,
    payload: {
      origin_job_id: originJob,
      origin_conversation_id: originConversation,
      actor_user_id: actor,
      operation: "erp_danfe_to_invoice_customer",
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
        mime: "application/pdf",
        kind: "document",
      },
    },
    status: "running",
    priority: 90,
    run_after: new Date(),
    attempts: 1,
    max_attempts: 5,
    last_error: null,
    locked_by: "worker-1",
    locked_at: new Date("2026-10-05T17:00:00Z"),
    claim_acquired_at: "2026-10-05T17:00:00.000Z",
    created_at: new Date(),
    ...overrides,
  };
}

describe("governed_delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deliver.mockResolvedValue({
      status: "sent",
      outcome: { kind: "sent", idempotencyKey: "ledger-1", messageId: "message-1" },
      trace: [],
    });
  });

  it("entrega somente para o destino persistido no job e preserva PDF/document", async () => {
    const handler = createGovernedDeliveryHandler({
      crmCfg: {} as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await handler(job(), {} as pg.Pool);

    expect(mocks.deliver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: org,
        conversationId: conversation,
        expectedContactId: contact,
        expectedChannelSessionId: session,
        jobId,
        seq: 1,
        media: {
          storagePath: `${org}/${conversation}/danfe.pdf`,
          mime: "application/pdf",
          kind: "document",
        },
      }),
    );
  });

  it("falha fechado se contact/job divergir da fronteira persistida", async () => {
    const handler = createGovernedDeliveryHandler({
      crmCfg: {} as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await expect(
      handler(
        job({ contact_id: "99999999-9999-4999-8999-999999999999" }),
        {} as pg.Pool,
      ),
    ).rejects.toBeInstanceOf(StaleServiceBoundaryError);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("veto do before_send é terminal e não é convertido em sucesso", async () => {
    mocks.deliver.mockResolvedValue({
      status: "vetoed",
      code: "opted_out",
      gate: "opt_out",
      trace: [],
    });
    const handler = createGovernedDeliveryHandler({
      crmCfg: {} as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(handler(job(), {} as pg.Pool)).rejects.toMatchObject({
      terminal: true,
      message: "governed_delivery_blocked:opted_out",
    });
  });

  it("outcome queued fica retryable; jobId+seq permanecem estáveis para o ledger", async () => {
    mocks.deliver.mockResolvedValue({
      status: "sent",
      outcome: { kind: "queued", reason: "session_down" },
      trace: [],
    });
    const handler = createGovernedDeliveryHandler({
      crmCfg: {} as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(handler(job(), {} as pg.Pool)).rejects.toThrow("governed_delivery_queued");
    expect(mocks.deliver.mock.calls[0]![1]).toMatchObject({ jobId, seq: 1 });
  });
});
