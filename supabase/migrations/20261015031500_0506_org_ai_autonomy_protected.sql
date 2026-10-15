-- 0506 ELUS: autonomia tecnica de IA isolada das settings mutaveis do tenant.
-- Nao armazenar grants em organizations.settings: rotas manager+ gravam snapshots
-- inteiros dessa coluna e podem ressuscitar um grant que o Superadmin revogou.
-- A coluna isolada permite atualizar settings sem tocar em autorizacoes.
alter table public.organizations
  add column if not exists ai_autonomy jsonb not null default '{}'::jsonb;

comment on column public.organizations.ai_autonomy is
  'ELUS: grants tecnicos de IA emitidos somente via Superadmin full/MFA. Objetos com flags provider, model, credentials e operator_model; ausencia = false. Isolado de settings para nao ressuscitar revogacoes por writes concorrentes.';

-- O grant de tabela para authenticated eh ALL no baseline. RLS orgs_write_platform_admin
-- nao distingue scope full de support_readonly, portanto proteger no banco tambem.
-- Nenhuma operacao JWT authenticated, inclusive via SECURITY DEFINER, pode escrever
-- a coluna. A API governada usa service_role, apos autenticar full/MFA e auditar.
create or replace function public.fn_guard_organizations_ai_autonomy()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_changed boolean;
  v_privileged boolean;
begin
  if tg_op = 'INSERT' then
    v_changed := new.ai_autonomy is distinct from '{}'::jsonb;
  else
    v_changed := new.ai_autonomy is distinct from old.ai_autonomy;
  end if;

  if v_changed then
    v_privileged :=
      auth.role() = 'service_role'
      or (current_user = 'postgres' and auth.uid() is null and auth.role() is null);
    if not coalesce(v_privileged, false) then
      raise exception 'elus_ai_autonomy_restricted'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_organizations_ai_autonomy on public.organizations;
create trigger trg_guard_organizations_ai_autonomy
before insert or update on public.organizations
for each row
execute function public.fn_guard_organizations_ai_autonomy();

revoke all on function public.fn_guard_organizations_ai_autonomy()
  from public, anon, authenticated;
