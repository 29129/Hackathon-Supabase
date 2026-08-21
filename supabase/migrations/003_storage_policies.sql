-- AulaSegura · Sprint 7
-- Bucket privado para archivos académicos y políticas por curso.

insert into storage.buckets (id, name, public)
values ('course-files', 'course-files', false)
on conflict (id) do update set public = false;

create policy course_files_insert_teacher
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'course-files'
  and owner_id = auth.uid()::text
  and (storage.foldername(name))[1] = 'assignments'
  and public.is_course_teacher(((storage.foldername(name))[2])::uuid)
);

create policy course_files_select_member
on storage.objects for select
to authenticated
using (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = 'assignments'
  and public.is_course_member(((storage.foldername(name))[2])::uuid)
);

create policy course_files_update_teacher
on storage.objects for update
to authenticated
using (
  bucket_id = 'course-files'
  and owner_id = auth.uid()::text
  and public.is_course_teacher(((storage.foldername(name))[2])::uuid)
)
with check (
  bucket_id = 'course-files'
  and owner_id = auth.uid()::text
  and public.is_course_teacher(((storage.foldername(name))[2])::uuid)
);

create policy course_files_delete_teacher
on storage.objects for delete
to authenticated
using (
  bucket_id = 'course-files'
  and owner_id = auth.uid()::text
  and public.is_course_teacher(((storage.foldername(name))[2])::uuid)
);
