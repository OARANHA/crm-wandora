import { currentExecutionBoundary, currentExecutionJob } from '@/lib/atendimento/fronteira-server';
import { claimOfJob } from '@/lib/agent-engine/queue/claim';
/**
 * Tools MCP habilitadas NA TELA entrando no turno do engine (Fase 2B-tools).
 *
 * Reusa a MESMA ponte in-process do runtime nativo (lib/ai/runtime/tools:
 * pickToolsFromMcp) — audit em api_audit_log, ensureRole/ensureScope e redação
 * de PII idênticos. O actor do audit é o ai_agents.id do agente publicado, com
 * token efêmero mintado pelo padrão do repo (TTL curto, revogado no fim do turno).
 *
 * FILTRO DE SEGURANÇA (inegociável, não é knob):
 *   - crm_send_whatsapp_message NUNCA entra: enviar é SEMPRE a tool send_message
 *     do engine, atrás da cadeia runBeforeSend (CLAUDE.md princípio 2) — uma tool
 *     de envio por fora furaria anti-ban/opt-out/disclosure inteiros;
 *   - crm_request_human_handoff NUNCA entra (e a auto-injeção da ponte fica
 *     desligada): o engine tem a própria request_human_handoff com silêncio
 *     durável + cancelamento de follow-ups — duas tools de handoff confundiriam
 *     o modelo e a variante do CRM não silencia o harness.
 */
import { tool, type Tool } from 'ai';
import { z } from 'zod';

import { pickToolsFromMcp, type RuntimeHandoffSignal } from '@/lib/ai/runtime/tools';
import { mintEphemeralToken, revokeEphemeralToken } from '@/lib/ai/runtime/mcp_token';
import { IDS_DO_HARNESS, motivoDoHarness } from '@/lib/mcp/tools/ferramentas-do-harness';
import type { McpAuthResult } from '@/lib/mcp/auth';
import type { McpContext } from '@/lib/mcp/types';
import { modulosLigados } from '@/lib/instalacao/modulos';
import { capacidadesDaOrganizacao } from '@/lib/organizacao/capacidades';
import { filtrarToolsComCallbackDesabilitado } from '@/lib/followup/callback-policy';
import {
  filtrarFerramentasErpPorAutoridadeAdminWhatsapp,
  prepararDanfeAdminWhatsapp,
  resolverAutoridadeAdminWhatsapp,
} from '@/lib/integracoes-erp/autoridade-admin-whatsapp';
import { solicitarEntregaDanfeAoClienteDaNota } from '@/lib/integracoes-erp/entrega-danfe-terceiro';

import type { Logger } from '../../obs/logger';
import type { CrmEdgeConfig } from './mcp-client';
import type { PublishedAgentConfig } from '../../agent/agent-config';

/**
 * Tools do catálogo que jamais entram num turno do engine (ver doc acima).
 *
 * A lista VIVE em `lib/mcp/tools/ferramentas-do-harness.ts` — com o motivo de
 * cada uma escrito para a tela — e é reexportada aqui porque este é o lado que
 * recusa. Enquanto ela existiu só aqui, o dono marcava `crm_send_whatsapp_message`
 * no pacote "Atender e responder" e o turno descartava sem que a tela soubesse.
 *
 * Exportado para ser ASSERÍVEL: a garantia de que o papel Operador não tem canal
 * (spec 16 §3.2) depende desta lista, e uma garantia que nenhum teste consegue
 * ler é uma garantia que ninguém percebe quando some.
 */
export const BLOCKED_TOOL_IDS: ReadonlySet<string> = IDS_DO_HARNESS;

export interface McpTurnTools {
  tools: Record<string, Tool>;
  /** ids efetivamente montados (para o log do turno — auditável). */
  toolIds: string[];
  /** revoga o token efêmero — chamar no fim do turno (caminho feliz). */
  cleanup: () => Promise<void>;
}

