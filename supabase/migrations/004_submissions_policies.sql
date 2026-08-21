-- AulaSegura · Sprint 8
-- Permisos para entregas de estudiantes y revisión de profesores.

create policy profiles_select_teacher_students
on public.profiles for select
to authenticated
using (
  exists (
    select 1 from public.enrollments e
    join public.courses c on c.id = e.course_id
    where e.student_id = profiles.id and c.teacher_id = auth.uid()
  )
);

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
      and e.student_id = auth.uid()
  )
);

create policy submissions_files_select_participant
on storage.objects for select
to authenticated
using (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = 'submissions'
  and exists (
    select 1 from public.assignments a
    where a.id = ((storage.foldername(name))[2])::uuid
      and public.is_course_member(a.course_id)
  )
);

create policy submissions_files_delete_owner_or_teacher
on storage.objects for delete
to authenticated
using (
  bucket_id = 'course-files'
  and (
    owner_id = auth.uid()::text
    or exists (
      select 1 from public.assignments a
      where a.id = ((storage.foldername(name))[2])::uuid
        and public.is_course_teacher(a.course_id)
    )
  )
);
