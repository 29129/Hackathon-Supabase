# AulaSegura

Portal académico privado para colegios, construido para la hackathon de Supabase.

## Sprint 1

La base visual está implementada con HTML, CSS y JavaScript sin dependencias. Incluye el shell responsive del portal, navegación inicial, dashboard del estudiante con datos de demostración y una señal visual de privacidad.

Próximo sprint: crear el esquema de datos y relaciones académicas.

## Sprint 2

Se añadió una pantalla de autenticación con inicio de sesión, registro, selección de rol y cierre de sesión. La integración usa `@supabase/supabase-js` desde CDN.

### Configuración local

1. Copia `config.example.js` como `config.js`.
2. Entra en Supabase → Project Settings → API.
3. Completa `url` y `anonKey` en `config.js`.
4. Abre `index.html` mediante un servidor local.

`config.js` está ignorado por Git porque contiene la configuración local del proyecto. La anon key está diseñada para frontend, pero nunca se debe incluir una service role key.

## Sprint 3

Se añadió `supabase/migrations/001_initial_schema.sql` con el modelo académico y el trigger de perfiles para nuevos usuarios. Ejecuta la migración desde el SQL Editor de Supabase antes de probar el registro. El siguiente sprint añadirá las políticas RLS.

## Sprint 4

Se añadió `supabase/migrations/002_rls_policies.sql`. Esta migración habilita RLS en todas las tablas y restringe cursos, tareas, entregas, calificaciones y auditoría según el usuario autenticado. Debe ejecutarse después de la migración 001.

## Sprint 5

Se añadió el dashboard del profesor. Los usuarios con rol `teacher` pueden consultar sus cursos y crear nuevos cursos desde la interfaz. Las operaciones usan Supabase y quedan protegidas por las políticas RLS de la migración 002.
