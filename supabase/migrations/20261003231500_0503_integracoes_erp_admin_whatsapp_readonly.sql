-- 0503 — Integrações ERP: identidade administrativa de WhatsApp read-only.
--
-- O V1 separa duas autoridades:
--   cliente: continua provando contato <-> Pessoa do VendaERP antes de documento;
--   admin: número remetente explicitamente vinculado a um usuário Elus que continua
--          membro admin da MESMA organização no momento do uso.
--
-- A tabela pertence ao módulo oficial integracoes_erp (ADR-0002), portanto só
-- existe em instalações que já instalaram o módulo. Ela não contém credencial do
-- ERP e não concede escrita: a única capability desta etapa é erp.admin.read.

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
  revoke all on public.erp_connections from anon, authenticated;

  comment on table public.erp_connections is
    'Conexões de ERP por organização. Credenciais cifradas; acesso somente pelas rotas autorizadas do host.';

  create table if not exists public.erp_admin_whatsapp_bindings (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    phone_e164 text not null
      check (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
    capability text not null default 'erp.admin.read'
      check (capability = 'erp.admin.read'),
    enabled boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint erp_admin_whatsapp_bindings_org_user_unique
      unique (organization_id, user_id),
    constraint erp_admin_whatsapp_bindings_org_phone_unique
      unique (organization_id, phone_e164)
  );

  alter table public.erp_admin_whatsapp_bindings enable row level security;
  revoke all on public.erp_admin_whatsapp_bindings from anon, authenticated;

  comment on table public.erp_admin_whatsapp_bindings is
    'Vínculo explícito entre número remetente do WhatsApp e usuário admin do Elus para consultas ERP read-only.';

  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

revoke execute on function public.fn_integracoes_erp_provisionar() from public, anon, authenticated;
grant execute on function public.fn_integracoes_erp_provisionar() to service_role;

-- Instalações que já têm o módulo recebem a nova tabela no upgrade.
do $$
begin
  if exists (
    select 1
      from public.modulos_instalados
     where modulo = 'integracoes_erp'
  ) then
    perform public.fn_integracoes_erp_provisionar();
  end if;
end
$$;
