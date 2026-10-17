import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  loadPublishedAgentConfig,
  loadPublishedAgentConfigById,
} from "@/lib/agent-engine/agent/agent-config";

function bancoSemAgentes(): pg.Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  } as unknown as pg.Pool;
}

function consultaExecutada(db: pg.Pool): [string, unknown[]] {
  const query = db.query as unknown as ReturnType<typeof vi.fn>;
  expect(query).toHaveBeenCalledTimes(1);
  return query.mock.calls[0] as [string, unknown[]];
}

describe("DeskcommCRM v1.84 — seleção de agente publicado por canal", () => {
  it("ordena agentes ativos antes dos pausados, mesmo com prioridade menor", async () => {
    const db = bancoSemAgentes();
    await loadPublishedAgentConfig(db, "org-teste", "sessao-teste");

    const [sql, parametros] = consultaExecutada(db);
    expect(parametros).toEqual(["org-teste", "sessao-teste"]);
    expect(sql).toMatch(/a\.organization_id\s*=\s*\$1/);
    expect(sql).toMatch(/v\.channel_session_id\s*=\s*\$2/);
    expect(sql).toMatch(/v\.status\s*=\s*'published'/);

    // No PostgreSQL: (paused_at IS NOT NULL) é false para ativos;
    // ASC coloca false antes de true. Prioridade só desempata nesse grupo.
    const ordenacao = sql.match(/order by ([^\n]+)\s+limit 1/i)?.[1];
    expect(ordenacao).toBe(
      "(a.paused_at is not null) asc, a.priority desc, a.created_at asc",
    );
  });

  it("não elimina agente pausado da busca: se for o único, continua selecionável", async () => {
    const db = bancoSemAgentes();
    await loadPublishedAgentConfig(db, "org-teste", "sessao-teste");

    const [sql] = consultaExecutada(db);
    expect(sql).not.toMatch(/\band\s+a\.paused_at\s+is\s+null\b/i);
    expect(sql).toMatch(/limit 1/);
  });

  it("não altera a busca determinística por ID usada pelos roteadores", async () => {
    const db = bancoSemAgentes();
    await loadPublishedAgentConfigById(db, "org-teste", "agente-teste");

    const [sql, parametros] = consultaExecutada(db);
    expect(parametros).toEqual(["org-teste", "agente-teste"]);
    expect(sql).toMatch(/a\.organization_id\s*=\s*\$1/);
    expect(sql).toMatch(/a\.id\s*=\s*\$2/);
    expect(sql).not.toMatch(/order by \(a\.paused_at is not null\)/i);
  });
});
