-- 0504 — entrega governada cross-conversation para documento já resolvido.
--
-- O job carrega a fronteira da CONVERSA DESTINO capturada por fn_service_boundary.
-- Nenhum telefone/URL externa entra na fila. A unicidade por job de origem +
-- operação + NFe impede retry/tool replay de agendar o mesmo envio duas vezes.

alter table public.job_queue drop constraint if exists job_queue_kind_check;
alter table public.job_queue add constraint job_queue_kind_check
  check (kind in (
    'inbound_turn','followup_turn','watchdog','flywheel','case_reply_turn',
    'operator_turn','transactional_delivery','approved_reply','governed_delivery'
  ));

alter table public.job_queue drop constraint if exists job_queue_turn_needs_contact;
alter table public.job_queue add constraint job_queue_turn_needs_contact
  check ((
    kind in (
      'inbound_turn','followup_turn','case_reply_turn','operator_turn',
      'transactional_delivery','approved_reply','governed_delivery'
    )
  ) = (contact_id is not null));

create unique index if not exists uniq_job_queue_governed_delivery_origin_invoice
  on public.job_queue (
    organization_id,
    ((payload->>'origin_job_id')),
    ((payload->>'operation')),
    ((payload->>'codigo_nfe'))
  )
  where kind='governed_delivery';
