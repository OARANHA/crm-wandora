-- 0506 — Customer Resolution: nome único compatível vindo do provider.
-- Corrige o canário real em que Pessoas/Pesquisar devolveu candidatos para "Eco Projetos",
-- mas nenhum rótulo era igualdade exata. Uma palavra só nunca autoriza materialização;
-- múltiplos candidatos continuam ambíguos. Documento/e-mail permanecem exatos.

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
    label text not null default 'VendaERP' check (char_length(btrim(label)) between 1 and 120),
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
    access_mode text not null default 'read' check (access_mode in ('read', 'write', 'destructive')),
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
  create index if not exists erp_connections_org_idx on public.erp_connections (organization_id);
  alter table public.erp_connections enable row level security;
  revoke all on public.erp_connections from anon, authenticated;
  comment on table public.erp_connections is
    'Conexões de ERP por organização. Credenciais cifradas; acesso somente pelas rotas autorizadas do host.';

  create table if not exists public.erp_admin_whatsapp_bindings (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    phone_e164 text not null check (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
    capability text not null default 'erp.admin.read' check (capability = 'erp.admin.read'),
    enabled boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint erp_admin_whatsapp_bindings_org_user_unique unique (organization_id, user_id),
    constraint erp_admin_whatsapp_bindings_org_phone_unique unique (organization_id, phone_e164)
  );
  alter table public.erp_admin_whatsapp_bindings enable row level security;
  revoke all on public.erp_admin_whatsapp_bindings from anon, authenticated;
  comment on table public.erp_admin_whatsapp_bindings is
    'Vínculo explícito entre número remetente do WhatsApp e usuário admin do Elus para consultas ERP read-only.';

  create table if not exists public.erp_customer_identity_links (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    contact_id uuid not null references public.contacts(id) on delete cascade,
    provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,40}$'),
    external_entity_type text not null default 'customer' check (external_entity_type = 'customer'),
    external_id text not null check (char_length(btrim(external_id)) between 1 and 200),
    external_label text not null check (char_length(btrim(external_label)) between 1 and 240),
    external_label_key text not null check (char_length(btrim(external_label_key)) between 1 and 240),
    provider_lookup_label text not null check (char_length(btrim(provider_lookup_label)) between 1 and 240),
    status text not null default 'active' check (status in ('active', 'invalid')),
    resolution_origin text not null
      check (resolution_origin in ('exact_document','exact_email','exact_name','provider_unique_name','existing_contact','corrected')),
    evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
    last_verified_at timestamptz not null default now(),
    invalidated_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint erp_customer_identity_links_status_consistency check (
      (status = 'active' and invalidated_at is null)
      or (status = 'invalid' and invalidated_at is not null)
    )
  );
  create unique index if not exists erp_customer_identity_active_external_unique
    on public.erp_customer_identity_links
      (organization_id, provider, external_entity_type, external_id)
    where status = 'active';
  create unique index if not exists erp_customer_identity_active_contact_unique
    on public.erp_customer_identity_links
      (organization_id, contact_id, provider, external_entity_type)
    where status = 'active';
  create index if not exists erp_customer_identity_lookup_idx
    on public.erp_customer_identity_links (organization_id, provider, external_label_key)
    where status = 'active';
  alter table public.erp_customer_identity_links enable row level security;
  revoke all on public.erp_customer_identity_links from anon, authenticated;
  comment on table public.erp_customer_identity_links is
    'Vínculo server-only contato Elus ↔ cliente externo do ERP. external_id é autoridade; rótulos são somente descoberta/lookup.';

  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

revoke execute on function public.fn_integracoes_erp_provisionar() from public, anon, authenticated;
grant execute on function public.fn_integracoes_erp_provisionar() to service_role;

do $$
begin
  -- Instalações com o módulo ativo recebem a tabela antes de atualizar a CHECK.
  if exists (
    select 1
      from public.modulos_instalados
     where modulo = 'integracoes_erp'
       and estado = 'ativo'
  ) then
    perform public.fn_integracoes_erp_provisionar();
  end if;

  -- O módulo é opcional: sem a tabela, a migration precisa passar limpa.
  if to_regclass('public.erp_customer_identity_links') is not null then
    execute 'alter table public.erp_customer_identity_links
               drop constraint if exists erp_customer_identity_links_resolution_origin_check';
    execute 'alter table public.erp_customer_identity_links
               add constraint erp_customer_identity_links_resolution_origin_check
               check (resolution_origin in (
                 ''exact_document'',''exact_email'',''exact_name'',''provider_unique_name'',
                 ''existing_contact'',''corrected''
               ))';
  end if;
