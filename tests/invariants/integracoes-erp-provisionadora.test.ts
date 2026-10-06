import { describe, expect, it } from "vitest";

import { moldeDeProvisionadora } from "./molde-de-provisionadora";
import { sql } from "./gov-helpers";

moldeDeProvisionadora({
  modulo: "integracoes_erp",
  tabelas: ["erp_connections", "erp_admin_whatsapp_bindings", "erp_customer_identity_links"],
  protecaoPropria: ["erp_connections", "erp_admin_whatsapp_bindings", "erp_customer_identity_links"],
});

describe("credenciais de ERP ficam fechadas aos papéis de sessão", () => {
  it("erp_connections nasce server-only, com RLS e sem policy para sessão", () => {
    sql(`select public.fn_integracoes_erp_provisionar();`);

    const estado = sql(`
      select
        c.relrowsecurity::text
        || '|' || (select count(*) from pg_policy p where p.polrelid = c.oid)::text
        || '|' || has_table_privilege('anon', c.oid, 'SELECT')::text
        || '|' || has_table_privilege('anon', c.oid, 'INSERT')::text
        || '|' || has_table_privilege('anon', c.oid, 'UPDATE')::text
        || '|' || has_table_privilege('anon', c.oid, 'DELETE')::text
        || '|' || has_table_privilege('authenticated', c.oid, 'SELECT')::text
        || '|' || has_table_privilege('authenticated', c.oid, 'INSERT')::text
        || '|' || has_table_privilege('authenticated', c.oid, 'UPDATE')::text
        || '|' || has_table_privilege('authenticated', c.oid, 'DELETE')::text
        || '|' || has_table_privilege('service_role', c.oid, 'SELECT')::text
        || '|' || has_table_privilege('service_role', c.oid, 'INSERT')::text
        || '|' || has_table_privilege('service_role', c.oid, 'UPDATE')::text
        || '|' || has_table_privilege('service_role', c.oid, 'DELETE')::text
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'erp_connections';
    `);

    expect(
      estado,
      "erp_connections deve ser acessível somente pelo host/service_role; credenciais cifradas " +
        "não são superfície PostgREST de anon/authenticated",
    ).toBe("true|0|false|false|false|false|false|false|false|false|true|true|true|true");
  });
});

describe("autoridade administrativa de WhatsApp fica fechada aos papéis de sessão", () => {
  it("erp_admin_whatsapp_bindings nasce server-only, com RLS e sem policy de sessão", () => {
    sql(`select public.fn_integracoes_erp_provisionar();`);

    const estado = sql(`
      select
        c.relrowsecurity::text
        || '|' || (select count(*) from pg_policy p where p.polrelid = c.oid)::text
        || '|' || has_table_privilege('anon', c.oid, 'SELECT')::text
        || '|' || has_table_privilege('authenticated', c.oid, 'SELECT')::text
        || '|' || has_table_privilege('service_role', c.oid, 'SELECT')::text
        || '|' || has_table_privilege('service_role', c.oid, 'INSERT')::text
        || '|' || has_table_privilege('service_role', c.oid, 'UPDATE')::text
        || '|' || has_table_privilege('service_role', c.oid, 'DELETE')::text
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'erp_admin_whatsapp_bindings';
    `);

    expect(estado).toBe("true|0|false|false|true|true|true|true");
  });
});

