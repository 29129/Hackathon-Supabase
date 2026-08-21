-- AulaSegura · Flujo seguro de tareas
-- Los borradores son privados del profesor y las tareas cerradas ya no aceptan entregas.

drop policy if exists assignments_select_member on public.assignments;
drop policy if exists assignments_select_authorized on public.assignments;

create policy assignments_select_authorized
on public.assignments for select
to authenticated
using (
  public.is_course_teacher(course_id)
  or (
    status in ('published'::public.assignment_status, 'closed'::public.assignment_status)
    and public.is_course_member(course_id)
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
      and public.is_course_member(a.course_id)
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
  )
)
with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.assignments a
    where a.id = assignment_id
      and a.status = 'published'::public.assignment_status
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
    join public.enrollments e on e.course_id = a.course_id
    where a.id = ((storage.foldername(name))[2])::uuid
      and a.status = 'published'::public.assignment_status
      and e.student_id = auth.uid()
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
        and public.is_course_member(a.course_id)
    )
  )
);

comment on policy assignments_select_authorized on public.assignments is
  'Profesores ven todas sus tareas; estudiantes solo las publicadas o cerradas de cursos matriculados.';
