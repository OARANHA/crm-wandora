-- 0502 — A SUSPENSÃO QUE SUSPENDE: org operante, suspensão tipada e estado só pelo servidor
--        (spec docs/superpowers/specs/2026-09-29-cobranca-do-revendedor-design.md §2.1, §2.5, §2.6, §3.1)
--
-- ── A causa ───────────────────────────────────────────────────────────────────
-- Suspender uma organização só tirava a pessoa da tela. A rota fazia leitura,
-- UPDATE e `event_log` sem await em três passos soltos; nada parava os jobs
-- `pending` nem as mensagens `queued`; e `status` era gravável pelo PostgREST
-- por qualquer platform admin — `orgs_write_platform_admin` aceita
-- `fn_is_platform_admin()`, que ignora o scope, então um `support_readonly`
-- reativava uma suspensa com um PATCH.
--
-- Esta migration foi renumerada de 0492 para 0502 porque a main avançou até
-- 0500 e o PR #7 reservou 0501 antes da implementação desta PR.
--
-- ── A. suspended_kind + fn_org_operante ──────────────────────────────────────
alter table public.organizations add column if not exists suspended_kind text;

update public.organizations
   set suspended_kind = 'administrativa'
 where status = 'suspended'
   and suspended_kind is null;

alter table public.organizations
  drop constraint if exists organizations_suspended_kind_check;
alter table public.organizations
  add constraint organizations_suspended_kind_check check (suspended_kind in ('administrativa', 'cobranca'));

comment on column public.organizations.suspended_kind is
  'Por que a organização está suspensa: administrativa (platform admin) ou cobranca (régua de cobrança). Só significa algo com status = suspended: o lgpd-redact-worker troca para redacted sem limpar. Escrito só por fn_suspender_organizacao e fn_reativar_organizacao (migration 0502).';

create or replace function public.fn_org_operante(p_org uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select o.status = 'active' from public.organizations o where o.id = p_org), false);
$$;

revoke execute on function public.fn_org_operante(uuid) from public, anon, authenticated;
grant execute on function public.fn_org_operante(uuid) to service_role;
