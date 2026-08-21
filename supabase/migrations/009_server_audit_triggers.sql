-- AulaSegura · Auditoría automática en la base de datos
-- Ejecutar después de 008_course_lifecycle_rls.sql.
-- Registra cambios académicos aunque la operación no provenga de la interfaz.

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_row jsonb;
  changed_id uuid;
begin
  if tg_op = 'DELETE' then
    changed_row := to_jsonb(old);
  else
    changed_row := to_jsonb(new);
  end if;

  changed_id := nullif(changed_row ->> 'id', '')::uuid;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    auth.uid(),
    tg_table_name || '_' || lower(tg_op),
    tg_table_name,
    changed_id,
    jsonb_build_object(
      'source', 'database_trigger',
      'operation', lower(tg_op)
    )
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_row_change() from public, anon, authenticated;

drop trigger if exists courses_audit_changes on public.courses;
create trigger courses_audit_changes
after insert or update or delete on public.courses
for each row execute function public.audit_row_change();

drop trigger if exists enrollments_audit_changes on public.enrollments;
create trigger enrollments_audit_changes
after insert or update or delete on public.enrollments
for each row execute function public.audit_row_change();

drop trigger if exists assignments_audit_changes on public.assignments;
create trigger assignments_audit_changes
after insert or update or delete on public.assignments
for each row execute function public.audit_row_change();

drop trigger if exists submissions_audit_changes on public.submissions;
create trigger submissions_audit_changes
after insert or update or delete on public.submissions
for each row execute function public.audit_row_change();

drop trigger if exists grades_audit_changes on public.grades;
create trigger grades_audit_changes
after insert or update or delete on public.grades
for each row execute function public.audit_row_change();

create index if not exists audit_logs_actor_created_at_idx
on public.audit_logs (actor_id, created_at desc);

comment on function public.audit_row_change() is
  'Registra INSERT, UPDATE y DELETE académicos desde PostgreSQL sin guardar contenido sensible de las filas.';
