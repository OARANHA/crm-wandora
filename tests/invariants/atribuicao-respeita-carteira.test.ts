import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  countAs,
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_CONV_AGENT_B,
  GOV_CONV_UNASSIGNED,
  GOV_MANAGER,
  GOV_ORG,
  seedGov,
  sql,
} from "./gov-helpers";

beforeAll(seedGov);

beforeEach(() => {
  sql(`
    update public.organizations
       set settings = jsonb_set(coalesce(settings, '{}'), '{visibility_mode}', '"own_and_unassigned"')
     where id = '${GOV_ORG}';
    update public.conversations
       set assigned_to_user_id = '${GOV_AGENT_B}', assignee_kind = 'user', status = 'claimed'
     where id = '${GOV_CONV_AGENT_B}';
    update public.conversations
       set assigned_to_user_id = null, assignee_kind = null,
           assigned_to_user_name = null, status = 'open'
     where id = '${GOV_CONV_UNASSIGNED}';
  `);
});

function assign(user: string, conversation: string, target: string | null, optimistic = false) {
  return countAs(
    user,
    `select count(*) from public.fn_conversation_assign(
      '${GOV_ORG}',
      '${conversation}',
      ${target ? `'${target}'` : "null"},
      'transfer',
      null,
      ${optimistic}
    )`,
  );
}

describe("atribuição não amplia o escopo de leitura", () => {
  it("atendente não assume conversa oculta nem grava evento", () => {
    const before = sql(
      `select count(*) from conversation_assignment_events where conversation_id = '${GOV_CONV_AGENT_B}'`,
    );
    expect(
      countAs(GOV_AGENT_A, `select count(*) from conversations where id = '${GOV_CONV_AGENT_B}'`),
    ).toBe(0);
    expect(() => assign(GOV_AGENT_A, GOV_CONV_AGENT_B, GOV_AGENT_A)).toThrow();
    expect(
      sql(`select assigned_to_user_id from conversations where id = '${GOV_CONV_AGENT_B}'`),
    ).toBe(GOV_AGENT_B);
    expect(
      sql(
        `select count(*) from conversation_assignment_events where conversation_id = '${GOV_CONV_AGENT_B}'`,
      ),
    ).toBe(before);
  });

  it("dono transfere a conversa e mantém a IA silenciada", () => {
    expect(assign(GOV_AGENT_B, GOV_CONV_AGENT_B, GOV_AGENT_A)).toBe(1);
    expect(
      sql(
        `select bot_silenced_until = 'infinity'::timestamptz from conversations where id = '${GOV_CONV_AGENT_B}'`,
      ),
    ).toBe("t");
  });

  it.each([GOV_MANAGER, GOV_ADMIN])("gestão transfere conversa da operação: %s", (user) => {
    expect(assign(user, GOV_CONV_AGENT_B, GOV_AGENT_A)).toBe(1);
  });

  it("fila visível pode ser assumida e o conflito otimista devolve zero linhas", () => {
    expect(assign(GOV_AGENT_A, GOV_CONV_UNASSIGNED, GOV_AGENT_A, true)).toBe(1);
    expect(assign(GOV_AGENT_B, GOV_CONV_UNASSIGNED, GOV_AGENT_B, true)).toBe(0);
  });

  it("modo all mantém o escopo compartilhado", () => {
    sql(
      `update organizations set settings = jsonb_set(settings, '{visibility_mode}', '"all"') where id = '${GOV_ORG}'`,
    );
    expect(assign(GOV_AGENT_A, GOV_CONV_AGENT_B, GOV_AGENT_A)).toBe(1);
  });

  it("modo own não permite assumir conversa sem dono", () => {
    sql(
      `update organizations set settings = jsonb_set(settings, '{visibility_mode}', '"own"') where id = '${GOV_ORG}'`,
    );
    expect(() => assign(GOV_AGENT_A, GOV_CONV_UNASSIGNED, GOV_AGENT_A)).toThrow();
  });
});
