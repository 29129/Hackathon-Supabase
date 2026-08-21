-- AulaSegura · Sprint 9
-- Punto único para registrar eventos desde la aplicación sin aceptar actor_id externo.

create or replace function public.log_audit_event(
  event_action text,
  event_entity_type text,
  event_entity_id uuid default null,
  event_metadata jsonb default '{}'::jsonb
)
returns public.audit_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  created_log public.audit_logs;
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), event_action, event_entity_type, event_entity_id, event_metadata)
  returning * into created_log;
  return created_log;
end;
$$;

revoke execute on function public.log_audit_event(text, text, uuid, jsonb) from public;
grant execute on function public.log_audit_event(text, text, uuid, jsonb) to authenticated;