describe("Customer Resolution ERP — vínculo persistido e fail-closed", () => {
  it("a tabela de identidade externa também é server-only", () => {
    sql(`select public.fn_integracoes_erp_provisionar();`);
    const estado = sql(`
      select
        c.relrowsecurity::text
        || '|' || (select count(*) from pg_policy p where p.polrelid = c.oid)::text
        || '|' || has_table_privilege('anon', c.oid, 'SELECT')::text
        || '|' || has_table_privilege('authenticated', c.oid, 'SELECT')::text
        || '|' || has_table_privilege('service_role', c.oid, 'SELECT')::text
        || '|' || has_table_privilege('service_role', c.oid, 'INSERT')::text
        || '|' || has_table_privilege('service_role', c.oid, 'UPDATE')::text
        || '|' || has_table_privilege('service_role', c.oid, 'DELETE')::text
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'erp_customer_identity_links';
    `);
    expect(estado).toBe("true|0|false|false|true|true|true|true");
  });

  it("retry converge, tenant não atravessa e correção invalida sem apagar histórico", () => {
    const ORG_A = "50a50000-0000-4000-8000-00000000000a";
    const ORG_B = "50a50000-0000-4000-8000-00000000000b";
    const CONTATO_2 = "50a50000-2222-4000-8000-000000000002";
    const CONTATO_B = "50a50000-2222-4000-8000-000000000003";
    sql(`
      select public.fn_integracoes_erp_provisionar();
      insert into public.organizations (id, slug, legal_name, display_name) values
        ('${ORG_A}', 'erp-resolution-a', 'ERP Resolution A', 'ERP Resolution A'),
        ('${ORG_B}', 'erp-resolution-b', 'ERP Resolution B', 'ERP Resolution B')
      on conflict (id) do nothing;
      insert into public.contacts (id, organization_id, name) values
        ('${CONTATO_2}', '${ORG_A}', 'Contato Dois'),
        ('${CONTATO_B}', '${ORG_B}', 'Contato B')
      on conflict (id) do nothing;
    `);

    const chamada = (org: string, contact: string | null, externalId: string, origem = "exact_name") =>
      sql(`
        select public.fn_integracoes_erp_vincular_cliente(
          '${org}'::uuid,
          ${contact ? `'${contact}'::uuid` : "null::uuid"},
          'vendaerp',
          '${externalId}',
          'Eco Projetos',
          'eco projetos',
          'ECO PROJETOS LTDA',
          '${origem}',
          '{"signal_types":["name"]}'::jsonb
        )::text;
      `);

    const primeira = JSON.parse(chamada(ORG_A, null, "pessoa-42"));
    const retry = JSON.parse(chamada(ORG_A, null, "pessoa-42"));
    expect(retry.contact_id).toBe(primeira.contact_id);
    expect(retry.created_link).toBe(false);
    expect(
      sql(`select count(*) from public.erp_customer_identity_links
             where organization_id='${ORG_A}' and external_id='pessoa-42' and status='active';`),
    ).toBe("1");
    expect(
      sql(`select count(*) from public.contacts
             where organization_id='${ORG_A}' and source='erp'
               and source_metadata->>'materialized_by'='customer_resolution';`),
    ).toBe("1");

    const outroTenant = JSON.parse(chamada(ORG_B, null, "pessoa-42"));
    expect(outroTenant.contact_id).not.toBe(primeira.contact_id);
    expect(
      () => chamada(ORG_A, CONTATO_B, "pessoa-cross-tenant"),
    ).toThrow(/erp_customer_contact_invalid/);

    expect(
      () => chamada(ORG_A, CONTATO_2, "pessoa-42"),
    ).toThrow(/erp_customer_identity_conflict/);

    const linkId = sql(`select id from public.erp_customer_identity_links
      where organization_id='${ORG_A}' and external_id='pessoa-42' and status='active';`);
    expect(
      JSON.parse(sql(`select public.fn_integracoes_erp_invalidar_vinculo_cliente(
        '${ORG_A}'::uuid, '${linkId}'::uuid, 'correction')::text;`)).invalidated,
    ).toBe(true);

    const corrigido = JSON.parse(chamada(ORG_A, CONTATO_2, "pessoa-42", "corrected"));
    expect(corrigido.contact_id).toBe(CONTATO_2);
    expect(
      sql(`select count(*) from public.erp_customer_identity_links
        where organization_id='${ORG_A}' and external_id='pessoa-42' and status='invalid';`),
    ).toBe("1");
    expect(
      sql(`select count(*) from public.erp_customer_identity_links
        where organization_id='${ORG_A}' and external_id='pessoa-42' and status='active';`),
    ).toBe("1");
  });

  it("o banco contém as duas cercas que tornam concorrência idempotente", () => {
    sql(`select public.fn_integracoes_erp_provisionar();`);
    expect(sql(`
      select count(*) from pg_indexes
       where schemaname='public'
         and indexname in (
           'erp_customer_identity_active_external_unique',
           'erp_customer_identity_active_contact_unique'
         )
         and indexdef ilike '%unique%where (status = ''active''::text)%';
    `)).toBe("2");
    expect(sql(`
      select pg_get_functiondef(p.oid)
        from pg_proc p
       where p.proname='fn_integracoes_erp_vincular_cliente'
         and p.pronamespace='public'::regnamespace;
    `)).toContain("pg_advisory_xact_lock");
  });

  it("as funções de vínculo não são executáveis por sessão", () => {
    expect(sql(`
      select
        has_function_privilege('anon',
          'public.fn_integracoes_erp_vincular_cliente(uuid,uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE')::text
        || '|' ||
        has_function_privilege('authenticated',
          'public.fn_integracoes_erp_vincular_cliente(uuid,uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE')::text
        || '|' ||
        has_function_privilege('service_role',
          'public.fn_integracoes_erp_vincular_cliente(uuid,uuid,text,text,text,text,text,text,jsonb)', 'EXECUTE')::text;
    `)).toBe("false|false|true");
  });

  it("declara LGPD para romper external_id e rótulos ao anonimizar o contato", () => {
    sql(`select public.fn_integracoes_erp_provisionar();`);
    expect(sql(`
      select ligacao || '|' || array_to_string(colunas_rotulo, ',')
        from public.modulo_secoes_lgpd
       where modulo='integracoes_erp' and tabela='erp_customer_identity_links';
    `)).toBe(
      "organization_id = $1 and contact_id = $2|external_id,external_label,external_label_key,provider_lookup_label",
    );
  });
});
