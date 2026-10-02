import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * A SUSPENSÃO QUE SUSPENDE (migration 0502; spec cobrança do revendedor §2.1,
 * §3.1 e §12, invariantes 2 a 4).
 *
 * Antes: suspender só tirava a pessoa da tela. A rota fazia leitura, UPDATE e
 * `event_log` sem await em três passos soltos; nada parava jobs `pending` nem
 * mensagens `queued`; e `status` era gravável pelo PostgREST por qualquer
 * platform admin — `orgs_write_platform_admin` aceita `fn_is_platform_admin()`,
 * que ignora o scope, então um `support_readonly` reativava uma suspensa.
 *
 * Os casos com ⭐ são os que o banco de antes deixava passar.
 */

const ORG_A = "c0de0502-0000-4000-8000-00000000000a";
const ORG_B = "c0de0502-0000-4000-8000-00000000000b";
const ORG_C = "c0de0502-0000-4000-8000-00000000000c";
const ORG_R = "c0de0502-0000-4000-8000-00000000000d";
const ORG_FORJADA = "c0de0502-0000-4000-8000-00000000000e";

const DONO = "c0de0502-1111-4000-8000-000000000001";
const SUPORTE = "c0de0502-1111-4000-8000-000000000002";
const ADMIN_A = "c0de0502-1111-4000-8000-000000000003";

const SESSAO_A = "c0de0502-2222-4000-8000-00000000000a";
const SESSAO_B = "c0de0502-2222-4000-8000-00000000000b";
const CONTATO_A1 = "c0de0502-3333-4000-8000-0000000000a1";
const CONTATO_A2 = "c0de0502-3333-4000-8000-0000000000a2";
const CONTATO_B = "c0de0502-3333-4000-8000-0000000000b1";
const CONVERSA_A1 = "c0de0502-4444-4000-8000-0000000000a1";
const CONVERSA_A2 = "c0de0502-4444-4000-8000-0000000000a2";
const CONVERSA_B = "c0de0502-4444-4000-8000-0000000000b1";
const JOB_A = "c0de0502-5555-4000-8000-00000000000a";
const JOB_B = "c0de0502-5555-4000-8000-00000000000b";
const MSG_A = "c0de0502-6666-4000-8000-00000000000a";
const MSG_B = "c0de0502-6666-4000-8000-00000000000b";

function valor(consulta: string): string {
  return lastLine(sql(consulta));
}

function operante(org: string): string {
  return valor(`set role service_role;\nselect public.fn_org_operante('${org}')::text;`);
}

function comoUsuario(usuario: string, comando: string): string {
  return `set role authenticated;
select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);
${comando};`;
}

function erroDe(script: string): string {
  try {
    sql(`\\set VERBOSITY verbose\n${script}`);
    return "";
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? err);
  }
}

function reiniciar(): void {
  sql(`
    update public.organizations
       set status = 'active', suspended_kind = null, suspended_at = null,
           suspended_reason = null, suspended_by = null
     where id in ('${ORG_A}', '${ORG_B}', '${ORG_C}');
    update public.job_queue set status = 'pending', last_error = null where id in ('${JOB_A}', '${JOB_B}');
    update public.messages set status = 'queued', error_code = null where id in ('${MSG_A}', '${MSG_B}');
    update public.conversations set last_inbound_at = null where id in ('${CONVERSA_A1}', '${CONVERSA_A2}');
  `);
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${DONO}', 'dono-0502@invariant.test'),
      ('${SUPORTE}', 'suporte-0502@invariant.test'),
      ('${ADMIN_A}', 'admin-a-0502@invariant.test')
      on conflict do nothing;
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason) values
      ('${DONO}', '${DONO}', 'full', false, 'fixture do invariante 0502'),
      ('${SUPORTE}', '${DONO}', 'support_readonly', false, 'fixture do invariante 0502')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'org-0502-a', 'Org 0502 A', 'Org 0502 A'),
      ('${ORG_B}', 'org-0502-b', 'Org 0502 B', 'Org 0502 B'),
      ('${ORG_C}', 'org-0502-c', 'Org 0502 C', 'Org 0502 C'),
      ('${ORG_R}', 'org-0502-r', 'Org 0502 R', 'Org 0502 R')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${ADMIN_A}', '${ORG_A}', 'admin', now()) on conflict do nothing;
    do $s$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
        ('${SESSAO_A}', '${ORG_A}', 'org-0502-a', '\\x00'::bytea),
        ('${SESSAO_B}', '${ORG_B}', 'org-0502-b', '\\x00'::bytea);
    exception when unique_violation then null; end $s$;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_A1}', '${ORG_A}', 'Contato 0502 A1'),
      ('${CONTATO_A2}', '${ORG_A}', 'Contato 0502 A2'),
      ('${CONTATO_B}', '${ORG_B}', 'Contato 0502 B')
      on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CONVERSA_A1}', '${ORG_A}', '${CONTATO_A1}', '${SESSAO_A}', 'open'),
      ('${CONVERSA_A2}', '${ORG_A}', '${CONTATO_A2}', '${SESSAO_A}', 'open'),
      ('${CONVERSA_B}', '${ORG_B}', '${CONTATO_B}', '${SESSAO_B}', 'open')
      on conflict (id) do nothing;
    insert into public.job_queue (id, organization_id, kind, status) values
      ('${JOB_A}', '${ORG_A}', 'watchdog', 'pending'),
      ('${JOB_B}', '${ORG_B}', 'watchdog', 'pending')
      on conflict (id) do nothing;
    insert into public.messages
      (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, sent_via, body) values
      ('${MSG_A}', '${ORG_A}', '${CONVERSA_A1}', '${SESSAO_A}', '${CONTATO_A1}', 'text', 'outbound', 'queued', 'user', 'resposta na fila'),
      ('${MSG_B}', '${ORG_B}', '${CONVERSA_B}', '${SESSAO_B}', '${CONTATO_B}', 'text', 'outbound', 'queued', 'user', 'resposta na fila')
      on conflict (id) do nothing;
  `);
});

beforeEach(reiniciar);

describe("fn_org_operante — a régua SQL do predicado", () => {
  it("só active opera; suspensa, arquivada, redigida e inexistente não operam", () => {
    sql(`
      update public.organizations set status = 'suspended', suspended_kind = 'administrativa', suspended_at = now() where id = '${ORG_A}';
      update public.organizations set status = 'archived' where id = '${ORG_C}';
      update public.organizations set status = 'redacted', suspended_kind = 'cobranca' where id = '${ORG_R}';
    `);
    expect(operante(ORG_B)).toBe("true");
    expect(operante(ORG_A)).toBe("false");
    expect(operante(ORG_C)).toBe("false");
    expect(operante(ORG_R)).toBe("false");
    expect(operante(ORG_FORJADA)).toBe("false");
  });

  it("⭐ o tipo da suspensão é vocabulário fechado", () => {
    const e = erroDe(`update public.organizations set suspended_kind = 'fraude' where id = '${ORG_A}';`);
    expect(e).toContain("23514");
    expect(e).toContain("organizations_suspended_kind_check");
  });

  it("a sessão não executa fn_org_operante (EXECUTE só do service_role)", () => {
    const e = erroDe(comoUsuario(ADMIN_A, `select public.fn_org_operante('${ORG_A}')`));
    expect(e).toContain("42501");
    expect(e).toContain("permission denied");
  });
});
