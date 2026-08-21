-- AulaSegura · Ciclo de vida seguro del curso
-- Archivar un curso suspende el acceso académico del estudiante a filas y archivos.

create or replace function public.is_active_course_member(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_course_teacher(target_course_id)
  or exists (
    select 1
    from public.enrollments e
    join public.courses c on c.id = e.course_id
    where e.course_id = target_course_id
      and e.student_id = auth.uid()
      and c.status = 'active'::public.course_status
  );
$$;

revoke execute on function public.is_active_course_member(uuid) from public;
grant execute on function public.is_active_course_member(uuid) to authenticated;

drop policy if exists courses_select_member on public.courses;
drop policy if exists courses_select_authorized on public.courses;

create policy courses_select_authorized
on public.courses for select
to authenticated
using (public.is_active_course_member(id));

drop policy if exists assignments_select_member on public.assignments;
drop policy if exists assignments_select_authorized on public.assignments;

create policy assignments_select_authorized
on public.assignments for select
to authenticated
using (
  public.is_course_teacher(course_id)
  or (
    status in ('published'::public.assignment_status, 'closed'::public.assignment_status)
    and public.is_active_course_member(course_id)
  )
);

drop policy if exists submissions_insert_own on public.submissions;

create policy submissions_insert_own
on public.submissions for insert
to authenticated
with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.assignments a
    where a.id = assignment_id
      and a.status = 'published'::public.assignment_status
      and public.is_active_course_member(a.course_id)
  )
);

drop policy if exists submissions_update_own on public.submissions;

create policy submissions_update_own
on public.submissions for update
to authenticated
using (
  student_id = auth.uid()
  and exists (
    select 1 from public.assignments a
    where a.id = assignment_id
      and a.status = 'published'::public.assignment_status
      and public.is_active_course_member(a.course_id)
  )
)
with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.assignments a
    where a.id = assignment_id
      and a.status = 'published'::public.assignment_status
      and public.is_active_course_member(a.course_id)
  )
);

drop policy if exists course_files_select_member on storage.objects;
drop policy if exists course_files_select_authorized on storage.objects;

create policy course_files_select_authorized
on storage.objects for select
to authenticated
using (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = 'assignments'
  and (
    public.is_course_teacher(((storage.foldername(name))[2])::uuid)
    or exists (
      select 1 from public.assignments a
      where a.course_id = ((storage.foldername(name))[2])::uuid
        and a.attachment_path = name
        and a.status in ('published'::public.assignment_status, 'closed'::public.assignment_status)
        and public.is_active_course_member(a.course_id)
    )
  )
);

drop policy if exists submissions_files_insert_student on storage.objects;

create policy submissions_files_insert_student
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'course-files'
  and owner_id = auth.uid()::text
  and (storage.foldername(name))[1] = 'submissions'
  and exists (
    select 1 from public.assignments a
    where a.id = ((storage.foldername(name))[2])::uuid
      and a.status = 'published'::public.assignment_status
      and public.is_active_course_member(a.course_id)
  )
);

drop policy if exists submissions_files_select_participant on storage.objects;

create policy submissions_files_select_participant
on storage.objects for select
to authenticated
using (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = 'submissions'
  and exists (
    select 1 from public.assignments a
    where a.id = ((storage.foldername(name))[2])::uuid
      and public.is_active_course_member(a.course_id)
  )
);

comment on function public.is_active_course_member(uuid) is
  'Permite al profesor conservar acceso y suspende el acceso del estudiante cuando el curso está archivado.';
