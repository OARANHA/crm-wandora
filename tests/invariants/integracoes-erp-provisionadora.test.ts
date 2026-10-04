import { describe, expect, it } from "vitest";

import { moldeDeProvisionadora } from "./molde-de-provisionadora";
import { sql } from "./gov-helpers";

moldeDeProvisionadora({
  modulo: "integracoes_erp",
  tabelas: ["erp_connections", "erp_admin_whatsapp_bindings"],
  protecaoPropria: ["erp_connections", "erp_admin_whatsapp_bindings"],
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
