import { z } from "zod";
import type pg from "pg";

import { StaleServiceBoundaryError } from "@/lib/atendimento/fronteira";
import { claimOfJob } from "@/lib/agent-engine/queue/claim";
import type { JobRow } from "@/lib/agent-engine/queue/queue";

import type { FollowupTurnDeps } from "./followup-turn";
import { deliverGovernedMessageToConversation } from "./governed-conversation-delivery";

const serviceBoundarySchema = z.object({
  organization_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  service_revision: z.number().int().positive(),
  demanda_id: z.string().uuid().nullable(),
  demanda_revision: z.number().int().positive().nullable(),
}).strict();

export const governedDeliveryPayloadSchema = z.object({
  origin_job_id: z.string().uuid(),
  origin_conversation_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  operation: z.literal("erp_danfe_to_invoice_customer"),
  codigo_nfe: z.number().int().positive(),
  conversation_id: z.string().uuid(),
  expected_contact_id: z.string().uuid(),
  expected_channel_session_id: z.string().uuid(),
  service_boundary: serviceBoundarySchema,
  agent_id: z.string().min(1).max(200),
  body: z.string().min(1).max(4096),
  media: z.object({
    storage_path: z.string().min(1).max(500),
    mime: z.literal("application/pdf"),
    kind: z.literal("document"),
  }).strict(),
}).strict();

class GovernedDeliveryBlockedError extends Error {
  readonly terminal = true;
  constructor(code: string) {
    super(`governed_delivery_blocked:${code}`);
    this.name = "GovernedDeliveryBlockedError";
  }
}

/**
 * Consome uma entrega já autorizada e resolvida para uma conversa.
 * ERP/identidade ficam no produtor do job; este consumer só governa o destino.
 */
export function createGovernedDeliveryHandler(deps: Pick<FollowupTurnDeps, "crmCfg" | "log">) {
  return async (job: JobRow, pool: pg.Pool): Promise<void> => {
    if (job.kind !== "governed_delivery" || !job.contact_id) {
      throw new StaleServiceBoundaryError();
    }
    const claim = claimOfJob(job);
    if (!claim) throw new StaleServiceBoundaryError();

    const payload = governedDeliveryPayloadSchema.parse(job.payload);
    if (
      payload.expected_contact_id !== job.contact_id ||
      payload.service_boundary.organization_id !== job.organization_id ||
      payload.service_boundary.contact_id !== job.contact_id ||
      payload.service_boundary.conversation_id !== payload.conversation_id
    ) {
      throw new StaleServiceBoundaryError();
    }

    const result = await deliverGovernedMessageToConversation(
      { pool, crmCfg: deps.crmCfg, log: deps.log },
      {
        organizationId: job.organization_id,
        conversationId: payload.conversation_id,
        expectedContactId: payload.expected_contact_id,
        expectedChannelSessionId: payload.expected_channel_session_id,
        jobId: job.id,
        jobClaim: claim,
        agentId: payload.agent_id,
        seq: 1,
        body: payload.body,
        media: {
          storagePath: payload.media.storage_path,
          mime: payload.media.mime,
          kind: payload.media.kind,
        },
      },
    );

    if (result.status === "vetoed") throw new GovernedDeliveryBlockedError(result.code);
    if (result.outcome.kind === "queued") throw new Error("governed_delivery_queued");
  };
}
