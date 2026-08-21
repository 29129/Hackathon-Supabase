-- AulaSegura · Sprint 4
-- Seguridad por fila. Ejecutar después de 001_initial_schema.sql.

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher'
  );
$$;

create or replace function public.is_course_teacher(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.courses
    where id = target_course_id and teacher_id = auth.uid()
  );
$$;

create or replace function public.is_course_member(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_course_teacher(target_course_id)
  or exists (
    select 1 from public.enrollments
    where course_id = target_course_id and student_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.grades enable row level security;
alter table public.audit_logs enable row level security;

-- Perfiles: cada usuario puede consultar su identidad.
create policy profiles_select_own
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy profiles_update_own
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- El nombre sí puede editarse desde el cliente; el rol se administra de forma controlada.
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Cursos: los profesores administran los suyos; estudiantes ven los matriculados.
create policy courses_select_member
on public.courses for select
to authenticated
using (public.is_course_member(id));

create policy courses_insert_teacher
on public.courses for insert
to authenticated
with check (public.is_teacher() and teacher_id = auth.uid());

create policy courses_update_owner
on public.courses for update
to authenticated
using (teacher_id = auth.uid())
with check (teacher_id = auth.uid());

create policy courses_delete_owner
on public.courses for delete
to authenticated
using (teacher_id = auth.uid());

-- Matrículas: el estudiante ve las suyas; el profesor ve las de sus cursos.
create policy enrollments_select_participant
on public.enrollments for select
to authenticated
using (student_id = auth.uid() or public.is_course_teacher(course_id));

create policy enrollments_insert_teacher
on public.enrollments for insert
to authenticated
with check (public.is_course_teacher(course_id));

create policy enrollments_delete_teacher
on public.enrollments for delete
to authenticated
using (public.is_course_teacher(course_id));

-- Tareas: visibles solo para miembros del curso; solo el profesor las modifica.
create policy assignments_select_member
on public.assignments for select
to authenticated
using (public.is_course_member(course_id));

create policy assignments_insert_teacher
on public.assignments for insert
to authenticated
with check (
  public.is_course_teacher(course_id)
  and created_by = auth.uid()
);

create policy assignments_update_teacher
on public.assignments for update
to authenticated
using (public.is_course_teacher(course_id))
with check (public.is_course_teacher(course_id));

create policy assignments_delete_teacher
on public.assignments for delete
to authenticated
using (public.is_course_teacher(course_id));

-- Entregas: cada estudiante ve y modifica las suyas; el profesor las revisa.
create policy submissions_select_participant
on public.submissions for select
to authenticated
using (
  student_id = auth.uid()
  or exists (
    select 1 from public.assignments a
    where a.id = assignment_id and public.is_course_teacher(a.course_id)
  )
);

create policy submissions_insert_own
on public.submissions for insert
to authenticated
with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.assignments a
    where a.id = assignment_id and public.is_course_member(a.course_id)
  )
);

create policy submissions_update_own
on public.submissions for update
to authenticated
using (student_id = auth.uid())
with check (student_id = auth.uid());

create policy submissions_delete_own
on public.submissions for delete
to authenticated
using (student_id = auth.uid());

-- Calificaciones: el alumno solo ve la suya; el profesor califica sus cursos.
create policy grades_select_participant
on public.grades for select
to authenticated
using (
  exists (
    select 1 from public.submissions s
    where s.id = submission_id
    and (
      s.student_id = auth.uid()
      or exists (
        select 1 from public.assignments a
        where a.id = s.assignment_id and public.is_course_teacher(a.course_id)
      )
    )
  )
);

create policy grades_insert_teacher
on public.grades for insert
to authenticated
with check (
  graded_by = auth.uid()
  and public.is_teacher()
  and exists (
    select 1 from public.submissions s
    join public.assignments a on a.id = s.assignment_id
    where s.id = submission_id and public.is_course_teacher(a.course_id)
  )
);

create policy grades_update_teacher
on public.grades for update
to authenticated
using (graded_by = auth.uid())
with check (graded_by = auth.uid());

create policy grades_delete_teacher
on public.grades for delete
to authenticated
using (graded_by = auth.uid());

-- Auditoría: cualquier usuario autenticado puede registrar sus acciones,
-- pero solo puede consultar y conservar las propias desde el cliente.
create policy audit_logs_insert_own
on public.audit_logs for insert
to authenticated
with check (actor_id = auth.uid());

create policy audit_logs_select_own
on public.audit_logs for select
to authenticated
using (actor_id = auth.uid());

revoke update, delete on public.audit_logs from authenticated;

comment on function public.is_course_member(uuid) is 'Devuelve true si el usuario actual es profesor o estudiante matriculado en el curso.';