export async function buildMcpTurnTools(
  cfg: CrmEdgeConfig,
  /** `contactId`: o contato do turno — ver `contatoDoTurno` em `lib/ai/runtime/tools.ts`. */
  ids: {
    organizationId: string;
    jobId: string;
    contactId?: string;
    conversationId?: string;
  },
  agentConfig: PublishedAgentConfig,
  log: Logger,
  options?: {
    readOnly?: boolean;
    onAdminDocumentPrepared?: (documento: {
      storagePath: string;
      mime: string;
      filename: string;
    }) => void;
  },
): Promise<McpTurnTools | null> {
  const callbackFiltered = filtrarToolsComCallbackDesabilitado(
    agentConfig.toolIds,
    agentConfig.followup,
  );
  const allowedBeforeAdminGate = callbackFiltered.filter((id) => !BLOCKED_TOOL_IDS.has(id));
  const blocked = agentConfig.toolIds.filter((id) => BLOCKED_TOOL_IDS.has(id));
  if (blocked.length > 0) {
    // A tela não oferece mais estas capacidades (a rota serve `marcavel: false`
    // com o motivo), então chegar aqui significa versão de agente PUBLICADA
    // antes da correção, ou configuração escrita por fora da tela. O log deixou
    // de ser o ÚNICO sinal — a tela mostra o porquê — mas o turno continua
    // recusando em silêncio para o modelo, de propósito.
    log.warn('tools MCP bloqueadas no turno do engine (envio/handoff são do harness)', {
      blocked_tool_ids: blocked,
      motivos: blocked.map((id) => motivoDoHarness(id)),
    });
  }
  const autoridadeAdminWhatsapp = ids.contactId
    ? await resolverAutoridadeAdminWhatsapp(cfg.supabase, ids.organizationId, ids.contactId)
    : null;
  const allowed = filtrarFerramentasErpPorAutoridadeAdminWhatsapp(
    allowedBeforeAdminGate,
    autoridadeAdminWhatsapp,
  );
  const removidasPeloAdminGate = allowedBeforeAdminGate.filter((id) => !allowed.includes(id));
  if (removidasPeloAdminGate.length > 0) {
    log.info('tools ERP administrativas fora do turno sem autoridade WhatsApp admin', {
      tool_ids: removidasPeloAdminGate,
    });
  }
  if (allowed.length === 0) {
    return null;
  }

  const ephemeral = await mintEphemeralToken({
    organizationId: ids.organizationId,
    runId: ids.jobId,
    readOnly: options?.readOnly,
    versionCreatedBy: agentConfig.versionCreatedBy ?? undefined,
    agentCreatedBy: agentConfig.agentCreatedBy ?? undefined,
  });

  const originJob = currentExecutionJob();
  const boundary = currentExecutionBoundary();
  const claim = originJob ? claimOfJob(originJob) : undefined;
  const ctx: McpContext = {
    sourceJobId: ids.jobId,
    ...(originJob?.id === ids.jobId && boundary && claim
      ? { meetingBooking: { sourceJobId: originJob.id, claim, boundary } }
      : {}),
    organizationId: ids.organizationId,
    role: 'ai_operator',
    // `agent_id` explícito porque é ele que vai para colunas com FK (atividade
    // da timeline); `id` continua sendo a identidade de correlação do audit.
    actor: {
      type: 'ai_agent',
      id: agentConfig.agentId,
      agent_id: agentConfig.agentId,
      role: 'ai_operator',
      api_token_id: ephemeral.id,
    },
    apiTokenId: ephemeral.id,
    requestId: ids.jobId,
    supabase: cfg.supabase,
  };
  const auth: McpAuthResult = {
    organizationId: ids.organizationId,
    role: 'ai_operator',
    actor: ctx.actor,
    apiTokenId: ephemeral.id,
    scopes: options?.readOnly
      ? ['mcp:read', 'actor:ai_agent']
      : ['mcp:read', 'mcp:write', 'actor:ai_agent'],
  };
  // O engine não usa o sinal de handoff da ponte (a tool está bloqueada) — dummy.
  const handoffSignal: RuntimeHandoffSignal = { triggered: false };

  const tools = pickToolsFromMcp({
    supabase: cfg.supabase,
    ctx,
    auth,
    toolIds: allowed,
    handoffToolEnabled: false,
    proposalAiDraftEnabled: agentConfig.proposalAiDraftEnabled,
    handoffSignal,
    // "Em que negócios ele pode mexer" — o campo é OPCIONAL na interface, e
    // omiti-lo não é neutro: `escopo ?? []` e vazio significa NENHUM. Este
    // turno, que é o de produção, montava as capacidades de CRM sem escopo, e
    // por isso TODA escrita de lead era recusada — com a capacidade ligada na
    // tela e o card parado. Quem passava era só o dispatcher antigo.
    pipelineIds: agentConfig.pipelineIds,
    modulosLigados: await modulosLigados(cfg.supabase),
    capacidadesLigadas: await capacidadesDaOrganizacao(cfg.supabase, ids.organizationId),
    ...(ids.contactId ? { contatoDoTurno: ids.contactId } : {}),
    ...(autoridadeAdminWhatsapp ? { autoridadeAdminWhatsapp } : {}),
  });

  if (
    options?.readOnly !== true &&
    autoridadeAdminWhatsapp &&
    ids.conversationId &&
    allowed.includes("crm_erp_get_invoice")
  ) {
    tools.crm_erp_prepare_admin_danfe = tool({
      description:
        "Prepara uma DANFE já emitida para ESTA conversa administrativa. " +
        "Use quando o administrador quiser ver, baixar, obter ou receber a DANFE no próprio WhatsApp. " +
        "Se ele pedir para enviar ao cliente vinculado à nota, use crm_erp_send_danfe_to_invoice_customer em vez desta ferramenta. " +
        "REGRA DE USO: quando o administrador pedir a DANFE para si e informar o número da NFe/NFCe, chame esta ferramenta ANTES de qualquer send_message ou resposta textual; use esse número em codigo_nfe. " +
        "Não diga que não consegue e não responda apenas em texto antes de tentar esta ferramenta. " +
        "Depois de preparar com sucesso, chame send_message UMA vez com a legenda curta: o runtime anexará o PDF automaticamente como documento. " +
        "Não copie nem envie preview_url ao administrador. Nunca use esta capacidade em conversa comum de cliente.",
      inputSchema: z.object({
        codigo_nfe: z.number().int().min(1).max(2_147_483_647),
      }),
      execute: async ({ codigo_nfe }) => {
        const preparado = await prepararDanfeAdminWhatsapp(
          cfg.supabase,
          autoridadeAdminWhatsapp,
          ids.conversationId!,
          codigo_nfe,
          ids.jobId,
        );
        if (!preparado.ok) return preparado;

        options?.onAdminDocumentPrepared?.({
          storagePath: preparado.documento.storage_path,
          mime: preparado.documento.media_mime,
          filename: preparado.documento.filename,
        });

        const { storage_path: _interno, ...documentoPublico } = preparado.documento;
        return { ok: true, documento: documentoPublico };
      },
    });
  }

  return {
    tools,
    toolIds: Object.keys(tools),
    // ponytail: revoke só no caminho feliz — em crash do turno o token expira
    // pelo TTL curto do mint (mesmo tradeoff aceito pelo runtime nativo no grace).
    cleanup: async () => {
      try {
        await revokeEphemeralToken(ephemeral.id);
      } catch {
        // token expira sozinho; revogação é higiene, não invariante.
      }
    },
  };
}
