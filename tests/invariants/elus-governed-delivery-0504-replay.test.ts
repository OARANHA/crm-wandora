/**
 * Regressão da lacuna 0504 observada no catálogo ELUS (2026-10-16).
 * Exclusivamente no Postgres DESCARTÁVEL do pnpm test:db (PG15 e PG17).
 *
 * Reconstrói apenas as duas CHECKs antigas e remove o índice 0504 para
 * reproduzir o schema antigo; aplica a migration existente DUAS vezes,
 * sem alterar o arquivo SQL canônico, ledger ou qualquer banco real.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GOV_CONTACT_1, GOV_CONTACT_2, GOV_ORG, seedGov, sql } from "./gov-helpers";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261005150000_0504_integracoes_erp_entrega_danfe_governada.sql",
  ),
  "utf8",
);

function countChecksWithGovernedDelivery(): string {
  return sql(`
    select count(*)
      from pg_catalog.pg_constraint
     where conrelid = 'public.job_queue'::regclass
       and conname in ('job_queue_kind_check', 'job_queue_turn_needs_contact')
       and pg_get_constraintdef(oid) ilike '%governed_delivery%';
  `);
}

function countExactIndex(): string {
  return sql(`
    select count(*)
      from pg_catalog.pg_indexes
     where schemaname = 'public' and tablename = 'job_queue'
       and indexname = 'uniq_job_queue_governed_delivery_origin_invoice'
       and indexdef ilike '%governed_delivery%';
  `);
}

describe("ELUS 0504 — replay somente no banco efêmero com estado antigo", () => {
  it("repara CHECKs e unicidade após regressão sintética sem perder idempotência", () => {
    expect(countChecksWithGovernedDelivery()).toBe("2");
    expect(countExactIndex()).toBe("1");

    // O estado reproduz a leitura real de produção. Só altera a cópia efêmera.
    sql(`
      drop index if exists public.uniq_job_queue_governed_delivery_origin_invoice;
      alter table public.job_queue drop constraint if exists job_queue_kind_check;
      alter table public.job_queue
        add constraint job_queue_kind_check check (
          kind in (
            'inbound_turn','followup_turn','watchdog','flywheel','case_reply_turn',
            'operator_turn','transactional_delivery','approved_reply'
          )
        );
      alter table public.job_queue drop constraint if exists job_queue_turn_needs_contact;
      alter table public.job_queue
        add constraint job_queue_turn_needs_contact check (
          (kind in (
            'inbound_turn','followup_turn','case_reply_turn','operator_turn',
            'transactional_delivery','approved_reply'
          )) = (contact_id is not null)
        );
    `);

    expect(countChecksWithGovernedDelivery()).toBe("0");
    expect(countExactIndex()).toBe("0");

    // Exatamente a migration existente no repo, não um SQL alternativo.
    sql(migration);
    sql(migration);

    expect(countChecksWithGovernedDelivery()).toBe("2");
    expect(countExactIndex()).toBe("1");

    seedGov();
    const intent = JSON.stringify({
      origin_job_id: "fixture-origin-0504",
      operation: "erp_danfe_to_invoice_customer",
      codigo_nfe: "fixture-nfe-0504",
    });

    // Primeiro job de documento agora pode entrar na fila.
    sql(`
      insert into public.job_queue (organization_id, contact_id, kind, payload)
      values (
        '${GOV_ORG}'::uuid, '${GOV_CONTACT_1}'::uuid,
        'governed_delivery', '${intent}'::jsonb
      );
    `);

    // Retry equivalente em outro contato DEVE atingir o índice 0504,
    // não cair em uma constraint de lane/contacto não relacionada.
    expect(
      sql(`
        do $check$
        declare actual_constraint text;
        begin
          begin
            insert into public.job_queue (organization_id, contact_id, kind, payload)
            values (
              '${GOV_ORG}'::uuid, '${GOV_CONTACT_2}'::uuid,
              'governed_delivery', '${intent}'::jsonb
            );
          exception when unique_violation then
            get stacked diagnostics actual_constraint = constraint_name;
          end;
          if actual_constraint is distinct from
             'uniq_job_queue_governed_delivery_origin_invoice' then
            raise exception 'Deduplicação 0504 ausente; constraint=%',
              coalesce(actual_constraint, 'none');
          end if;
        end $check$;
        select 1;
      `),
    ).toBe("1");
  });
});