end
$$;

create or replace function public.fn_integracoes_erp_vincular_cliente(
  p_organization_id uuid,
  p_contact_id uuid,
  p_provider text,
  p_external_id text,
  p_external_label text,
  p_external_label_key text,
  p_provider_lookup_label text,
  p_resolution_origin text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_link record;
  v_contact_id uuid;
  v_created_contact boolean := false;
begin
  if p_organization_id is null
     or btrim(coalesce(p_provider, '')) = ''
     or btrim(coalesce(p_external_id, '')) = ''
     or btrim(coalesce(p_external_label, '')) = ''
     or btrim(coalesce(p_external_label_key, '')) = ''
     or btrim(coalesce(p_provider_lookup_label, '')) = ''
     or p_resolution_origin not in ('exact_document','exact_email','exact_name','provider_unique_name','existing_contact','corrected')
     or jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) <> 'object' then
    raise exception 'erp_customer_identity_invalid_input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'erp_customer_identity:' || p_organization_id::text || ':' || p_provider || ':' || p_external_id,
      0
    )
  );

  select * into v_link
    from public.erp_customer_identity_links
   where organization_id = p_organization_id
     and provider = p_provider
     and external_entity_type = 'customer'
     and external_id = p_external_id
     and status = 'active'
   for update;

  if found then
    if p_contact_id is not null and v_link.contact_id <> p_contact_id then
      raise exception 'erp_customer_identity_conflict' using errcode = '23505';
    end if;
    update public.erp_customer_identity_links
       set external_label = p_external_label,
           external_label_key = p_external_label_key,
           provider_lookup_label = p_provider_lookup_label,
           evidence = evidence || coalesce(p_evidence, '{}'::jsonb),
           last_verified_at = now(),
           updated_at = now()
     where id = v_link.id
     returning * into v_link;
    return jsonb_build_object(
      'link_id', v_link.id, 'contact_id', v_link.contact_id,
      'created_link', false, 'created_contact', false
    );
  end if;

  if p_contact_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('erp_contact:' || p_contact_id::text, 0));
    select id into v_contact_id
      from public.contacts
     where id = p_contact_id
       and organization_id = p_organization_id
       and is_anonymized = false
       and is_merged_into is null
     for update;
    if not found then
      raise exception 'erp_customer_contact_invalid' using errcode = '22023';
    end if;
  else
    insert into public.contacts (organization_id, name, display_name, source, source_metadata)
    values (
      p_organization_id, p_external_label, p_external_label, 'erp',
      jsonb_build_object('materialized_by', 'customer_resolution')
    )
    returning id into v_contact_id;
    v_created_contact := true;
  end if;

  select * into v_link
    from public.erp_customer_identity_links
   where organization_id = p_organization_id
     and contact_id = v_contact_id
     and provider = p_provider
     and external_entity_type = 'customer'
     and status = 'active'
   for update;

  if found then
    if v_link.external_id <> p_external_id then
      raise exception 'erp_customer_contact_already_linked' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'link_id', v_link.id, 'contact_id', v_link.contact_id,
      'created_link', false, 'created_contact', v_created_contact
    );
  end if;

  insert into public.erp_customer_identity_links (
    organization_id, contact_id, provider, external_entity_type,
    external_id, external_label, external_label_key, provider_lookup_label,
    status, resolution_origin, evidence
  )
  values (
    p_organization_id, v_contact_id, p_provider, 'customer',
    p_external_id, p_external_label, p_external_label_key, p_provider_lookup_label,
    'active', p_resolution_origin, coalesce(p_evidence, '{}'::jsonb)
  )
  returning * into v_link;

  return jsonb_build_object(
    'link_id', v_link.id, 'contact_id', v_link.contact_id,
    'created_link', true, 'created_contact', v_created_contact
  );
exception
  when unique_violation then
    raise exception 'erp_customer_identity_conflict' using errcode = '23505';
end;
$f$;

revoke execute on function public.fn_integracoes_erp_vincular_cliente(
  uuid, uuid, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.fn_integracoes_erp_vincular_cliente(
  uuid, uuid, text, text, text, text, text, text, jsonb
) to service_role;
