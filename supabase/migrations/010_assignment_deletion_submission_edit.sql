-- AulaSegura · Eliminación de tareas y edición segura de entregas
-- El estudiante solo puede modificar su entrega mientras la tarea siga abierta
-- y el profesor todavía no haya publicado una calificación.

create or replace function public.can_edit_own_submission(target_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assignments a
    join public.courses c on c.id = a.course_id
    join public.enrollments e on e.course_id = a.course_id
    where a.id = target_assignment_id
      and a.status = 'published'::public.assignment_status
      and c.status = 'active'::public.course_status
      and e.student_id = auth.uid()
  )
  and not exists (
    select 1
    from public.submissions s
    join public.grades g on g.submission_id = s.id
    where s.assignment_id = target_assignment_id
      and s.student_id = auth.uid()
  );
$$;

revoke execute on function public.can_edit_own_submission(uuid) from public;
grant execute on function public.can_edit_own_submission(uuid) to authenticated;

create or replace function public.protect_submission_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.assignment_id is distinct from old.assignment_id
     or new.student_id is distinct from old.student_id then
    raise exception 'No se puede cambiar la identidad de una entrega.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists submissions_protect_identity on public.submissions;

create trigger submissions_protect_identity
before update on public.submissions
for each row execute function public.protect_submission_identity();

drop policy if exists submissions_insert_own on public.submissions;

create policy submissions_insert_own
on public.submissions for insert
to authenticated
with check (
  student_id = auth.uid()
  and public.can_edit_own_submission(assignment_id)
);

drop policy if exists submissions_update_own on public.submissions;

create policy submissions_update_own
on public.submissions for update
to authenticated
using (
  student_id = auth.uid()
  and public.can_edit_own_submission(assignment_id)
)
with check (
  student_id = auth.uid()
  and public.can_edit_own_submission(assignment_id)
);

drop policy if exists submissions_delete_own on public.submissions;

create policy submissions_delete_own
on public.submissions for delete
to authenticated
using (
  student_id = auth.uid()
  and public.can_edit_own_submission(assignment_id)
);

drop policy if exists submissions_files_insert_student on storage.objects;

create policy submissions_files_insert_student
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'course-files'
  and owner_id = auth.uid()::text
  and (storage.foldername(name))[1] = 'submissions'
  and public.can_edit_own_submission(((storage.foldername(name))[2])::uuid)
);

drop policy if exists submissions_files_select_participant on storage.objects;

create policy submissions_files_select_participant
on storage.objects for select
to authenticated
using (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = 'submissions'
  and (
    (
      owner_id = auth.uid()::text
      and exists (
        select 1
        from public.assignments a
        where a.id = ((storage.foldername(name))[2])::uuid
          and public.is_active_course_member(a.course_id)
      )
    )
    or exists (
      select 1
      from public.assignments a
      where a.id = ((storage.foldername(name))[2])::uuid
        and public.is_course_teacher(a.course_id)
    )
  )
);

drop policy if exists submissions_files_delete_owner_or_teacher on storage.objects;

create policy submissions_files_delete_owner_or_teacher
on storage.objects for delete
to authenticated
using (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = 'submissions'
  and (
    (
      owner_id = auth.uid()::text
      and (
        public.can_edit_own_submission(((storage.foldername(name))[2])::uuid)
        or not exists (
          select 1
          from public.submissions s
          join public.grades g on g.submission_id = s.id
          where s.assignment_id = ((storage.foldername(name))[2])::uuid
            and s.student_id = auth.uid()
            and s.file_path = name
        )
      )
    )
    or exists (
      select 1
      from public.assignments a
      where a.id = ((storage.foldername(name))[2])::uuid
        and public.is_course_teacher(a.course_id)
    )
  )
);

comment on function public.can_edit_own_submission(uuid) is
  'Autoriza crear, actualizar o limpiar una entrega solo si pertenece al estudiante, la tarea está abierta y todavía no existe una calificación.';

comment on function public.protect_submission_identity() is
  'Impide mover una entrega existente a otro estudiante o a otra tarea.';
