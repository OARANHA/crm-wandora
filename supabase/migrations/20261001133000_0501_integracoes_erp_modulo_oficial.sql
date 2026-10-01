-- 0501 — Integrações ERP: módulo oficial opcional, com VendaERP como primeiro provedor.
--
-- Lei: ADR-0002. A migration cria somente a FUNÇÃO provisionadora. A tabela nasce
-- quando o administrador da instalação instala o módulo em /admin/modulos.
--
-- A primeira etapa é deliberadamente READ-ONLY. O campo access_mode já explicita
-- a fronteira para evoluções futuras, mas a API desta versão só grava "read" e o
-- provider VendaERP só expõe capacidades de consulta.
--
-- Credenciais nunca ficam em claro: token, User e App usam o mesmo AES-256-GCM já
-- adotado pelas credenciais de IA e pelo banco externo. A tabela inteira fica
-- fechada a anon/authenticated; rotas do host autorizam a pessoa e filtram
-- organization_id antes de usar o service_role.

create or replace function public.fn_integracoes_erp_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.erp_connections (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,40}$'),
    label text not null default 'VendaERP'
      check (char_length(btrim(label)) between 1 and 120),
    base_url text not null check (char_length(btrim(base_url)) between 8 and 500),

    auth_token_encrypted bytea not null,
    auth_token_iv bytea not null,
    auth_token_tag bytea not null,
    auth_token_last4 text not null,

    user_encrypted bytea not null,
    user_iv bytea not null,
    user_tag bytea not null,
    user_last4 text not null,

    app_encrypted bytea not null,
    app_iv bytea not null,
    app_tag bytea not null,
    app_last4 text not null,

    access_mode text not null default 'read'
      check (access_mode in ('read', 'write', 'destructive')),
    enabled boolean not null default true,

    last_tested_at timestamptz,
    last_test_ok boolean,
    last_test_error text,

    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint erp_connections_org_provider_unique unique (organization_id, provider)
  );

  create index if not exists erp_connections_org_idx
    on public.erp_connections (organization_id);

  alter table public.erp_connections enable row level security;

  -- A credencial nunca é superfície PostgREST de sessão. Mesmo um SELECT direto
  -- não deve revelar os bytea cifrados nem metadados da conexão.
  revoke all on public.erp_connections from anon, authenticated;

  comment on table public.erp_connections is
    'Conexões de ERP por organização. Credenciais cifradas; acesso somente pelas rotas autorizadas do host.';

  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

revoke execute on function public.fn_integracoes_erp_provisionar() from public, anon, authenticated;
grant execute on function public.fn_integracoes_erp_provisionar() to service_role;
