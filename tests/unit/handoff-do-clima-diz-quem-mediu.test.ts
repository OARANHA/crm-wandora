/**
 * O ELO DO MEIO DO D11: o alerta de clima repassa quem mediu, mas nunca
 * retira do atendimento uma autoridade ERP administrativa comprovada.
 *
 * As rotas de atendimento humano explícito continuam independentes do G2.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) c[m] = () => c;
      c.maybeSingle = async () => ({ data: null, error: null });
      return c;
    },
  }),
}));
vi.mock("@/lib/atendimento/origem-mensagem", () => ({
  serviceFromMessage: vi.fn(async () => ({ conversation_id: "conv-1", contact_id: null })),
}));
vi.mock("@/lib/ai/handoff/orchestrator", () => ({
  triggerHandoff: vi.fn(async () => ({ triggered: true, reason: "low_sentiment" })),
}));
vi.mock("@/lib/integracoes-erp/autoridade-admin-whatsapp", () => ({
  CAPACIDADE_ERP_ADMIN_READ: "erp.admin.read",
  resolverAutoridadeAdminWhatsapp: vi.fn(async () => null),
}));

import { serviceFromMessage } from "@/lib/atendimento/origem-mensagem";
import { triggerHandoff } from "@/lib/ai/handoff/orchestrator";
import { resolverAutoridadeAdminWhatsapp } from "@/lib/integracoes-erp/autoridade-admin-whatsapp";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { aiHandoffFromSentimentHandler } from "@/workers/ai-handoff-from-sentiment.handler";

const alerta = (conversationId = "conv-1") =>
  ({
    organization_id: "org-1",
    entity_id: "msg-1",
    payload: {
      message_id: "msg-1",
      conversation_id: conversationId,
      sentiment_score: 0.2525,
      sentiment_engine: "jev",
    },
  }) as unknown as EventRow;

describe("handler do alerta de clima", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(serviceFromMessage).mockResolvedValue({
      conversation_id: "conv-1",
      contact_id: null,
    } as never);
    vi.mocked(resolverAutoridadeAdminWhatsapp).mockResolvedValue(null);
  });

  it("repassa à passagem qual motor mediu para uma conversa comum", async () => {
    await aiHandoffFromSentimentHandler.handle(alerta());
    expect(vi.mocked(triggerHandoff).mock.calls[0]![0].metadata).toMatchObject({
      sentiment_score: 0.2525,
      sentiment_engine: "jev",
    });
  });

  it("não transfere a conversa de WhatsApp admin com vínculo e membership comprovados", async () => {
    vi.mocked(serviceFromMessage).mockResolvedValue({
      conversation_id: "conv-1",
      contact_id: "contact-admin",
    } as never);
    vi.mocked(resolverAutoridadeAdminWhatsapp).mockResolvedValue({
      kind: "whatsapp_admin",
      organizationId: "org-1",
      userId: "user-admin",
      contactId: "contact-admin",
      capability: "erp.admin.read",
    });

    const resposta = await aiHandoffFromSentimentHandler.handle(alerta());

    expect(resposta).toMatchObject({
      status: "skipped",
      detail: "erp_admin_whatsapp_no_sentiment_handoff",
    });
    expect(resolverAutoridadeAdminWhatsapp).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      "contact-admin",
    );
    expect(triggerHandoff).not.toHaveBeenCalled();
  });

  it("continua passando uma conversa comum: alegar ser admin não cria autoridade", async () => {
    vi.mocked(serviceFromMessage).mockResolvedValue({
      conversation_id: "conv-1",
      contact_id: "contact-unbound",
    } as never);

    await aiHandoffFromSentimentHandler.handle(alerta());

    expect(resolverAutoridadeAdminWhatsapp).toHaveBeenCalledOnce();
    expect(triggerHandoff).toHaveBeenCalledOnce();
  });

  it("mantém o G2 quando a checagem administrativa falha", async () => {
    vi.mocked(serviceFromMessage).mockResolvedValue({
      conversation_id: "conv-1",
      contact_id: "contact-unbound",
    } as never);
    vi.mocked(resolverAutoridadeAdminWhatsapp).mockRejectedValueOnce(
      new Error("leitura_indisponivel"),
    );

    await aiHandoffFromSentimentHandler.handle(alerta());

    expect(triggerHandoff).toHaveBeenCalledOnce();
  });

  it("não revalida autorização ou faz handoff quando a fronteira da conversa mudou", async () => {
    vi.mocked(serviceFromMessage).mockResolvedValue({
      conversation_id: "conv-antiga",
      contact_id: "contact-admin",
    } as never);

    const resposta = await aiHandoffFromSentimentHandler.handle(alerta());

    expect(resposta).toMatchObject({
      status: "skipped",
      detail: "service_boundary_stale",
    });
    expect(resolverAutoridadeAdminWhatsapp).not.toHaveBeenCalled();
    expect(triggerHandoff).not.toHaveBeenCalled();
  });
});
