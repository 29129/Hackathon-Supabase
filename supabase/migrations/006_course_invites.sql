-- AulaSegura · Mejora de producto
-- Códigos de invitación y matrícula autónoma protegida.

create or replace function public.generate_course_code()
returns text
language sql
volatile
as $$
  select upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
$$;

alter table public.courses
add column if not exists invite_code text;

update public.courses
set invite_code = public.generate_course_code()
where invite_code is null;

alter table public.courses
alter column invite_code set default public.generate_course_code();

alter table public.courses
alter column invite_code set not null;

create unique index if not exists courses_invite_code_idx
on public.courses (invite_code);

create or replace function public.join_course_by_code(course_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_course_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para unirte a un curso.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Solo las cuentas de estudiante pueden unirse a cursos.';
  end if;

  select id into target_course_id
  from public.courses
  where invite_code = upper(trim(course_code))
    and status = 'active';

  if target_course_id is null then
    raise exception 'El código no existe o el curso no está activo.';
  end if;

  insert into public.enrollments (course_id, student_id)
  values (target_course_id, auth.uid())
  on conflict (course_id, student_id) do nothing;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'course_joined', 'course', target_course_id, jsonb_build_object('method', 'invite_code'));

  return target_course_id;
end;
$$;

revoke execute on function public.join_course_by_code(text) from public;
grant execute on function public.join_course_by_code(text) to authenticated;
