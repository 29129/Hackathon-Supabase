-- AulaSegura · Matrícula manual administrada por el profesor
-- Sustituye el código de invitación por alta mediante correo institucional.

drop function if exists public.join_course_by_code(text);

create or replace function public.enroll_student_by_email(
  target_course_id uuid,
  student_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(student_email));
  target_student_id uuid;
  new_enrollment_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión como profesor.';
  end if;

  if not public.is_course_teacher(target_course_id) then
    raise exception 'Solo el profesor propietario puede agregar estudiantes a este curso.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.courses c
    where c.id = target_course_id
      and c.status = 'active'::public.course_status
  ) then
    raise exception 'El curso está archivado. Reactívalo antes de agregar estudiantes.';
  end if;

  if normalized_email = '' or position('@' in normalized_email) < 2 then
    raise exception 'Escribe un correo válido.';
  end if;

  select u.id
  into target_student_id
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = normalized_email
    and p.role = 'student'::public.app_role
  limit 1;

  if target_student_id is null then
    raise exception 'No existe una cuenta de estudiante con ese correo.';
  end if;

  if exists (
    select 1
    from public.enrollments e
    where e.course_id = target_course_id
      and e.student_id = target_student_id
  ) then
    raise exception 'El estudiante ya está matriculado en este curso.';
  end if;

  insert into public.enrollments (course_id, student_id)
  values (target_course_id, target_student_id)
  returning id into new_enrollment_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'student_enrolled_manually',
    'enrollment',
    new_enrollment_id,
    jsonb_build_object(
      'course_id', target_course_id,
      'student_id', target_student_id,
      'method', 'teacher_email'
    )
  );

  return new_enrollment_id;
end;
$$;

revoke execute on function public.enroll_student_by_email(uuid, text) from public;
grant execute on function public.enroll_student_by_email(uuid, text) to authenticated;

comment on function public.enroll_student_by_email(uuid, text) is
  'Permite al profesor propietario matricular manualmente una cuenta estudiantil existente mediante su correo.';
