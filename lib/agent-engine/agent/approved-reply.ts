import type pg from "pg";
import type { JobRow } from "../queue/queue";
import { claimOfJob } from "../queue/claim";
import { reconcileAcceptedSend } from "../edge/crm/send-ledger";
import type { RuntimeSendChannel } from "@/lib/channels/runtime";
import { assertApprovedReplyPg, assertApprovedReplyReceiptPg } from "@/lib/ai/replies/delivery";
import { StaleServiceBoundaryError } from "@/lib/atendimento/fronteira";
import { withServiceJob } from "@/lib/atendimento/fronteira-server";
import type { InboundTurnDeps } from "./inbound-turn";
import { deliverGovernedMessageToConversation } from "./governed-conversation-delivery";
export function createApprovedReplyHandler(
  deps: Pick<InboundTurnDeps, "crmCfg" | "log" | "sleep"> & {
    channel?: (pool: pg.Pool) => RuntimeSendChannel;
  },
) {
  return async (job: JobRow, pool: pg.Pool) => {
    const claim = claimOfJob(job);
    if (!claim || job.kind !== "approved_reply" || !job.contact_id)
      throw new StaleServiceBoundaryError();
    const context = { organizationId: job.organization_id, jobId: job.id, jobClaim: claim };
    const settle = async (state: string, error?: string) => {
      await pool.query("select fn_reply_settle($1,$2,$3,$4,$5,$6)", [
        job.organization_id,
        job.id,
        claim.worker_id,
        claim.acquired_at,
        state,
        error ?? null,
      ]);
    };
    let accepted = false;
    try {
      await assertApprovedReplyReceiptPg(pool, context);
      if (
        await reconcileAcceptedSend(pool, { tenantId: job.organization_id, jobId: job.id, seq: 1 })
      ) {
        accepted = true;
        await settle("sent");
        return;
      }
      await withServiceJob(pool, job, async () => {
        const policy = await assertApprovedReplyPg(pool, context);
        if (policy.contact_id !== job.contact_id) throw new StaleServiceBoundaryError();
        const result = await deliverGovernedMessageToConversation(
          {
            pool,
            crmCfg: deps.crmCfg,
            log: deps.log,
            sleep: deps.sleep,
            ...(deps.channel ? { channel: deps.channel(pool) } : {}),
          },
          {
            organizationId: job.organization_id,
            conversationId: policy.conversation_id,
            expectedContactId: job.contact_id,
            expectedChannelSessionId: policy.channel_session_id,
            jobId: job.id,
            jobClaim: claim,
            agentId: policy.agent_id,
            seq: 1,
            body: policy.body,
            approvedReply: context,
            beforeDispatch: async () => {
              await assertApprovedReplyPg(pool, context);
            },
          },
        );
        if (result.status === "vetoed") {
          await settle(result.nextAllowedAt ? "queued" : "failed", result.code);
          return;
        }
        // The receipt transaction may commit before its HTTP response is lost.
        // Reconcile that acceptance before retrying an unavailable transport.
        if (result.outcome.kind === "unavailable") {
          await assertApprovedReplyReceiptPg(pool, context);
          if (
            await reconcileAcceptedSend(pool, {
              tenantId: job.organization_id,
              jobId: job.id,
              seq: 1,
            })
          ) {
            accepted = true;
            await settle("sent");
            return;
          }
        }
        switch (result.outcome.kind) {
          case "sent":
          case "already_sent":
            accepted = true;
            await settle("sent");
            break;
          case "queued":
            await settle("queued", "channel_unavailable");
            break;
          case "blocked":
            await settle("failed", "blocked");
            break;
          default:
            await settle("retry", "send_failed");
        }
      });
    } catch (error) {
      // Persistence trouble after acceptance must leave the same job recoverable.
      // A later acquisition reconciles its ledger; it must not become a new send.
      if (accepted) throw error;
      if (
        await reconcileAcceptedSend(pool, { tenantId: job.organization_id, jobId: job.id, seq: 1 })
      ) {
        await settle("sent");
        return;
      }
      await settle(
        error instanceof StaleServiceBoundaryError ? "stale" : "failed",
        error instanceof StaleServiceBoundaryError
          ? "context_changed"
          : error instanceof Error && error.message === "reply_body_changed_reapproval_required"
            ? "body_changed"
            : "delivery_failed",
      );
    }
  };
}
