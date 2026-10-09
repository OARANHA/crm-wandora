import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "@/lib/mcp/types";

import { classificarResultadoParaAuditoria } from "@/lib/mcp/classificar-resultado-auditoria";
import {
  erroFiscalRecenteParaAuditoria,
  vazioFiscalRecenteParaAuditoria,
} from "@/lib/mcp/tools/auditoria-notas-recentes-fiscais";

const auditSpy = vi.fn();
const respostas = vi.hoisted(() => ({ atual: null as unknown }));
vi.mock("@/lib/mcp/audit", () => ({
  auditMcpToolCall: (dados: unknown) => auditSpy(dados),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/mcp/tools", async () => {
  const { z } = await import("zod");
  const { erroFiscalRecenteParaAuditoria, vazioFiscalRecenteParaAuditoria } =
    await import("@/lib/mcp/tools/auditoria-notas-recentes-fiscais");
  const definicao = {
    name: "busca_fiscal_teste",
    description: "Busca fiscal fake, sem provider e sem I/O",
    inputSchema: { cliente: z.string() },
    category: "read",
    requiresRole: "agent",
    requiresScope: "mcp:read",
    redigirParaAuditoria: () => ({ cliente: "[redigido]" }),
    erroParaAuditoria: erroFiscalRecenteParaAuditoria,
    motivoDoVazio: vazioFiscalRecenteParaAuditoria,
    handler: async () => respostas.atual,
  };
  return {
    allTools: [definicao],
    getToolByName: (name: string) => (name === definicao.name ? definicao : undefined),
  };
});

const { createMcpServer } = await import("@/lib/mcp/server");
const { pickToolsFromMcp } = await import("@/lib/ai/runtime/tools");

const CPF_TESTE = "12345678900";
const auth = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  role: "admin",
  actor: { type: "ai_agent", id: "00000000-0000-4000-8000-000000000002" },
  apiTokenId: "00000000-0000-4000-8000-000000000003",
  scopes: ["mcp:read"],
} as never;

const ctx = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  role: "admin",
  actor: { type: "ai_agent", id: "00000000-0000-4000-8000-000000000002" },
  apiTokenId: "00000000-0000-4000-8000-000000000003",
  requestId: "00000000-0000-4000-8000-000000000004",
  supabase: {},
} as unknown as McpContext;

const argumentos = { cliente: CPF_TESTE };

async function invocarAgente(): Promise<unknown> {
  const montadas = pickToolsFromMcp({
    supabase: {} as never,
    ctx,
    auth,
    toolIds: ["busca_fiscal_teste"],
    handoffToolEnabled: false,
    handoffSignal: { triggered: false },
  });
  expect(montadas.busca_fiscal_teste).toBeDefined();
  const ferramenta = montadas.busca_fiscal_teste as unknown as {
    execute: (input: unknown) => Promise<unknown>;
  };
  return await ferramenta.execute(argumentos);
}

async function invocarServidor(): Promise<unknown> {
  const server = createMcpServer(auth, ctx.requestId);
  const [cliente, servidor] = InMemoryTransport.createLinkedPair();
  await server.connect(servidor);
  const client = new Client({ name: "teste", version: "0.0.0" });
  await client.connect(cliente);
  const retorno = await client.callTool({ name: "busca_fiscal_teste", arguments: argumentos });
  await client.close();
  return retorno.structuredContent;
}

