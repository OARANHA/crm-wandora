import type pg from "pg";

import { beforeEach, describe, expect, it, vi } from "vitest";

const runBeforeSendMock = vi.fn();

vi.mock("../guardrails/before-send", () => ({
  runBeforeSend: (...args: unknown[]) => runBeforeSendMock(...args),
}));

import { StaleServiceBoundaryError } from "@/lib/atendimento/fronteira";
import {
  carregarDestinoGovernadoDaConversa,
  deliverGovernedMessageToConversation,
} from "./governed-conversation-delivery";

const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const conversation = "33333333-3333-4333-8333-333333333333";
const otherConversation = "44444444-4444-4444-8444-444444444444";
const contact = "55555555-5555-4555-8555-555555555555";
const session = "66666666-6666-4666-8666-666666666666";
const job = "77777777-7777-4777-8777-777777777777";
const agent = "88888888-8888-4888-8888-888888888888";

function poolWithTarget() {
  return {
    query: vi.fn(async (_sql: string, params: unknown[]) => {
      if (params[0] !== org || params[1] !== conversation) return { rows: [] };
      return {
        rows: [
          {
            conversation_id: conversation,
            contact_id: contact,
            channel_session_id: session,
            source: "whatsapp",
            consent: {
              marketing: { granted_at: "2026-10-05T12:00:00Z" },
            },
            is_anonymized: false,
            daily_message_limit: 123,
          },
        ],
      };
    }),
  } as unknown as pg.Pool;
}

describe("Governed Cross-Conversation Delivery Seam V1", () => {
  beforeEach(() => {
    runBeforeSendMock.mockReset();
  });

  it("reidrata conversa, contato e sessão somente dentro da organização informada", async () => {
    const pool = poolWithTarget();

    await expect(
      carregarDestinoGovernadoDaConversa(pool, org, conversation, contact, session),
    ).resolves.toMatchObject({
      conversationId: conversation,
      contactId: contact,
      channelSessionId: session,
      dailyMessageLimit: 123,
    });

    await expect(
      carregarDestinoGovernadoDaConversa(pool, otherOrg, conversation),
    ).rejects.toBeInstanceOf(StaleServiceBoundaryError);
  });

  it("falha fechado para conversa inexistente, contato ou sessão inconsistentes", async () => {
    const pool = poolWithTarget();

    await expect(
      carregarDestinoGovernadoDaConversa(pool, org, otherConversation),
    ).rejects.toBeInstanceOf(StaleServiceBoundaryError);
    await expect(
      carregarDestinoGovernadoDaConversa(
        pool,
        org,
        conversation,
        "99999999-9999-4999-8999-999999999999",
      ),
    ).rejects.toBeInstanceOf(StaleServiceBoundaryError);
    await expect(
      carregarDestinoGovernadoDaConversa(
        pool,
        org,
        conversation,
        contact,
        "99999999-9999-4999-8999-999999999999",
      ),
    ).rejects.toBeInstanceOf(StaleServiceBoundaryError);
  });

  it("before_send e sender recebem exclusivamente o contexto reidratado do destino", async () => {
    const pool = poolWithTarget();
    const send = vi.fn(async () => ({
      kind: "sent" as const,
      idempotencyKey: "ledger-1",
      messageId: "message-1",
    }));

    runBeforeSendMock.mockImplementation(async (args) => {
      const outcome = await args.send(args.body);
      return { status: "sent", outcome, trace: [] };
    });

    await deliverGovernedMessageToConversation(
      {
        pool,
        crmCfg: {} as never,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        channel: { send },
        now: new Date("2026-10-05T12:30:00Z"),
      },
      {
        organizationId: org,
        conversationId: conversation,
        expectedContactId: contact,
        expectedChannelSessionId: session,
        jobId: job,
        agentId: agent,
        body: "Documento solicitado.",
      },
    );

    expect(runBeforeSendMock).toHaveBeenCalledTimes(1);
    const beforeSend = runBeforeSendMock.mock.calls[0]![0];
    expect(beforeSend).toMatchObject({
      tenantId: org,
      leadId: contact,
      channelSessionId: session,
      crmDailyLimit: 123,
      body: "Documento solicitado.",
      lgpd: {
        isAnonymized: false,
        isProspecting: false,
        legalBasis: {
          basis: "consent",
          consentGranted: true,
          dataOrigin: "whatsapp",
        },
      },
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: org,
        leadId: contact,
        conversationId: conversation,
        jobId: job,
        seq: 1,
        body: "Documento solicitado.",
      }),
    );
  });

  it("preserva documento PDF e exige ownership no path da conversa destino", async () => {
    const pool = poolWithTarget();
    const send = vi.fn(async () => ({
      kind: "sent" as const,
      idempotencyKey: "ledger-2",
      messageId: "message-2",
    }));
    runBeforeSendMock.mockImplementation(async (args) => ({
      status: "sent",
      outcome: await args.send(args.body),
      trace: [],
    }));

    const media = {
      storagePath: `${org}/${conversation}/danfe-nfe-1.pdf`,
      mime: "application/pdf",
      kind: "document" as const,
    };

    await deliverGovernedMessageToConversation(
      {
        pool,
        crmCfg: {} as never,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        channel: { send },
      },
      {
        organizationId: org,
        conversationId: conversation,
        jobId: job,
        agentId: agent,
        body: "Segue a DANFE.",
        media,
      },
    );

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: conversation,
        media,
      }),
    );

    await expect(
      deliverGovernedMessageToConversation(
        {
          pool,
          crmCfg: {} as never,
          log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
          channel: { send },
        },
        {
          organizationId: org,
          conversationId: conversation,
          jobId: job,
          agentId: agent,
          body: "Não deve sair.",
          media: {
            storagePath: `${org}/${otherConversation}/danfe-nfe-1.pdf`,
            mime: "application/pdf",
            kind: "document",
          },
        },
      ),
    ).rejects.toBeInstanceOf(StaleServiceBoundaryError);
  });
});
