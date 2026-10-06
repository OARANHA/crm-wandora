import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";

const controlados = vi.hoisted(() => ({
  buscarPedidosErp: vi.fn(),
  auditMcpToolCall: vi.fn(async () => {}),
  mintEphemeralToken: vi.fn(async () => ({ id: "tok-par-erp" })),
  revokeEphemeralToken: vi.fn(async () => {}),
}));

vi.mock("@/lib/integracoes-erp/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integracoes-erp/service")>();
  return { ...actual, buscarPedidosErp: controlados.buscarPedidosErp };
});

vi.mock("@/lib/mcp/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/audit")>();
  return { ...actual, auditMcpToolCall: controlados.auditMcpToolCall };
});

vi.mock("@/lib/ai/runtime/mcp_token", () => ({
  mintEphemeralToken: controlados.mintEphemeralToken,
  revokeEphemeralToken: controlados.revokeEphemeralToken,
}));

vi.mock("@/lib/instalacao/modulos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/instalacao/modulos")>();
  return {
    ...actual,
    modulosLigados: vi.fn(async () => ["integracoes_erp"]),
  };
});

vi.mock("@/lib/organizacao/capacidades", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/organizacao/capacidades")>();
  return {
    ...actual,
    capacidadesDaOrganizacao: vi.fn(async () => []),
  };
});

import { loadAgentVersionConfig } from "@/lib/agent-engine/agent/agent-config";
import { runAgentPreview } from "@/lib/agent-engine/agent/inbound-turn";
import {
  newPreviewResult,
  scenarioContext,
  type TurnPreview,
} from "@/lib/agent-engine/agent/preview";
import { turnKnobsFromEnv } from "@/lib/agent-engine/agent/turn-knobs";
import { loadEnv } from "@/lib/agent-engine/env";
import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { createLogger } from "@/lib/agent-engine/obs/logger";
import { crmErpSearchOrders } from "@/lib/mcp/tools/integracoes-erp";
import { seedGov } from "./gov-helpers";
import { replyFixture } from "../support/autonomia-fixture";

if (!process.env.TEST_DB_PORT) {
  throw new Error("TEST_DB_PORT ausente — execute pnpm test:db");
}

const TEXTO_CRU = "Quais as últimas 2 notas da Eco Projetos?";

const pool = new pg.Pool({
  host: "127.0.0.1",
  port: Number(process.env.TEST_DB_PORT),
  user: "postgres",
  password: "postgres",
  database: "postgres",
  max: 4,
});

const pedidos = [
  {
    id: "p-1",
    codigo: 1,
    cliente: "Eco Projetos",
    status: "Faturado",
    statusSistema: null,
    total: 100,
    data: "2026-10-01T10:00:00Z",
    finalizado: true,
    numeroNFe: "9001",
    dataFaturamento: "2026-10-01T10:00:00Z",
    chaveAcessoNFe: null,
    danfeUrl: null,
    urlSefaz: null,
  },
  {
    id: "p-3",
    codigo: 3,
    cliente: "Eco Projetos",
    status: "Faturado",
    statusSistema: null,
    total: 300,
    data: "2026-10-03T10:00:00Z",
    finalizado: true,
    numeroNFe: "9003",
    dataFaturamento: "2026-10-03T10:00:00Z",
    chaveAcessoNFe: null,
    danfeUrl: null,
    urlSefaz: null,
  },
  {
    id: "p-2",
    codigo: 2,
    cliente: "Eco Projetos",
    status: "Faturado",
    statusSistema: null,
    total: 200,
    data: "2026-10-02T10:00:00Z",
    finalizado: true,
    numeroNFe: "9002",
    dataFaturamento: "2026-10-02T10:00:00Z",
    chaveAcessoNFe: null,
    danfeUrl: null,
    urlSefaz: null,
  },
];

beforeAll(async () => {
  seedGov();
  await pool.query(
    `with v as (
       insert into playbook_versions(organization_id,layer,content)
       select null,'platform','## Identidade: Assistente de teste.'
       where not exists(
         select 1 from playbook_pointers where organization_id is null and layer='platform'
       )
       returning id
     )
     insert into playbook_pointers(organization_id,layer,version_id)
     select null,'platform',id from v`,
  );
});

afterAll(async () => {
  await pool.end();
});

