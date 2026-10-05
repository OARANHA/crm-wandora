import type pg from "pg";

import type { ApprovedReplyContext } from "@/lib/ai/replies/delivery";
import { StaleServiceBoundaryError } from "@/lib/atendimento/fronteira";
import { isMediaPathOwnedBy } from "@/lib/messaging/media/upload-validation";
import { createRuntimeSendChannel, type RuntimeSendChannel } from "@/lib/channels/runtime";

import type { JobClaim } from "../queue/claim";
import type { Logger } from "../obs/logger";
import type { CrmEdgeConfig } from "../edge/crm/mcp-client";
import { runBeforeSend } from "../guardrails/before-send";
import { deriveLgpdFromContact, type LgpdContactFields } from "../guardrails/lgpd/legal-basis";

export interface GovernedConversationDestination extends LgpdContactFields {
  conversationId: string;
  contactId: string;
  channelSessionId: string;
  dailyMessageLimit: number | null;
}

export interface GovernedConversationMedia {
  storagePath: string;
  mime: string;
  kind?: "image" | "document";
}

interface DeliveryInput {
  organizationId: string;
  conversationId: string;
  expectedContactId?: string;
  jobId: string;
  jobClaim?: JobClaim;
  agentId: string;
  seq?: number;
  body: string;
  media?: GovernedConversationMedia;
  approvedReply?: ApprovedReplyContext;
  beforeDispatch?: () => Promise<void>;
}

interface DeliveryDeps {
  pool: pg.Pool;
  crmCfg: CrmEdgeConfig;
  log: Logger;
  sleep?: (ms: number) => Promise<void>;
  channel?: RuntimeSendChannel;
  now?: Date;
}

/**
 * Reidrata o contexto verdadeiro de uma conversa destino.
 *
 * O chamador fornece apenas IDs internos. Contato, sessão, limites e contexto
 * LGPD vêm do banco da própria organização; nenhum dado de autoridade do modelo
 * é aceito aqui. A consulta falha fechado para conversa inexistente, tenant
 * divergente ou contato esperado inconsistente.
 */
export async function carregarDestinoGovernadoDaConversa(
  pool: pg.Pool,
  organizationId: string,
  conversationId: string,
  expectedContactId?: string,
): Promise<GovernedConversationDestination> {
  const { rows } = await pool.query<
    LgpdContactFields & {
      conversation_id: string;
      contact_id: string;
      channel_session_id: string;
      daily_message_limit: number | null;
    }
  >(
    `select
       cv.id as conversation_id,
       cv.contact_id,
       cv.channel_session_id,
       c.source,
       c.consent,
       c.is_anonymized,
       s.daily_message_limit
     from conversations cv
     join contacts c
       on c.organization_id = cv.organization_id
      and c.id = cv.contact_id
     join channel_sessions s
       on s.organization_id = cv.organization_id
      and s.id = cv.channel_session_id
     where cv.organization_id = $1
       and cv.id = $2
     limit 1`,
    [organizationId, conversationId],
  );
  const row = rows[0];
  if (!row) throw new StaleServiceBoundaryError();
  if (expectedContactId && row.contact_id !== expectedContactId) {
    throw new StaleServiceBoundaryError();
  }
  return {
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    channelSessionId: row.channel_session_id,
    dailyMessageLimit: row.daily_message_limit,
    source: row.source,
    consent: row.consent,
    is_anonymized: row.is_anonymized,
  };
}

/**
 * Entrega uma mensagem para uma conversa explicitamente escolhida usando o
 * contexto reidratado DO DESTINO.
 *
 * Esta função não resolve destinatário e não autoriza quem ordena a ação. Essas
 * responsabilidades pertencem ao chamador. Aqui ficam os guardrails do destino:
 * same-tenant, contato/sessão reais, LGPD, opt-out/pacing via before_send, media
 * ownership e o RuntimeSendChannel canônico (send_ledger + sendMessageHandler).
 */
export async function deliverGovernedMessageToConversation(
  deps: DeliveryDeps,
  input: DeliveryInput,
) {
  const destino = await carregarDestinoGovernadoDaConversa(
    deps.pool,
    input.organizationId,
    input.conversationId,
    input.expectedContactId,
  );

  if (
    input.media &&
    !isMediaPathOwnedBy(input.media.storagePath, input.organizationId, destino.conversationId)
  ) {
    throw new StaleServiceBoundaryError();
  }

  const channel =
    deps.channel ??
    createRuntimeSendChannel(deps.pool, { ...deps.crmCfg, agentActorId: input.agentId });

  return runBeforeSend({
    pool: deps.pool,
    log: deps.log,
    tenantId: input.organizationId,
    leadId: destino.contactId,
    jobId: input.jobId,
    agentId: input.agentId,
    ...(input.approvedReply ? { approvedReply: input.approvedReply } : {}),
    channelSessionId: destino.channelSessionId,
    body: input.body,
    optedOutThisTurn: false,
    crmDailyLimit: destino.dailyMessageLimit,
    now: deps.now ?? new Date(),
    lgpd: deriveLgpdFromContact(destino, false),
    sleep: deps.sleep,
    send: async (body) => {
      await input.beforeDispatch?.();
      return channel.send({
        tenantId: input.organizationId,
        leadId: destino.contactId,
        jobId: input.jobId,
        ...(input.jobClaim ? { jobClaim: input.jobClaim } : {}),
        seq: input.seq ?? 1,
        conversationId: destino.conversationId,
        body,
        ...(input.media ? { media: input.media } : {}),
      });
    },
  });
}