describe("auditoria fiscal estruturada — sem calls ao VendaERP", () => {
  beforeEach(() => auditSpy.mockClear());

  it("não aceita erro arbitrário do provider como motivo de auditoria, mesmo com PII", () => {
    const e = {
      erro: "cpf=" + CPF_TESTE + " https://provider.exemplo/segredo",
      mensagem: "nome e NFe",
    };
    expect(erroFiscalRecenteParaAuditoria(e)).toBe("erro_fiscal_nao_classificado");
    expect(
      classificarResultadoParaAuditoria(
        {
          erroParaAuditoria: erroFiscalRecenteParaAuditoria,
        },
        e,
      ),
    ).toEqual({
      success: false,
      desfecho: "erro_resultado",
      motivo: "erro_fiscal_nao_classificado",
    });
    expect(erroFiscalRecenteParaAuditoria({ erro: { cpf: CPF_TESTE } })).toBe(
      "erro_fiscal_nao_classificado",
    );
  });

  it("classifica erro conhecido sem expor a mensagem do provider", () => {
    expect(
      classificarResultadoParaAuditoria(
        {
          erroParaAuditoria: erroFiscalRecenteParaAuditoria,
        },
        { erro: "cliente_nao_resolvido", mensagem: "Cliente " + CPF_TESTE },
      ),
    ).toEqual({
      success: false,
      desfecho: "erro_resultado",
      motivo: "cliente_nao_resolvido",
    });
  });

  it("não muda sucesso de resposta fiscal comprovada nem de tool sem opt-in", () => {
    const prova = {
      notas: [{ numeroNFe: "123", dataEmissao: "2026-10-08" }],
      resumo: { consultaCompleta: true },
    };
    expect(
      classificarResultadoParaAuditoria(
        {
          erroParaAuditoria: erroFiscalRecenteParaAuditoria,
          motivoDoVazio: vazioFiscalRecenteParaAuditoria,
        },
        prova,
      ),
    ).toEqual({ success: true, motivo: null });
    expect(classificarResultadoParaAuditoria({}, { erro: "outro_formato" })).toEqual({
      success: true,
      motivo: null,
    });
  });

  it("lista fiscal comprovadamente vazia é sem_resultado, não erro técnico", () => {
    expect(
      classificarResultadoParaAuditoria(
        {
          erroParaAuditoria: erroFiscalRecenteParaAuditoria,
          motivoDoVazio: vazioFiscalRecenteParaAuditoria,
        },
        { notas: [], resumo: { consultaCompleta: true } },
      ),
    ).toEqual({
      success: false,
      desfecho: "sem_resultado",
      motivo: "sem_nfes_no_periodo",
    });
  });

  for (const [porta, invocar] of [
    ["agente interno", invocarAgente],
    ["servidor MCP", invocarServidor],
  ] as const) {
    it(porta + ": erro fiscal conhecido é auditado e resposta permanece igual", async () => {
      respostas.atual = { erro: "janela_fiscal_insuficiente", mensagem: "CPF " + CPF_TESTE };
      const retorno = await invocar();
      expect(retorno).toEqual(respostas.atual);
      expect(auditSpy).toHaveBeenCalledOnce();
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          desfecho: "erro_resultado",
          motivo: "janela_fiscal_insuficiente",
          args: { cliente: "[redigido]" },
        }),
      );
      expect(JSON.stringify(auditSpy.mock.calls)).not.toContain(CPF_TESTE);
    });

    it(porta + ": erro desconhecido mantém apenas código genérico e não vaza PII", async () => {
      respostas.atual = { erro: "nome " + CPF_TESTE, mensagem: "provedor contém URL sensível" };
      await invocar();
      const auditoria = auditSpy.mock.lastCall?.[0] as { success: boolean; motivo: string };
      expect(auditoria).toMatchObject({
        success: false,
        desfecho: "erro_resultado",
        motivo: "erro_fiscal_nao_classificado",
      });
      expect(JSON.stringify(auditoria)).not.toContain(CPF_TESTE);
    });

    it(porta + ": retorno fiscal com notas continua sucesso", async () => {
      respostas.atual = {
        notas: [{ numeroNFe: "123", dataEmissao: "2026-10-08" }],
        resumo: { consultaCompleta: true },
      };
      await invocar();
      expect(auditSpy).toHaveBeenCalledOnce();
      expect(auditSpy.mock.lastCall?.[0]).toMatchObject({ success: true });
      expect(auditSpy.mock.lastCall?.[0]).not.toHaveProperty("desfecho");
      expect(auditSpy.mock.lastCall?.[0]).not.toHaveProperty("motivo");
    });
  }
});