function deps() {
  const knobs = turnKnobsFromEnv(
    loadEnv({
      NODE_ENV: "test",
      SUPABASE_DB_URL: "postgresql://postgres@localhost/postgres",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
      SUPABASE_SERVICE_ROLE_KEY: "test-key",
    }),
  );
  delete knobs.stageClassifier;
  delete knobs.jailbreak;
  delete knobs.promiseSemantic;
  delete knobs.compaction;

  return {
    crmCfg: { supabase: createClient("http://127.0.0.1:1", "test-key") },
    llmCfg: { anthropicApiKey: "fake-local" },
    knobs,
    log: createLogger(),
    clock: () => new Date("2026-10-06T15:00:00Z"),
    embed: async () => ({
      embedding: Array(1536).fill(0.1),
      promptTokens: 0,
      model: "text-embedding-3-small",
    }),
    registry: createFakeRegistry(async (options) => {
      const resultados = options.prompt.filter((m) => m.role === "tool").flatMap((m) => m.content);
      const viu = (nome: string) => resultados.some((r) => "toolName" in r && r.toolName === nome);
      const tem = (nome: string) =>
        options.tools?.some((t) => t.type === "function" && t.name === nome) ?? false;

      let content: Array<
        | { type: "text"; text: string }
        | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
      >;

      if (!options.tools?.length) {
        const prompt = JSON.stringify(options.prompt);
        const valor = prompt.includes("Turno interno de memória")
          ? { notes: [] }
          : prompt.includes("Compacte a conversa")
            ? {
                rolling_summary: "Consulta ERP em prova.",
                commitments: [],
                objections: [],
                personal_data: [],
                stage: null,
              }
            : {
                rolling_summary: "Consulta ERP concluída.",
                commitments: [],
                objections: [],
                next_action: null,
                declaracao: { promessas: [] },
              };
        content = [{ type: "text", text: JSON.stringify(valor) }];
      } else if (tem("crm_erp_search_orders") && !viu("crm_erp_search_orders")) {
        content = [
          {
            type: "tool-call",
            toolCallId: randomUUID(),
            toolName: "crm_erp_search_orders",
            input: JSON.stringify({ consulta: TEXTO_CRU }),
          },
        ];
      } else if (viu("crm_erp_search_orders") && tem("send_message") && !viu("send_message")) {
        content = [
          {
            type: "tool-call",
            toolCallId: randomUUID(),
            toolName: "send_message",
            input: JSON.stringify({
              body: "As últimas 2 notas da Eco Projetos são 9003 e 9002.",
            }),
          },
        ];
      } else {
        content = [{ type: "text", text: "Consulta concluída." }];
      }

      return {
        content,
        finishReason: {
          unified: content[0]?.type === "tool-call" ? "tool-calls" : "stop",
          raw: undefined,
        },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    }),
  };
}

it("prova em par: agente e capability direta concordam com o mesmo texto cru", async () => {
  controlados.buscarPedidosErp.mockReset();
  controlados.auditMcpToolCall.mockClear();
  controlados.buscarPedidosErp.mockResolvedValue({ ok: true, dados: pedidos });

  const fixture = await replyFixture(pool);
  await pool.query("update ai_agent_versions set tool_ids=$1::text[] where id=$2", [
    ["crm_erp_search_orders"],
    fixture.version,
  ]);

  const agent = await loadAgentVersionConfig(pool, fixture.org, fixture.agent, fixture.version);
  expect(agent?.toolIds).toEqual(["crm_erp_search_orders"]);

  const chamadasDoAgente: unknown[] = [];
  const respostasDoAgente: unknown[] = [];
  const originalHandler = crmErpSearchOrders.handler;
  const handlerSpy = vi
    .spyOn(crmErpSearchOrders, "handler")
    .mockImplementation(async (input, ctx) => {
      chamadasDoAgente.push(structuredClone(input));
      const resposta = await originalHandler(input, ctx);
      respostasDoAgente.push(structuredClone(resposta));
      return resposta;
    });

  const result = newPreviewResult();
  const preview: TurnPreview = {
    kind: "sandbox",
    organizationId: fixture.org,
    runId: randomUUID(),
    agent: agent!,
    contactId: null,
    channelId: fixture.channel,
    erpAdminPreviewAuthorized: true,
    context: scenarioContext([
      {
        direction: "inbound",
        body: TEXTO_CRU,
        sent_at: "2026-10-06T14:59:00Z",
      },
    ]),
    result,
  };

  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("par_nao_pode_sair_para_http"));

  try {
    await runAgentPreview(deps(), pool, preview);
  } finally {
    fetchSpy.mockRestore();
    handlerSpy.mockRestore();
  }

  expect(chamadasDoAgente).toHaveLength(1);
  expect(chamadasDoAgente[0]).toMatchObject({ consulta: TEXTO_CRU });
  expect(respostasDoAgente).toHaveLength(1);

  const directInput = z.object(crmErpSearchOrders.inputSchema).parse({
    consulta: TEXTO_CRU,
  });
  const directOutput = await originalHandler(directInput, {
    organizationId: fixture.org,
    role: "admin",
    actor: { type: "user", id: "proof-pair", role: "admin" },
    apiTokenId: "proof-pair",
    requestId: "proof-pair-direct",
    supabase: createClient("http://127.0.0.1:1", "test-key"),
  } as never);

  expect(respostasDoAgente[0]).toEqual(directOutput);
  expect(directOutput).toMatchObject({
    pedidos: [
      { numeroNFe: "9003", cliente: "Eco Projetos" },
      { numeroNFe: "9002", cliente: "Eco Projetos" },
    ],
  });
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]?.body).toContain("9003");
  expect(result.candidates[0]?.body).toContain("9002");

  expect(controlados.auditMcpToolCall).toHaveBeenCalledWith(
    expect.objectContaining({
      toolName: "crm_erp_search_orders",
      args: expect.objectContaining({ consulta: "[redigido]" }),
      success: true,
    }),
  );

  expect(fetchSpy).not.toHaveBeenCalled();
});
