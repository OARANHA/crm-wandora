import type pg from "pg";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobRow } from "../queue/queue";

const mocks = vi.hoisted(() => ({
  assertApprovedReplyPg: vi.fn(),
  assertApprovedReplyReceiptPg: vi.fn(),
  reconcileAcceptedSend: vi.fn(),
  withServiceJob: vi.fn(),
  deliverGovernedMessageToConversation: vi.fn(),
}));

vi.mock("@/lib/ai/replies/delivery", () => ({
  assertApprovedReplyPg: mocks.assertApprovedReplyPg,
  assertApprovedReplyReceiptPg: mocks.assertApprovedReplyReceiptPg,
}));

vi.mock("../edge/crm/send-ledger", () => ({
  reconcileAcceptedSend: mocks.reconcileAcceptedSend,
}));

vi.mock("@/lib/atendimento/fronteira-server", () => ({
  withServiceJob: mocks.withServiceJob,
}));

vi.mock("./governed-conversation-delivery", () => ({
  deliverGovernedMessageToConversation: mocks.deliverGovernedMessageToConversation,
}));

import { createApprovedReplyHandler } from "./approved-reply";

const org = "11111111-1111-4111-8111-111111111111";
const conversation = "22222222-2222-4222-8222-222222222222";
const contact = "33333333-3333-4333-8333-333333333333";
const session = "44444444-4444-4444-8444-444444444444";
const agent = "55555555-5555-4555-8555-555555555555";
const jobId = "66666666-6666-4666-8666-666666666666";

describe("approved_reply usa a entrega governada sem perder sua policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcileAcceptedSend.mockResolvedValue(false);
    mocks.withServiceJob.mockImplementation(async (_pool, _job, fn) => fn());
    mocks.assertApprovedReplyReceiptPg.mockResolvedValue({ current: true });
    mocks.assertApprovedReplyPg.mockResolvedValue({
      current: true,
      context_current: true,
      contact_id: contact,
      conversation_id: conversation,
      channel_session_id: session,
      draft_id: "77777777-7777-4777-8777-777777777777",
      body: "Resposta aprovada.",
      agent_id: agent,
    });
    mocks.deliverGovernedMessageToConversation.mockImplementation(async (_deps, input) => {
      await input.beforeDispatch?.();
      return {
        status: "sent",
        outcome: {
          kind: "sent",
          idempotencyKey: "ledger-1",
          messageId: "message-1",
        },
        trace: [],
      };
    });
  });

  it("passa conversa/contato/sessão aprovados como expectativas e revalida antes do dispatch", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as pg.Pool;
    const job = {
      id: jobId,
      kind: "approved_reply",
      organization_id: org,
      contact_id: contact,
      locked_by: "worker-1",
      claim_acquired_at: "2026-10-05T13:00:00.000Z",
    } as JobRow;

    const handler = createApprovedReplyHandler({
      crmCfg: {} as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      sleep: async () => undefined,
    });

    await handler(job, pool);

    expect(mocks.deliverGovernedMessageToConversation).toHaveBeenCalledTimes(1);
    expect(mocks.deliverGovernedMessageToConversation.mock.calls[0]![1]).toMatchObject({
      organizationId: org,
      conversationId: conversation,
      expectedContactId: contact,
      expectedChannelSessionId: session,
      jobId,
      agentId: agent,
      seq: 1,
      body: "Resposta aprovada.",
      approvedReply: {
        organizationId: org,
        jobId,
        jobClaim: {
          worker_id: "worker-1",
          acquired_at: "2026-10-05T13:00:00.000Z",
        },
      },
    });
    expect(mocks.assertApprovedReplyPg).toHaveBeenCalledTimes(2);
    expect(pool.query).toHaveBeenCalledWith(
      "select fn_reply_settle($1,$2,$3,$4,$5,$6)",
      [
        org,
        jobId,
        "worker-1",
        "2026-10-05T13:00:00.000Z",
        "sent",
        null,
      ],
    );
  });
});
