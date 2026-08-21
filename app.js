const config = window.SUPABASE_CONFIG || {};
const hasSupabaseConfig = config.url && config.anonKey && !config.url.includes('TU-PROYECTO');
const supabaseClient = hasSupabaseConfig && window.supabase
  ? window.supabase.createClient(config.url, config.anonKey)
  : null;

const authScreen = document.getElementById('auth-screen');
const appShell = document.querySelector('.app-shell');
const authForm = document.getElementById('auth-form');
const authFeedback = document.getElementById('auth-feedback');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const authSubmitLabel = document.getElementById('auth-submit-label');
const logoutButton = document.getElementById('logout-button');
const fullNameInput = document.getElementById('full-name');
const roleInput = document.getElementById('role');
const modeTabs = document.querySelectorAll('[data-auth-mode]');
const signupFields = document.querySelectorAll('.signup-only');
let authMode = 'login';
let currentUser = null;
let currentProfile = {};
let currentCourseDetailId = null;
let courseDetailRequest = 0;
let taskModalRequest = 0;
let securityAuditRows = [];
let securitySuiteRunning = false;
let notificationItems = [];
let notificationFilter = 'all';

function showToast(message) {
  const toast = document.getElementById('app-toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 2800);
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark-theme', isDark);
  const button = document.getElementById('theme-toggle');
  button.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  button.innerHTML = isDark ? '☀ <span>Modo claro</span>' : '◐ <span>Modo oscuro</span>';
  localStorage.setItem('aulasegura-theme', isDark ? 'dark' : 'light');
}

function withTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => window.setTimeout(() => reject(new Error(message)), milliseconds))
  ]);
}

function showMessage(message, type = '') {
  authFeedback.textContent = message;
  authFeedback.className = `auth-feedback ${type}`;
}

function setAuthenticated(user, profile = {}) {
  currentUser = user;
  currentProfile = profile;
  currentCourseDetailId = null;
  hideWorkspaceSections();
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  logoutButton.classList.remove('hidden');
  const name = profile.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Estudiante';
  const role = profile.role || user.user_metadata?.role || 'student';
  const roleLabel = role === 'teacher' ? 'Profesor/a' : 'Estudiante';
  document.querySelector('.profile-chip strong').textContent = name;
  document.querySelector('.profile-chip small').textContent = roleLabel;
  document.querySelector('.avatar').textContent = name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  document.getElementById('welcome-copy').textContent = `Aquí tienes un vistazo de tu actividad académica, ${name.split(' ')[0]}.`;
  document.querySelector('.page-heading h1').innerHTML = `Buenos días, ${name.split(' ')[0]} <span>✦</span>`;
  document.getElementById('workspace-new-course').classList.toggle('hidden', role !== 'teacher');
  document.getElementById('workspace-new-task').classList.toggle('hidden', role !== 'teacher');
  document.getElementById('join-course-form').classList.toggle('hidden', role !== 'student');
  notificationFilter = 'all';
  setNotificationItems([]);
  document.getElementById('task-search').value = '';
  document.getElementById('task-status-filter').innerHTML = role === 'teacher'
    ? '<option value="all">Todos los estados</option><option value="published">Publicadas</option><option value="draft">Borradores</option><option value="closed">Cerradas</option>'
    : '<option value="all">Todas las tareas</option><option value="pending">Pendientes</option><option value="submitted">Entregadas</option><option value="closed">Cerradas</option>';
  securityAuditRows = [];
  resetSecurityChecks();
  showRoleView(role);
  loadAuditLogs();
}

function showLoggedOut() {
  closeNotificationCenter();
  currentUser = null;
  currentProfile = {};
  currentCourseDetailId = null;
  courseDetailRequest += 1;
  taskModalRequest += 1;
  securityAuditRows = [];
  securitySuiteRunning = false;
  notificationItems = [];
  updateNotificationIndicator();
  document.getElementById('task-modal').classList.add('hidden');
  document.getElementById('submission-modal').classList.add('hidden');
  document.getElementById('course-detail-content').innerHTML = '<div class="detail-loading"><span></span><p>Cargando espacio protegido...</p></div>';
  authScreen.classList.remove('hidden');
  appShell.classList.add('hidden');
  logoutButton.classList.add('hidden');
}

function showRoleView(role, loadData = true) {
  const isTeacher = role === 'teacher';
  document.querySelector('.page-heading').classList.toggle('hidden', isTeacher);
  document.querySelector('.stats-grid').classList.toggle('hidden', isTeacher);
  document.querySelector('.dashboard-grid').classList.toggle('hidden', isTeacher);
  document.getElementById('role-help').classList.toggle('hidden', isTeacher);
  document.getElementById('teacher-view').classList.toggle('hidden', !isTeacher);
  if (loadData && isTeacher) loadTeacherCourses();
  else if (loadData) loadStudentDashboard();
}

function hideWorkspaceSections() {
  document.querySelectorAll('.workspace-view').forEach((section) => section.classList.add('hidden'));
}

function studentSubmissionAction(assignment, submission, buttonClass = 'detail-action-button', labels = {}) {
  const grade = relatedOne(submission?.grades);
  if (grade) return '<span class="grade-chip">Calificada</span>';
  if (submission && assignment.status === 'published') {
    return `<button class="${buttonClass}" type="button" data-edit-submission-assignment="${assignment.id}" data-submit-title="${escapeHtml(assignment.title)}">${labels.edit || 'Editar entrega'}</button>`;
  }
  if (submission) return '<span class="grade-chip neutral">Entregada</span>';
  if (assignment.status === 'closed') return '<span class="task-status-pill closed">Cerrada</span>';
  return `<button class="${buttonClass}" type="button" data-submit-assignment="${assignment.id}" data-submit-title="${escapeHtml(assignment.title)}">${labels.create || 'Entregar'}</button>`;
}

function renderStudentSpaces(courses, assignments, submissionByAssignment = new Map()) {
  document.getElementById('space-course-list').innerHTML = courses.length
    ? courses.map((course) => `<article class="workspace-card"><span class="course-icon">${escapeHtml(course.subject.slice(0, 3).toUpperCase())}</span><div><strong>${escapeHtml(course.name)}</strong><small>${escapeHtml(course.subject)} · ${escapeHtml(course.description || 'Curso activo')}</small></div><div class="workspace-card-actions"><span class="course-status">Activo</span><button class="course-open-button" type="button" data-open-course="${course.id}">Ver curso →</button></div></article>`).join('')
    : '<div class="empty-state">No tienes cursos asignados todavía.</div>';
  document.getElementById('space-task-list').innerHTML = assignments.length
    ? assignments.map((assignment) => {
        const submission = submissionByAssignment.get(assignment.id);
        const state = submission ? 'submitted' : assignment.status === 'closed' ? 'closed' : 'pending';
        const searchText = `${assignment.title} ${assignment.courses?.name || ''} ${assignment.description || ''}`.toLowerCase();
        const stateAction = studentSubmissionAction(assignment, submission);
        return `<article class="workspace-row task-workspace-row" data-task-row data-task-status="${state}" data-search-text="${escapeHtml(searchText)}"><span class="task-state-dot ${state}"></span><div><strong>${escapeHtml(assignment.title)}</strong><small>${escapeHtml(assignment.courses?.name || 'Curso')} · ${assignmentStatusLabel(assignment.status)} · Entrega: ${formatDueDate(assignment.due_at)}</small><p>${escapeHtml(assignment.description || 'Consulta los detalles de esta actividad.')}</p></div><div class="workspace-actions"><button class="task-detail-button" type="button" data-view-assignment="${assignment.id}">Detalles</button>${assignment.attachment_path ? `<button class="file-link" type="button" data-file-path="${escapeHtml(assignment.attachment_path)}">Archivo</button>` : ''}${stateAction}</div></article>`;
      }).join('')
    : '<div class="empty-state">No hay tareas publicadas.</div>';
  const files = assignments.filter((assignment) => assignment.attachment_path);
  document.getElementById('space-file-list').innerHTML = files.length
    ? files.map((assignment) => `<article class="workspace-row"><div><strong>${escapeHtml(assignment.title)}</strong><small>${escapeHtml(assignment.courses?.name || 'Curso')}</small></div><button class="file-link" type="button" data-file-path="${escapeHtml(assignment.attachment_path)}">Abrir archivo</button></article>`).join('')
    : '<div class="empty-state">Los archivos de tus tareas aparecerán aquí.</div>';
  filterTaskWorkspace();
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function formatDueDate(value) {
  if (!value) return 'Sin fecha';
  const parts = String(value).slice(0, 10).split('-').map(Number);
  const date = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return 'Hoy';
  if (date.toDateString() === tomorrow.toDateString()) return 'Mañana';
  if (date < today) return `Vencida · ${date.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })}`;
  return date.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
}

function subjectClass(subject = '') {
  const first = subject.toLowerCase()[0] || 'a';
  return first < 'h' ? 'orange' : first < 'r' ? 'violet' : 'teal';
}

function relatedOne(value) {
  return Array.isArray(value) ? value[0] : value;
}

function initials(value = 'Estudiante') {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'ES';
}

function formatLongDate(value) {
  if (!value) return 'Sin fecha definida';
  return new Date(value).toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatAssignmentDate(value) {
  if (!value) return 'Sin fecha definida';
  const parts = String(value).slice(0, 10).split('-').map(Number);
  const date = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(value);
  return date.toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' });
}

function dateInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function assignmentStatusLabel(status) {
  return ({ published: 'Publicada', draft: 'Borrador', closed: 'Cerrada' })[status] || 'Sin estado';
}

function courseStatusLabel(status) {
  return status === 'archived' ? 'Archivado' : 'Activo';
}

function filterTaskWorkspace() {
  const list = document.getElementById('space-task-list');
  const search = document.getElementById('task-search').value.trim().toLowerCase();
  const status = document.getElementById('task-status-filter').value;
  const rows = [...list.querySelectorAll('[data-task-row]')];
  let visible = 0;
  rows.forEach((row) => {
    const matchesText = !search || row.dataset.searchText.includes(search);
    const matchesStatus = status === 'all' || row.dataset.taskStatus === status;
    const show = matchesText && matchesStatus;
    row.classList.toggle('hidden', !show);
    if (show) visible += 1;
  });
  document.getElementById('task-result-count').textContent = `${visible} ${visible === 1 ? 'tarea' : 'tareas'}`;
  document.getElementById('task-filter-empty').classList.toggle('hidden', !rows.length || visible > 0);
}

async function logAudit(action, entityType, metadata = {}) {
  if (!supabaseClient || !currentUser) return;
  try {
    await withTimeout(supabaseClient.rpc('log_audit_event', { event_action: action, event_entity_type: entityType, event_metadata: metadata }), 10000, 'La auditoría tardó demasiado.');
    await loadAuditLogs();
  } catch (error) {
    console.warn('No se pudo registrar la auditoría:', error.message);
  }
}

async function loadAuditLogs() {
  if (!supabaseClient || !currentUser) return;
  const { data } = await supabaseClient.from('audit_logs').select('action, entity_type, created_at').eq('actor_id', currentUser.id).order('created_at', { ascending: false }).limit(4);
  const list = document.getElementById('audit-list');
  if (!data?.length) {
    list.innerHTML = '<small>Sin actividad reciente.</small>';
    return;
  }
  list.innerHTML = data.map((log) => `<div class="audit-row"><span class="audit-icon">✓</span><span>${escapeHtml(auditActionLabel(log.action))}</span><span class="audit-time">${new Date(log.created_at).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('');
}

async function runDeniedAccessTest(resultId = 'security-result') {
  const result = document.getElementById(resultId);
  if (!result || !currentUser) return;
  result.textContent = 'Comprobando permisos...';
  result.className = 'security-result';
  const role = currentProfile.role || currentUser.user_metadata?.role || 'student';
  const request = role === 'teacher'
    ? supabaseClient.from('courses').select('id').neq('teacher_id', currentUser.id).limit(1)
    : supabaseClient.from('profiles').select('id, full_name').neq('id', currentUser.id).limit(1);
  const { data, error } = await request;
  if (error) {
    result.textContent = `La política bloqueó la consulta: ${error.message}`;
    result.className = 'security-result denied';
    await logAudit('denied_access_test', 'profiles', { result: 'blocked_error' });
    return;
  }
  if (!data?.length) {
    result.textContent = role === 'teacher'
      ? '✓ Acceso bloqueado: no puedes consultar cursos administrados por otro profesor.'
      : '✓ Acceso bloqueado: no puedes consultar perfiles ajenos.';
    result.className = 'security-result denied';
    await logAudit('denied_access_test', 'profiles', { result: 'blocked_empty' });
  } else {
    result.textContent = '⚠ Revisa las políticas RLS: la consulta devolvió una fila no autorizada.';
    result.className = 'security-result';
    await logAudit('denied_access_test', 'profiles', { result: 'unexpected_access' });
  }
}

const securityCheckIds = [
  'security-check-auth',
  'security-check-own',
  'security-check-read',
  'security-check-role',
  'security-check-storage'
];

function setSecurityCheck(checkId, state = 'pending', message = '') {
  const card = document.getElementById(checkId);
  if (!card) return;
  const icon = card.querySelector('.security-check-icon');
  const description = card.querySelector('small');
  const status = card.querySelector('b');
  if (!card.dataset.defaultIcon) card.dataset.defaultIcon = icon.textContent;
  if (!card.dataset.defaultMessage) card.dataset.defaultMessage = description.textContent;
  card.classList.remove('running', 'passed', 'failed');
  if (state !== 'pending') card.classList.add(state);
  icon.textContent = ({ running: '…', passed: '✓', failed: '!' })[state] || card.dataset.defaultIcon;
  description.textContent = message || card.dataset.defaultMessage;
  status.textContent = ({ running: 'Comprobando', passed: 'Protegido', failed: 'Revisar' })[state] || 'Pendiente';
}

function resetSecurityChecks() {
  securityCheckIds.forEach((checkId) => setSecurityCheck(checkId));
  const summary = document.getElementById('security-suite-summary');
  if (summary) {
    summary.className = '';
    summary.textContent = 'Listos para comprobar los permisos de esta cuenta.';
  }
}

async function executeSecurityCheck(checkId, test) {
  setSecurityCheck(checkId, 'running', 'Consultando Supabase en tiempo real...');
  try {
    const result = await test();
    setSecurityCheck(checkId, result.passed ? 'passed' : 'failed', result.message);
    return result.passed;
  } catch (error) {
    setSecurityCheck(checkId, 'failed', error.message || 'No se pudo completar esta comprobación.');
    return false;
  }
}

async function runSecuritySuite() {
  if (securitySuiteRunning || !supabaseClient || !currentUser) return;
  securitySuiteRunning = true;
  resetSecurityChecks();
  const button = document.getElementById('run-security-suite');
  const summary = document.getElementById('security-suite-summary');
  button.disabled = true;
  button.innerHTML = 'Ejecutando <span>•••</span>';
  summary.className = 'running';
  summary.textContent = 'Ejecutando consultas reales con la sesión actual...';
  let passed = 0;

  const authPassed = await executeSecurityCheck('security-check-auth', async () => {
    const { data, error } = await withTimeout(supabaseClient.auth.getSession(), 10000, 'Auth no respondió a tiempo.');
    if (error) throw error;
    const sessionUser = data.session?.user;
    const valid = Boolean(data.session?.access_token && sessionUser?.id === currentUser.id);
    return {
      passed: valid,
      message: valid ? 'Token vigente y vinculado a esta cuenta.' : 'La sesión no coincide con el usuario de la interfaz.'
    };
  });
  if (authPassed) passed += 1;

  const ownReadPassed = await executeSecurityCheck('security-check-own', async () => {
    const { data, error } = await withTimeout(
      supabaseClient.from('profiles').select('id, full_name, role').eq('id', currentUser.id).maybeSingle(),
      10000,
      'La lectura del perfil tardó demasiado.'
    );
    if (error) throw error;
    const valid = data?.id === currentUser.id;
    return {
      passed: valid,
      message: valid ? 'RLS permitió leer únicamente la identidad autorizada.' : 'No se pudo recuperar el perfil propio.'
    };
  });
  if (ownReadPassed) passed += 1;

  const deniedReadPassed = await executeSecurityCheck('security-check-read', async () => {
    const role = currentProfile.role || currentUser.user_metadata?.role || 'student';
    const request = role === 'teacher'
      ? supabaseClient.from('courses').select('id').neq('teacher_id', currentUser.id).limit(1)
      : supabaseClient.from('profiles').select('id').neq('id', currentUser.id).limit(1);
    const { data, error } = await withTimeout(request, 10000, 'La prueba RLS tardó demasiado.');
    const blocked = Boolean(error) || !data?.length;
    return {
      passed: blocked,
      message: blocked
        ? (role === 'teacher' ? 'RLS ocultó los cursos administrados por otros docentes.' : 'RLS ocultó los perfiles de usuarios ajenos.')
        : 'La consulta devolvió una fila que debería estar fuera de alcance.'
    };
  });
  if (deniedReadPassed) passed += 1;

  const identityPassed = await executeSecurityCheck('security-check-role', async () => {
    const protectedId = crypto.randomUUID();
    const attempt = await withTimeout(
      supabaseClient.from('profiles').update({ id: protectedId }).eq('id', currentUser.id).select('id'),
      10000,
      'La prueba de identidad tardó demasiado.'
    );
    const verification = await withTimeout(
      supabaseClient.from('profiles').select('id').eq('id', currentUser.id).maybeSingle(),
      10000,
      'No se pudo verificar la identidad después de la prueba.'
    );
    if (verification.error) throw verification.error;
    const unchanged = verification.data?.id === currentUser.id;
    const blocked = Boolean(attempt.error) || !attempt.data?.length;
    return {
      passed: blocked && unchanged,
      message: blocked && unchanged
        ? 'La base bloqueó el cambio y el identificador permanece intacto.'
        : 'El identificador protegido no superó la verificación posterior.'
    };
  });
  if (identityPassed) passed += 1;

  const storagePassed = await executeSecurityCheck('security-check-storage', async () => {
    const inaccessiblePath = `assignments/${crypto.randomUUID()}/${currentUser.id}/${crypto.randomUUID()}-private-probe.txt`;
    const { data, error } = await withTimeout(
      supabaseClient.storage.from('course-files').download(inaccessiblePath),
      10000,
      'Storage no respondió a tiempo.'
    );
    const blocked = Boolean(error) && !data;
    return {
      passed: blocked,
      message: blocked ? 'Storage no entregó una ruta fuera del alcance autorizado.' : 'Storage devolvió contenido para una ruta no autorizada.'
    };
  });
  if (storagePassed) passed += 1;

  const allPassed = passed === securityCheckIds.length;
  summary.className = allPassed ? 'passed' : 'failed';
  summary.textContent = allPassed
    ? `5 de 5 controles aprobados. La sesión está protegida.`
    : `${passed} de 5 controles aprobados. Revisa las migraciones marcadas.`;
  button.disabled = false;
  button.innerHTML = 'Repetir pruebas <span>↻</span>';
  securitySuiteRunning = false;
  await logAudit('security_suite_run', 'security', { passed, total: securityCheckIds.length });
  await loadSecurityAuditLogs();
}

function auditCategory(log) {
  const value = `${log.entity_type || ''} ${log.action || ''}`.toLowerCase();
  if (value.includes('grade')) return 'grade';
  if (value.includes('submission')) return 'submission';
  if (value.includes('assignment') || value.includes('task')) return 'assignment';
  if (value.includes('course') || value.includes('enrollment')) return 'course';
  return 'security';
}

function auditActionLabel(action = '') {
  const labels = {
    denied_access_test: 'Acceso ajeno bloqueado',
    security_suite_run: 'Suite de seguridad ejecutada',
    course_archived: 'Curso archivado',
    course_reactivated: 'Curso reactivado',
    assignment_created: 'Tarea creada',
    assignment_updated: 'Tarea actualizada',
    assignment_deleted: 'Tarea eliminada',
    submission_created: 'Entrega enviada',
    submission_updated: 'Entrega actualizada',
    grade_created: 'Calificación publicada',
    grade_updated: 'Calificación actualizada',
    courses_insert: 'Curso creado',
    courses_update: 'Curso actualizado',
    courses_delete: 'Curso eliminado',
    enrollments_insert: 'Matrícula creada',
    enrollments_update: 'Matrícula actualizada',
    enrollments_delete: 'Matrícula eliminada',
    assignments_insert: 'Tarea registrada',
    assignments_update: 'Tarea modificada',
    assignments_delete: 'Tarea eliminada',
    submissions_insert: 'Entrega registrada',
    submissions_update: 'Entrega modificada',
    submissions_delete: 'Entrega eliminada',
    grades_insert: 'Calificación registrada',
    grades_update: 'Calificación modificada',
    grades_delete: 'Calificación eliminada'
  };
  if (labels[action]) return labels[action];
  return action.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
}

function auditEntityLabel(entityType = '') {
  return ({
    profile: 'Perfil', profiles: 'Perfil', security: 'Seguridad', storage: 'Storage',
    course: 'Curso', courses: 'Curso', enrollment: 'Matrícula', enrollments: 'Matrícula',
    assignment: 'Tarea', assignments: 'Tarea', submission: 'Entrega', submissions: 'Entrega',
    grade: 'Calificación', grades: 'Calificación'
  })[entityType] || entityType || 'Evento';
}

function auditCategoryLabel(category) {
  return ({ security: 'Seguridad', course: 'Cursos', assignment: 'Tareas', submission: 'Entregas', grade: 'Notas' })[category] || 'Evento';
}

function filteredSecurityAuditRows() {
  const search = document.getElementById('security-audit-search')?.value.trim().toLowerCase() || '';
  const filter = document.getElementById('security-audit-filter')?.value || 'all';
  return securityAuditRows.filter((log) => {
    const category = auditCategory(log);
    const searchable = `${log.action || ''} ${auditActionLabel(log.action)} ${log.entity_type || ''} ${JSON.stringify(log.metadata || {})}`.toLowerCase();
    return (filter === 'all' || category === filter) && (!search || searchable.includes(search));
  });
}

function renderSecurityAuditRows() {
  const list = document.getElementById('security-audit-list');
  const count = document.getElementById('security-audit-count');
  if (!list || !count) return;
  const rows = filteredSecurityAuditRows();
  count.textContent = securityAuditRows.length === rows.length
    ? `${rows.length} ${rows.length === 1 ? 'evento' : 'eventos'}`
    : `${rows.length} de ${securityAuditRows.length} eventos`;
  document.getElementById('export-security-audit').disabled = rows.length === 0;
  if (!rows.length) {
    list.innerHTML = `<div class="security-audit-empty"><span>⌕</span><strong>Sin eventos para mostrar</strong><p>${securityAuditRows.length ? 'Prueba con otro término o filtro.' : 'Ejecuta la suite o realiza una acción para crear evidencia.'}</p></div>`;
    return;
  }
  list.innerHTML = rows.map((log) => {
    const category = auditCategory(log);
    const date = new Date(log.created_at);
    const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {};
    const source = metadata.source === 'database_trigger' ? 'Base de datos' : 'Aplicación';
    const entityId = log.entity_id ? `${String(log.entity_id).slice(0, 8)}…` : 'Sin ID asociado';
    const metadataJson = JSON.stringify(metadata, null, 2);
    return `<article class="security-audit-row"><span class="security-audit-icon ${category}">${({ security: '✓', course: 'C', assignment: 'T', submission: 'E', grade: 'N' })[category]}</span><div class="security-audit-info"><div><strong>${escapeHtml(auditActionLabel(log.action))}</strong><span class="security-audit-category ${category}">${escapeHtml(auditCategoryLabel(category))}</span></div><p>${escapeHtml(auditEntityLabel(log.entity_type))} · ${escapeHtml(entityId)} · ${source}</p>${metadataJson !== '{}' ? `<details><summary>Ver evidencia técnica</summary><pre>${escapeHtml(metadataJson)}</pre></details>` : ''}</div><time datetime="${escapeHtml(log.created_at)}"><strong>${date.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' })}</strong><small>${date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}</small></time></article>`;
  }).join('');
}

async function loadSecurityAuditLogs() {
  if (!supabaseClient || !currentUser) return;
  const list = document.getElementById('security-audit-list');
  list.innerHTML = '<div class="detail-loading compact"><span></span><p>Consultando eventos protegidos...</p></div>';
  try {
    const { data, error } = await withTimeout(
      supabaseClient.from('audit_logs').select('id, action, entity_type, entity_id, metadata, created_at').eq('actor_id', currentUser.id).order('created_at', { ascending: false }).limit(100),
      12000,
      'La auditoría tardó demasiado en responder.'
    );
    if (error) throw error;
    securityAuditRows = data || [];
    renderSecurityAuditRows();
  } catch (error) {
    securityAuditRows = [];
    document.getElementById('security-audit-count').textContent = 'No disponible';
    list.innerHTML = `<div class="security-audit-empty error"><span>!</span><strong>No se pudo consultar la auditoría</strong><p>${escapeHtml(error.message || 'Revisa la migración de auditoría.')}</p></div>`;
  }
}

function exportSecurityAudit() {
  const rows = filteredSecurityAuditRows();
  if (!rows.length || !currentUser) {
    showToast('No hay eventos visibles para exportar.');
    return;
  }
  const payload = {
    application: 'AulaSegura',
    exported_at: new Date().toISOString(),
    actor_id: currentUser.id,
    role: currentProfile.role || currentUser.user_metadata?.role || 'student',
    events: rows
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `aulasegura-auditoria-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast(`${rows.length} eventos exportados en JSON.`);
}

async function openSecurityConsole() {
  if (!currentUser) return;
  currentCourseDetailId = null;
  courseDetailRequest += 1;
  hideWorkspaceSections();
  document.querySelector('.page-heading').classList.add('hidden');
  document.querySelector('.stats-grid').classList.add('hidden');
  document.querySelector('.dashboard-grid').classList.add('hidden');
  document.getElementById('role-help').classList.add('hidden');
  document.getElementById('teacher-view').classList.add('hidden');
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
  const name = currentProfile.full_name || currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Usuario';
  const role = currentProfile.role || currentUser.user_metadata?.role || 'student';
  const userId = currentUser.id || '';
  document.getElementById('security-identity-name').textContent = name;
  document.getElementById('security-identity-meta').textContent = `${role === 'teacher' ? 'Profesor/a' : 'Estudiante'} · Auth verificada`;
  document.getElementById('security-user-id').textContent = userId ? `${userId.slice(0, 8)}…${userId.slice(-4)}` : 'ID no disponible';
  document.getElementById('security-console-view').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await loadSecurityAuditLogs();
}

function notificationReadStorageKey() {
  return currentUser ? `aulasegura-notifications-read-${currentUser.id}` : '';
}

function readNotificationIds() {
  const key = notificationReadStorageKey();
  if (!key) return new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(stored) ? stored : []);
  } catch {
    return new Set();
  }
}

function saveReadNotificationIds(ids) {
  const key = notificationReadStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify([...ids].slice(-250)));
  } catch (error) {
    console.warn('No se pudo guardar el estado de las notificaciones:', error.message);
  }
}

function relativeNotificationTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Ahora';
  const difference = date.getTime() - Date.now();
  const absolute = Math.abs(difference);
  const future = difference > 0;
  if (absolute < 60000) return 'Ahora';
  if (absolute < 3600000) {
    const minutes = Math.max(1, Math.round(absolute / 60000));
    return future ? `En ${minutes} min` : `Hace ${minutes} min`;
  }
  if (absolute < 86400000) {
    const hours = Math.max(1, Math.round(absolute / 3600000));
    return future ? `En ${hours} h` : `Hace ${hours} h`;
  }
  const days = Math.max(1, Math.round(absolute / 86400000));
  if (days < 8) return future ? `En ${days} d` : `Hace ${days} d`;
  return date.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
}

function notificationIcon(type) {
  return ({ task: '✓', submission: '↑', grade: '★', security: '◆' })[type] || '◇';
}

function setNotificationItems(items = []) {
  const unique = new Map();
  items.filter((item) => item?.id).forEach((item) => unique.set(item.id, item));
  notificationItems = [...unique.values()].slice(0, 30);
  updateNotificationIndicator();
  renderNotificationCenter();
}

function updateNotificationIndicator() {
  const button = document.getElementById('notifications-button');
  const counter = document.getElementById('notification-count');
  if (!button || !counter) return;
  const readIds = readNotificationIds();
  const unread = notificationItems.filter((item) => !readIds.has(item.id)).length;
  counter.textContent = unread > 9 ? '9+' : String(unread);
  counter.classList.toggle('hidden', unread === 0);
  button.dataset.pending = String(unread);
  button.setAttribute('aria-label', unread ? `Abrir notificaciones: ${unread} sin leer` : 'Abrir notificaciones');
}

function renderNotificationCenter() {
  const list = document.getElementById('notification-list');
  const summary = document.getElementById('notification-summary');
  const unreadCounter = document.getElementById('notification-unread-count');
  const markAllButton = document.getElementById('mark-all-notifications-read');
  if (!list || !summary || !unreadCounter || !markAllButton) return;
  const readIds = readNotificationIds();
  const unread = notificationItems.filter((item) => !readIds.has(item.id)).length;
  const visibleItems = notificationFilter === 'unread'
    ? notificationItems.filter((item) => !readIds.has(item.id))
    : notificationItems;
  summary.textContent = notificationItems.length
    ? `${unread} ${unread === 1 ? 'novedad sin leer' : 'novedades sin leer'} · Datos filtrados por RLS`
    : 'No hay novedades pendientes en este momento.';
  unreadCounter.textContent = unread;
  markAllButton.disabled = unread === 0;
  document.querySelectorAll('[data-notification-filter]').forEach((button) => {
    const active = button.dataset.notificationFilter === notificationFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  if (!visibleItems.length) {
    const filtered = notificationFilter === 'unread' && notificationItems.length;
    list.innerHTML = `<div class="notification-empty"><span>${filtered ? '✓' : '◇'}</span><strong>${filtered ? 'Todo está al día' : 'Sin novedades'}</strong><p>${filtered ? 'Ya leíste todas las notificaciones disponibles.' : 'Las tareas, entregas y notas aparecerán aquí automáticamente.'}</p></div>`;
    return;
  }
  list.innerHTML = visibleItems.map((item) => {
    const isRead = readIds.has(item.id);
    return `<article class="notification-item ${isRead ? 'read' : 'unread'}"><span class="notification-type-icon ${escapeHtml(item.type)}">${notificationIcon(item.type)}</span><div class="notification-copy"><div><strong>${escapeHtml(item.title)}</strong>${isRead ? '' : '<span class="notification-new">Nueva</span>'}</div><p>${escapeHtml(item.message)}</p><span class="notification-time">${escapeHtml(relativeNotificationTime(item.date))}</span></div><div class="notification-item-actions"><button class="notification-read-toggle" type="button" data-mark-notification="${escapeHtml(item.id)}" aria-label="${isRead ? 'Marcar como no leída' : 'Marcar como leída'}">${isRead ? '○' : '●'}</button><button class="notification-action" type="button" data-notification-action="${escapeHtml(item.id)}">${escapeHtml(item.actionLabel || 'Abrir')} →</button></div></article>`;
  }).join('');
}

function openNotificationCenter() {
  const center = document.getElementById('notification-center');
  center.classList.remove('hidden');
  document.getElementById('notifications-button').setAttribute('aria-expanded', 'true');
  document.body.classList.add('notifications-open');
  renderNotificationCenter();
  window.setTimeout(() => document.getElementById('close-notifications').focus(), 30);
}

function closeNotificationCenter() {
  const center = document.getElementById('notification-center');
  if (!center) return;
  center.classList.add('hidden');
  document.getElementById('notifications-button')?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('notifications-open');
}

function toggleNotificationRead(notificationId) {
  const readIds = readNotificationIds();
  if (readIds.has(notificationId)) readIds.delete(notificationId);
  else readIds.add(notificationId);
  saveReadNotificationIds(readIds);
  updateNotificationIndicator();
  renderNotificationCenter();
}

function markAllNotificationsRead() {
  const readIds = readNotificationIds();
  notificationItems.forEach((item) => readIds.add(item.id));
  saveReadNotificationIds(readIds);
  updateNotificationIndicator();
  renderNotificationCenter();
  showToast('Todas las notificaciones se marcaron como leídas.');
}

async function handleNotificationAction(notificationId) {
  const item = notificationItems.find((notification) => notification.id === notificationId);
  if (!item) return;
  const readIds = readNotificationIds();
  readIds.add(notificationId);
  saveReadNotificationIds(readIds);
  updateNotificationIndicator();
  closeNotificationCenter();
  if (item.type === 'task' && item.assignmentId) {
    await openAssignmentModal(item.assignmentId);
    return;
  }
  if (item.type === 'submission') {
    if (item.courseId) {
      await openCourseDetail(item.courseId);
      window.setTimeout(() => document.querySelector('.detail-reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } else focusTeacherSubmissions();
    return;
  }
  if (item.type === 'grade') {
    navigateView('overview');
    window.setTimeout(() => document.getElementById('student-grades-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }
}

async function refreshNotifications() {
  const button = document.getElementById('refresh-notifications');
  button.disabled = true;
  button.classList.add('loading');
  try {
    const role = currentProfile.role || currentUser?.user_metadata?.role || 'student';
    if (role === 'teacher') await loadTeacherCourses();
    else await loadStudentDashboard();
    showToast('Notificaciones actualizadas.');
  } finally {
    button.disabled = false;
    button.classList.remove('loading');
  }
}

async function loadStudentDashboard() {
  if (!supabaseClient || !currentUser) return;
  const taskList = document.getElementById('student-task-list');
  const gradeList = document.getElementById('student-grade-list');
  const { data: enrollments, error: enrollmentError } = await supabaseClient
    .from('enrollments')
    .select('course_id, courses (id, name, subject, description, status)')
    .eq('student_id', currentUser.id);
  if (enrollmentError) {
    taskList.innerHTML = `<div class="empty-state">No se pudieron cargar tus cursos.</div>`;
    setNotificationItems([]);
    return;
  }
  const courses = (enrollments || []).map((item) => item.courses).filter(Boolean).filter((course) => course.status === 'active');
  document.getElementById('course-count-stat').textContent = courses.length;
  const courseIds = courses.map((course) => course.id);
  if (!courseIds.length) {
    document.getElementById('pending-count').textContent = '0';
    document.getElementById('average-stat').innerHTML = '— <em>/ 10</em>';
    taskList.innerHTML = '<div class="empty-state">Aún no estás matriculado en cursos.</div>';
    gradeList.innerHTML = '<div class="empty-state">Tus calificaciones aparecerán aquí.</div>';
    renderStudentSpaces([], [], new Map());
    setNotificationItems([]);
    return;
  }

  const { data: assignments, error: assignmentError } = await supabaseClient
    .from('assignments')
    .select('id, course_id, title, description, due_at, status, attachment_path, courses (name, subject)')
    .in('course_id', courseIds)
    .in('status', ['published', 'closed'])
    .order('due_at', { ascending: true });
  if (assignmentError) {
    taskList.innerHTML = '<div class="empty-state">No se pudieron cargar las tareas.</div>';
    setNotificationItems([]);
    return;
  }
  const allAssignments = assignments || [];
  const openAssignments = allAssignments.filter((assignment) => assignment.status === 'published');
  taskList.innerHTML = openAssignments.length ? '<div class="empty-state">Preparando tareas...</div>' : '<div class="empty-state">No tienes tareas pendientes.</div>';

  const { data: submissions } = await supabaseClient.from('submissions').select('id, assignment_id, content, file_path, grades(id)').eq('student_id', currentUser.id);
  const submissionByAssignment = new Map((submissions || []).map((submission) => [submission.assignment_id, submission]));
  const submittedIds = new Set((submissions || []).map((submission) => submission.assignment_id));
  const pendingAssignmentsCount = openAssignments.filter((assignment) => !submittedIds.has(assignment.id)).length;
  document.getElementById('pending-count').textContent = pendingAssignmentsCount;
  renderStudentSpaces(courses, allAssignments, submissionByAssignment);
  taskList.innerHTML = openAssignments.length
    ? openAssignments.slice(0, 4).map((assignment) => `<div class="task-row"><span class="subject-tag ${subjectClass(assignment.courses?.subject)}">${escapeHtml((assignment.courses?.subject || 'CUR').slice(0, 3).toUpperCase())}</span><div><strong>${escapeHtml(assignment.title)}</strong><small>${escapeHtml(assignment.courses?.name || 'Curso')}</small></div><button class="task-detail-button compact" type="button" data-view-assignment="${assignment.id}">Detalles</button>${assignment.attachment_path ? `<button class="file-link" type="button" data-file-path="${escapeHtml(assignment.attachment_path)}">Archivo</button>` : ''}${studentSubmissionAction(assignment, submissionByAssignment.get(assignment.id), 'file-link', { create: 'Entregar', edit: 'Editar' })}<span class="due">${formatDueDate(assignment.due_at)}</span></div>`).join('')
    : '<div class="empty-state">No tienes tareas pendientes.</div>';
  const submissionIds = (submissions || []).map((submission) => submission.id);
  const { data: grades } = submissionIds.length
    ? await supabaseClient.from('grades').select('id, score, feedback, graded_at, submission_id, submissions (assignment_id, assignments (title, courses (name, subject)))').in('submission_id', submissionIds).order('graded_at', { ascending: false })
    : { data: [] };
  const gradeRows = grades || [];
  const scores = gradeRows.map((grade) => Number(grade.score)).filter((score) => Number.isFinite(score));
  const average = scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : '—';
  document.getElementById('average-stat').innerHTML = `${average} <em>/ 10</em>`;
  gradeList.innerHTML = gradeRows.length
    ? gradeRows.slice(0, 4).map((grade) => `<div class="grade-row"><span class="subject-tag ${subjectClass(grade.submissions?.assignments?.courses?.subject)}">${escapeHtml((grade.submissions?.assignments?.courses?.subject || 'CUR').slice(0, 3).toUpperCase())}</span><div><strong>${escapeHtml(grade.submissions?.assignments?.title || 'Actividad')}</strong><small>${escapeHtml(grade.submissions?.assignments?.courses?.name || 'Curso')}</small></div><b class="grade">${Number(grade.score).toFixed(1)}</b></div>`).join('')
    : '<div class="empty-state">Todavía no tienes calificaciones.</div>';
  const taskNotifications = openAssignments
    .filter((assignment) => !submittedIds.has(assignment.id))
    .map((assignment) => ({
      id: `task:${assignment.id}`,
      type: 'task',
      title: assignment.title,
      message: `${assignment.courses?.name || 'Curso'} · Entrega: ${formatDueDate(assignment.due_at)}`,
      date: assignment.due_at || new Date().toISOString(),
      actionLabel: 'Ver tarea',
      assignmentId: assignment.id
    }));
  const gradeNotifications = gradeRows.slice(0, 5).map((grade) => ({
    id: `grade:${grade.id}`,
    type: 'grade',
    title: `Nueva calificación: ${Number(grade.score).toFixed(1)} / 10`,
    message: `${grade.submissions?.assignments?.title || 'Actividad'} · ${grade.submissions?.assignments?.courses?.name || 'Curso'}`,
    date: grade.graded_at,
    actionLabel: 'Ver notas'
  }));
  setNotificationItems([...taskNotifications, ...gradeNotifications]);
  await loadAuditLogs();
}

function renderCourses(courses) {
  const list = document.getElementById('course-list');
  const activeCourses = courses.filter((course) => course.status === 'active');
  const archivedCourses = courses.filter((course) => course.status === 'archived');
  document.getElementById('course-count').textContent = archivedCourses.length ? `${activeCourses.length} activos · ${archivedCourses.length} archivados` : `${activeCourses.length} ${activeCourses.length === 1 ? 'curso' : 'cursos'}`;
  if (!courses.length) {
    list.innerHTML = '<div class="empty-state">Aún no tienes cursos. Crea el primero para comenzar.</div>';
    document.getElementById('assignment-course').innerHTML = '<option value="">Primero crea un curso</option>';
    document.getElementById('space-course-list').innerHTML = '<div class="empty-state">Aún no tienes cursos. Usa “Crear curso” para comenzar.</div>';
    document.getElementById('space-task-list').innerHTML = '<div class="empty-state">Las tareas aparecerán aquí después de crear un curso.</div>';
    document.getElementById('space-file-list').innerHTML = '<div class="empty-state">Los materiales protegidos aparecerán aquí.</div>';
    filterTaskWorkspace();
    return;
  }
  list.innerHTML = courses.map((course) => `<div class="course-card ${course.status === 'archived' ? 'archived' : ''}"><span class="course-icon">${escapeHtml(course.subject.slice(0, 3).toUpperCase())}</span><div><strong>${escapeHtml(course.name)}</strong><small>${escapeHtml(course.subject)} · ${escapeHtml(course.description || 'Sin descripción')}</small>${course.status === 'active' ? `<button class="invite-code" type="button" data-copy-code="${course.invite_code}">Código: ${course.invite_code} · Copiar</button>` : '<span class="course-code-paused">Invitaciones pausadas</span>'}</div><div class="course-card-actions"><span class="course-status ${course.status}">${courseStatusLabel(course.status)}</span><button class="course-open-button" type="button" data-open-course="${course.id}">Abrir →</button></div></div>`).join('');
  document.getElementById('assignment-course').innerHTML = activeCourses.length ? '<option value="">Selecciona un curso activo</option>' + activeCourses.map((course) => `<option value="${course.id}">${escapeHtml(course.name)} · ${escapeHtml(course.subject)}</option>`).join('') : '<option value="">No hay cursos activos</option>';
  document.getElementById('space-course-list').innerHTML = courses.map((course) => `<article class="workspace-card ${course.status === 'archived' ? 'archived' : ''}"><span class="course-icon">${escapeHtml(course.subject.slice(0, 3).toUpperCase())}</span><div><strong>${escapeHtml(course.name)}</strong><small>${escapeHtml(course.subject)} · ${course.status === 'active' ? 'Curso administrado por ti' : 'Curso archivado'}</small>${course.status === 'active' ? `<button class="invite-code" type="button" data-copy-code="${course.invite_code}">Código: ${course.invite_code} · Copiar</button>` : '<span class="course-code-paused">Invitaciones pausadas</span>'}</div><div class="workspace-card-actions"><span class="course-status ${course.status}">${courseStatusLabel(course.status)}</span><button class="course-open-button" type="button" data-open-course="${course.id}">Ver curso →</button></div></article>`).join('');
  document.getElementById('space-task-list').innerHTML = '<div class="workspace-row"><div><strong>Publica tu próxima tarea</strong><small>Las actividades aparecerán organizadas en este espacio.</small></div><span class="workspace-action">Desde el resumen</span></div>';
  document.getElementById('space-file-list').innerHTML = '<div class="workspace-row"><div><strong>Material protegido</strong><small>Los archivos adjuntos de tus tareas se mostrarán aquí.</small></div><span class="workspace-action">Storage privado</span></div>';
}

async function loadTeacherCourses() {
  if (!supabaseClient || !currentUser) return;
  const { data, error } = await supabaseClient.from('courses').select('id, name, subject, description, status, invite_code').eq('teacher_id', currentUser.id).order('created_at', { ascending: false });
  if (error) {
    document.getElementById('course-list').innerHTML = `<div class="empty-state">No se pudieron cargar los cursos: ${error.message}</div>`;
    return;
  }
  const courses = data || [];
  const courseIds = courses.map((course) => course.id);
  renderCourses(courses);
  await Promise.all([
    loadTeacherSubmissions(courseIds),
    loadTeacherWorkspaceAssignments(courseIds),
    loadTeacherOverview(courses)
  ]);
}

async function loadTeacherOverview(courses) {
  const insights = document.getElementById('teacher-course-insights');
  const deadlines = document.getElementById('teacher-deadline-list');
  const activeCourses = courses.filter((course) => course.status === 'active');
  const archivedCourses = courses.filter((course) => course.status === 'archived');
  document.getElementById('teacher-stat-courses').textContent = activeCourses.length;
  document.getElementById('teacher-stat-archived').textContent = archivedCourses.length ? `${archivedCourses.length} archivados` : 'Todos disponibles';
  if (!courses.length) {
    document.getElementById('teacher-stat-students').textContent = '0';
    document.getElementById('teacher-stat-tasks').textContent = '0';
    document.getElementById('teacher-stat-drafts').textContent = 'Sin tareas todavía';
    document.getElementById('teacher-stat-pending').textContent = '0';
    insights.innerHTML = '<div class="empty-state">Crea tu primer curso para comenzar el seguimiento.</div>';
    deadlines.innerHTML = '<div class="empty-state">La agenda aparecerá cuando publiques tareas.</div>';
    setNotificationItems([]);
    return;
  }
  try {
    const courseIds = courses.map((course) => course.id);
    const [enrollmentResult, assignmentResult] = await withTimeout(Promise.all([
      supabaseClient.from('enrollments').select('course_id, student_id').in('course_id', courseIds),
      supabaseClient.from('assignments').select('id, course_id, title, due_at, status').in('course_id', courseIds).order('due_at', { ascending: true, nullsFirst: false })
    ]), 12000, 'El resumen docente tardó demasiado en cargar.');
    if (enrollmentResult.error) throw new Error(enrollmentResult.error.message);
    if (assignmentResult.error) throw new Error(assignmentResult.error.message);
    const enrollments = enrollmentResult.data || [];
    const assignments = assignmentResult.data || [];
    const assignmentIds = assignments.map((assignment) => assignment.id);
    let submissions = [];
    if (assignmentIds.length) {
      const submissionResult = await withTimeout(
        supabaseClient.from('submissions').select('id, assignment_id, student_id, submitted_at, grades(id, score)').in('assignment_id', assignmentIds).order('submitted_at', { ascending: false }),
        12000,
        'Las entregas tardaron demasiado en cargar.'
      );
      if (submissionResult.error) throw new Error(submissionResult.error.message);
      submissions = submissionResult.data || [];
    }
    const pendingReviews = submissions.filter((submission) => !relatedOne(submission.grades)).length;
    const draftCount = assignments.filter((assignment) => assignment.status === 'draft').length;
    document.getElementById('teacher-stat-students').textContent = enrollments.length;
    document.getElementById('teacher-stat-tasks').textContent = assignments.length;
    document.getElementById('teacher-stat-drafts').textContent = `${draftCount} ${draftCount === 1 ? 'borrador' : 'borradores'}`;
    document.getElementById('teacher-stat-pending').textContent = pendingReviews;
    const notificationAssignmentMap = new Map(assignments.map((assignment) => [assignment.id, assignment]));
    const notificationCourseMap = new Map(courses.map((course) => [course.id, course]));
    setNotificationItems(submissions
      .filter((submission) => !relatedOne(submission.grades))
      .map((submission) => {
        const assignment = notificationAssignmentMap.get(submission.assignment_id);
        const course = notificationCourseMap.get(assignment?.course_id);
        return {
          id: `submission:${submission.id}`,
          type: 'submission',
          title: 'Entrega por calificar',
          message: `${assignment?.title || 'Tarea'} · ${course?.name || 'Curso'}`,
          date: submission.submitted_at,
          actionLabel: 'Revisar',
          courseId: assignment?.course_id
        };
      }));

    insights.innerHTML = courses.map((course) => {
      const courseAssignments = assignments.filter((assignment) => assignment.course_id === course.id);
      const courseAssignmentIds = new Set(courseAssignments.map((assignment) => assignment.id));
      const courseSubmissions = submissions.filter((submission) => courseAssignmentIds.has(submission.assignment_id));
      const graded = courseSubmissions.filter((submission) => relatedOne(submission.grades)).length;
      const pending = courseSubmissions.length - graded;
      const progress = courseSubmissions.length ? Math.round((graded / courseSubmissions.length) * 100) : 0;
      const members = enrollments.filter((enrollment) => enrollment.course_id === course.id).length;
      return `<article class="teacher-insight-row ${course.status === 'archived' ? 'archived' : ''}"><div class="teacher-insight-top"><span class="course-icon small">${escapeHtml(course.subject.slice(0, 3).toUpperCase())}</span><div><strong>${escapeHtml(course.name)}</strong><small>${members} ${members === 1 ? 'estudiante' : 'estudiantes'} · ${courseAssignments.length} ${courseAssignments.length === 1 ? 'tarea' : 'tareas'}</small></div><button class="course-open-button" type="button" data-open-course="${course.id}">Abrir →</button></div><div class="teacher-progress-meta"><span>${courseSubmissions.length ? `${graded} de ${courseSubmissions.length} calificadas` : 'Sin entregas todavía'}</span><strong>${pending} pendientes</strong></div><div class="teacher-progress-track"><span style="width:${progress}%"></span></div></article>`;
    }).join('');

    const activeCourseIds = new Set(activeCourses.map((course) => course.id));
    const courseMap = new Map(courses.map((course) => [course.id, course]));
    const agenda = assignments.filter((assignment) => assignment.status === 'published' && assignment.due_at && activeCourseIds.has(assignment.course_id)).sort((a, b) => new Date(a.due_at) - new Date(b.due_at)).slice(0, 5);
    deadlines.innerHTML = agenda.length ? agenda.map((assignment) => {
      const course = courseMap.get(assignment.course_id);
      const overdue = formatDueDate(assignment.due_at).startsWith('Vencida');
      return `<article class="teacher-deadline-row"><span class="deadline-date ${overdue ? 'overdue' : ''}">${escapeHtml(formatDueDate(assignment.due_at))}</span><div><strong>${escapeHtml(assignment.title)}</strong><small>${escapeHtml(course?.name || 'Curso')}</small></div><button class="task-detail-button" type="button" data-edit-assignment="${assignment.id}">Editar</button></article>`;
    }).join('') : '<div class="empty-state">No hay fechas de entrega programadas.</div>';
  } catch (error) {
    insights.innerHTML = `<div class="empty-state">No se pudo calcular el progreso: ${escapeHtml(error.message)}</div>`;
    deadlines.innerHTML = '<div class="empty-state">No se pudo cargar la agenda.</div>';
    setNotificationItems([]);
  }
}

async function loadTeacherWorkspaceAssignments(courseIds) {
  const taskList = document.getElementById('space-task-list');
  const fileList = document.getElementById('space-file-list');
  if (!courseIds.length) {
    filterTaskWorkspace();
    return;
  }
  const { data: assignments, error } = await supabaseClient.from('assignments').select('id, title, description, due_at, status, attachment_path, courses(name)').in('course_id', courseIds).order('created_at', { ascending: false });
  if (error) return;
  taskList.innerHTML = assignments?.length
    ? assignments.map((assignment) => {
        const searchText = `${assignment.title} ${assignment.courses?.name || ''} ${assignment.description || ''}`.toLowerCase();
        return `<article class="workspace-row task-workspace-row" data-task-row data-task-status="${assignment.status}" data-search-text="${escapeHtml(searchText)}"><span class="task-state-dot ${assignment.status}"></span><div><strong>${escapeHtml(assignment.title)}</strong><small>${escapeHtml(assignment.courses?.name || 'Curso')} · ${assignmentStatusLabel(assignment.status)} · Entrega: ${formatDueDate(assignment.due_at)}</small><p>${escapeHtml(assignment.description || 'Sin instrucciones adicionales.')}</p></div><div class="workspace-actions"><span class="task-status-pill ${assignment.status}">${assignmentStatusLabel(assignment.status)}</span><button class="task-detail-button" type="button" data-edit-assignment="${assignment.id}">Editar</button><button class="task-delete-shortcut" type="button" data-delete-assignment="${assignment.id}" data-delete-title="${escapeHtml(assignment.title)}">Eliminar</button>${assignment.attachment_path ? `<button class="file-link" type="button" data-file-path="${escapeHtml(assignment.attachment_path)}">Archivo</button>` : ''}</div></article>`;
      }).join('')
    : '<div class="empty-state">Aún no has publicado tareas.</div>';
  const files = (assignments || []).filter((assignment) => assignment.attachment_path);
  fileList.innerHTML = files.length
    ? files.map((assignment) => `<article class="workspace-row"><div><strong>${escapeHtml(assignment.title)}</strong><small>${escapeHtml(assignment.courses?.name || 'Curso')} · Archivo protegido</small></div><button class="file-link" type="button" data-file-path="${escapeHtml(assignment.attachment_path)}">Abrir archivo</button></article>`).join('')
    : '<div class="empty-state">Los archivos adjuntos aparecerán aquí.</div>';
  filterTaskWorkspace();
}

async function loadTeacherSubmissions(courseIds) {
  const list = document.getElementById('teacher-submission-list');
  if (!courseIds.length) {
    list.innerHTML = '<div class="empty-state">Crea un curso para recibir entregas.</div>';
    return;
  }
  const { data: assignments } = await supabaseClient.from('assignments').select('id, title, course_id, courses(name)').in('course_id', courseIds);
  const assignmentIds = (assignments || []).map((assignment) => assignment.id);
  if (!assignmentIds.length) {
    list.innerHTML = '<div class="empty-state">Publica una tarea para recibir entregas.</div>';
    return;
  }
  const { data: submissions } = await supabaseClient.from('submissions').select('id, assignment_id, student_id, content, file_path, submitted_at, grades(id, score, feedback)').in('assignment_id', assignmentIds).order('submitted_at', { ascending: false }).limit(8);
  if (!submissions?.length) {
    list.innerHTML = '<div class="empty-state">Aún no hay entregas pendientes.</div>';
    return;
  }
  const studentIds = [...new Set(submissions.map((submission) => submission.student_id))];
  const { data: students } = await supabaseClient.from('profiles').select('id, full_name').in('id', studentIds);
  const names = Object.fromEntries((students || []).map((student) => [student.id, student.full_name || 'Estudiante']));
  const assignmentMap = Object.fromEntries((assignments || []).map((assignment) => [assignment.id, assignment]));
  list.innerHTML = submissions.map((submission) => {
    const assignment = assignmentMap[submission.assignment_id];
    const grade = relatedOne(submission.grades);
    return `<div class="submission-card"><div class="submission-meta"><div><strong>${escapeHtml(names[submission.student_id] || 'Estudiante')}</strong><small>${escapeHtml(assignment?.title || 'Tarea')} · ${escapeHtml(assignment?.courses?.name || 'Curso')}</small>${submission.content ? `<p>${escapeHtml(submission.content)}</p>` : ''}</div>${grade ? `<span class="grade-chip">${Number(grade.score).toFixed(1)} / 10</span>` : '<span class="due urgent">Sin calificar</span>'}</div><div class="grade-form advanced">${submission.file_path ? `<button class="file-link" type="button" data-file-path="${escapeHtml(submission.file_path)}">Ver entrega</button>` : ''}<label><span>Nota</span><input type="number" min="0" max="10" step="0.1" placeholder="0–10" value="${grade ? Number(grade.score) : ''}" data-grade-score="${submission.id}" /></label><label class="grade-feedback-field"><span>Comentario</span><input type="text" maxlength="240" placeholder="Retroalimentación para el estudiante" value="${escapeHtml(grade?.feedback || '')}" data-grade-feedback="${submission.id}" /></label><button type="button" data-grade-submit="${submission.id}" data-grade-id="${grade?.id || ''}">${grade ? 'Actualizar' : 'Calificar'}</button></div></div>`;
  }).join('');
}

function renderCourseDetail(course, assignments, submissions, enrollments, role) {
  const isTeacher = role === 'teacher';
  const isCourseActive = course.status === 'active';
  const studentNames = new Map(enrollments.map((enrollment) => {
    const profile = relatedOne(enrollment.profiles);
    return [enrollment.student_id, profile?.full_name || 'Estudiante'];
  }));
  const submissionByAssignment = new Map(submissions.filter((submission) => submission.student_id === currentUser.id).map((submission) => [submission.assignment_id, submission]));
  const scores = submissions.map((submission) => Number(relatedOne(submission.grades)?.score)).filter(Number.isFinite);
  const pendingReviews = submissions.filter((submission) => !relatedOne(submission.grades)).length;
  const submittedCount = submissionByAssignment.size;
  const pendingAssignments = assignments.filter((assignment) => assignment.status === 'published' && !submissionByAssignment.has(assignment.id)).length;
  const average = scores.length ? (scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(1) : '—';
  const stats = isTeacher
    ? [
        ['◎', 'Estudiantes', enrollments.length, 'Matrículas autorizadas'],
        ['✓', 'Tareas', assignments.length, 'Actividades del curso'],
        ['◆', 'Por calificar', pendingReviews, 'Entregas pendientes']
      ]
    : [
        ['✓', 'Tareas', assignments.length, 'Disponibles para ti'],
        ['↑', 'Entregadas', submittedCount, `${pendingAssignments} pendientes`],
        ['★', 'Promedio', average, scores.length ? 'Sobre 10 puntos' : 'Aún sin notas']
      ];

  const activityRows = assignments.length
    ? assignments.map((assignment) => {
        const courseSubmissions = submissions.filter((submission) => submission.assignment_id === assignment.id);
        const ownSubmission = submissionByAssignment.get(assignment.id);
        const grade = relatedOne(ownSubmission?.grades);
        let studentState = `<button class="detail-action-button" type="button" data-submit-assignment="${assignment.id}" data-submit-title="${escapeHtml(assignment.title)}">Entregar tarea</button>`;
        if (ownSubmission && grade) studentState = `<span class="detail-score">${Number(grade.score).toFixed(1)} / 10</span>`;
        else if (ownSubmission && assignment.status === 'published') studentState = `<button class="detail-action-button edit-submission-button" type="button" data-edit-submission-assignment="${assignment.id}" data-submit-title="${escapeHtml(assignment.title)}">Editar entrega</button>`;
        else if (ownSubmission) studentState = '<span class="detail-state success">Entregada</span>';
        else if (assignment.status === 'closed') studentState = '<span class="detail-state">Cerrada</span>';
        const action = isTeacher
          ? `<span class="detail-state">${courseSubmissions.length} ${courseSubmissions.length === 1 ? 'entrega' : 'entregas'}</span>`
          : studentState;
        const detailsButton = isTeacher
          ? `<button class="task-detail-button" type="button" data-edit-assignment="${assignment.id}">Editar</button><button class="task-delete-shortcut" type="button" data-delete-assignment="${assignment.id}" data-delete-title="${escapeHtml(assignment.title)}">Eliminar</button>`
          : `<button class="task-detail-button" type="button" data-view-assignment="${assignment.id}">Detalles</button>`;
        return `<article class="detail-activity-row"><span class="subject-tag ${subjectClass(course.subject)}">${escapeHtml(course.subject.slice(0, 3).toUpperCase())}</span><div class="detail-activity-copy"><strong>${escapeHtml(assignment.title)}</strong><small>${assignmentStatusLabel(assignment.status)} · Entrega: ${formatAssignmentDate(assignment.due_at)}</small><p>${escapeHtml(assignment.description || 'Sin instrucciones adicionales.')}</p></div><div class="detail-row-actions">${detailsButton}${assignment.attachment_path ? `<button class="file-link" type="button" data-file-path="${escapeHtml(assignment.attachment_path)}">Abrir material</button>` : '<span class="detail-muted">Sin adjunto</span>'}${action}</div></article>`;
      }).join('')
    : '<div class="detail-empty"><span>✓</span><strong>Aún no hay tareas</strong><p>Las actividades publicadas para este curso aparecerán aquí.</p></div>';

  const memberContent = isTeacher
    ? (enrollments.length
        ? enrollments.map((enrollment) => {
            const name = studentNames.get(enrollment.student_id) || 'Estudiante';
            return `<div class="detail-member"><span class="detail-avatar">${escapeHtml(initials(name))}</span><div><strong>${escapeHtml(name)}</strong><small>Estudiante · Desde ${formatLongDate(enrollment.enrolled_at)}</small></div><span class="detail-state success">Activo</span></div>`;
          }).join('')
        : '<div class="detail-empty compact"><span>◎</span><strong>Sin estudiantes todavía</strong><p>Comparte el código para recibir matrículas.</p></div>')
    : `<div class="detail-member"><span class="detail-avatar">${escapeHtml(initials(currentProfile.full_name))}</span><div><strong>${escapeHtml(currentProfile.full_name || 'Tu cuenta')}</strong><small>Estudiante autenticado</small></div><span class="detail-state success">Acceso permitido</span></div><p class="detail-privacy-copy">La lista de compañeros permanece oculta. RLS solo entrega las filas necesarias para tu cuenta.</p>`;

  const reviewContent = isTeacher
    ? `<section class="detail-card detail-reviews"><div class="detail-section-heading"><div><span class="eyebrow">Evaluación privada</span><h2>Entregas del curso</h2></div><span class="detail-counter">${submissions.length}</span></div>${submissions.length ? submissions.map((submission) => {
        const grade = relatedOne(submission.grades);
        const name = studentNames.get(submission.student_id) || 'Estudiante';
        return `<article class="detail-review-row"><span class="detail-avatar small">${escapeHtml(initials(name))}</span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(assignments.find((assignment) => assignment.id === submission.assignment_id)?.title || 'Tarea')} · ${formatLongDate(submission.submitted_at)}</small>${submission.content ? `<p>${escapeHtml(submission.content)}</p>` : ''}</div><div class="detail-row-actions detail-grade-actions">${submission.file_path ? `<button class="file-link" type="button" data-file-path="${escapeHtml(submission.file_path)}">Ver entrega</button>` : ''}<input class="detail-grade-input" type="number" min="0" max="10" step="0.1" placeholder="Nota" aria-label="Nota para ${escapeHtml(name)}" value="${grade ? Number(grade.score) : ''}" data-grade-score="${submission.id}" /><input class="detail-feedback-input" type="text" maxlength="240" placeholder="Comentario" aria-label="Comentario para ${escapeHtml(name)}" value="${escapeHtml(grade?.feedback || '')}" data-grade-feedback="${submission.id}" /><button class="detail-action-button" type="button" data-grade-submit="${submission.id}" data-grade-id="${grade?.id || ''}">${grade ? 'Actualizar' : 'Calificar'}</button></div></article>`;
      }).join('') : '<div class="detail-empty compact"><span>↑</span><strong>Sin entregas todavía</strong><p>Aparecerán cuando los estudiantes envíen sus archivos.</p></div>'}</section>`
    : '';

  document.getElementById('course-detail-content').innerHTML = `
    <section class="course-detail-hero">
      <div class="course-detail-mark">${escapeHtml(course.subject.slice(0, 3).toUpperCase())}</div>
      <div class="course-detail-title"><div class="detail-badges"><span class="detail-state ${isCourseActive ? 'success' : ''}">● ${isCourseActive ? 'Curso activo' : 'Curso archivado'}</span><span class="detail-protection">RLS · Acceso por fila</span></div><h1>${escapeHtml(course.name)}</h1><p>${escapeHtml(course.description || `Espacio académico de ${course.subject}.`)}</p><small>${escapeHtml(course.subject)} · Creado el ${formatLongDate(course.created_at)}</small></div>
      <div class="course-hero-actions">${isTeacher ? `${isCourseActive ? `<button class="secondary-button" type="button" data-copy-code="${course.invite_code}">Código ${course.invite_code} · Copiar</button>` : ''}<button class="secondary-button" type="button" data-course-status-id="${course.id}" data-next-course-status="${isCourseActive ? 'archived' : 'active'}">${isCourseActive ? 'Archivar curso' : 'Reactivar curso'}</button>${isCourseActive ? `<button class="primary-button" type="button" data-course-new-task="${course.id}">Nueva tarea <span>＋</span></button>` : ''}` : ''}<button class="icon-refresh-button" type="button" data-refresh-course="${course.id}" aria-label="Actualizar curso">↻</button></div>
    </section>
    <section class="detail-stats">${stats.map(([icon, label, value, copy]) => `<article><span>${icon}</span><div><small>${label}</small><strong>${value}</strong><em>${copy}</em></div></article>`).join('')}</section>
    <div class="course-detail-layout">
      <div class="course-detail-main">
        <section class="detail-card"><div class="detail-section-heading"><div><span class="eyebrow">Contenido del curso</span><h2>Actividades</h2></div><span class="detail-counter">${assignments.length}</span></div><div class="detail-activity-list">${activityRows}</div></section>
        ${reviewContent}
      </div>
      <aside class="course-detail-side">
        <section class="detail-card"><div class="detail-section-heading"><div><span class="eyebrow">${isTeacher ? 'Personas' : 'Tu matrícula'}</span><h2>${isTeacher ? 'Estudiantes' : 'Acceso al curso'}</h2></div><span class="detail-counter">${isTeacher ? enrollments.length : '1'}</span></div><div class="detail-member-list">${memberContent}</div></section>
        <section class="detail-card security-detail-card"><span class="security-shield">✓</span><span class="eyebrow">Seguridad verificable</span><h2>Datos protegidos</h2><p>Auth identifica tu cuenta, RLS filtra cada fila y Storage genera enlaces temporales.</p><ul><li><span></span>Sesión autenticada</li><li><span></span>Políticas RLS activas</li><li><span></span>Archivos privados por 60 s</li></ul><button class="security-test-button" type="button" data-course-security-test>Ejecutar prueba RLS <span>→</span></button><p class="security-result" id="course-security-result"></p></section>
      </aside>
    </div>`;
}

async function openCourseDetail(courseId) {
  if (!courseId || !supabaseClient || !currentUser) return;
  currentCourseDetailId = courseId;
  const requestId = ++courseDetailRequest;
  hideWorkspaceSections();
  document.querySelector('.page-heading').classList.add('hidden');
  document.querySelector('.stats-grid').classList.add('hidden');
  document.querySelector('.dashboard-grid').classList.add('hidden');
  document.getElementById('role-help').classList.add('hidden');
  document.getElementById('teacher-view').classList.add('hidden');
  document.getElementById('course-detail-view').classList.remove('hidden');
  document.getElementById('course-detail-content').innerHTML = '<div class="detail-loading"><span></span><p>Cargando espacio protegido...</p></div>';
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === 'courses'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const role = currentProfile.role || currentUser.user_metadata?.role || 'student';
  try {
    let assignmentsQuery = supabaseClient.from('assignments').select('id, title, description, due_at, status, attachment_path, created_at').eq('course_id', courseId).order('due_at', { ascending: true, nullsFirst: false });
    if (role !== 'teacher') assignmentsQuery = assignmentsQuery.in('status', ['published', 'closed']);
    const enrollmentsQuery = role === 'teacher'
      ? supabaseClient.from('enrollments').select('student_id, enrolled_at, profiles!enrollments_student_id_fkey(full_name)').eq('course_id', courseId).order('enrolled_at', { ascending: false })
      : Promise.resolve({ data: [], error: null });
    const [courseResult, assignmentResult, enrollmentResult] = await withTimeout(Promise.all([
      supabaseClient.from('courses').select('id, teacher_id, name, subject, description, status, invite_code, created_at').eq('id', courseId).maybeSingle(),
      assignmentsQuery,
      enrollmentsQuery
    ]), 12000, 'El curso tardó demasiado en cargar.');
    if (requestId !== courseDetailRequest) return;
    if (courseResult.error) throw new Error(courseResult.error.message);
    if (!courseResult.data) throw new Error('No tienes permiso para abrir este curso. RLS bloqueó la fila.');
    if (assignmentResult.error) throw new Error(assignmentResult.error.message);
    if (enrollmentResult.error) throw new Error(enrollmentResult.error.message);
    const assignments = assignmentResult.data || [];
    const assignmentIds = assignments.map((assignment) => assignment.id);
    let submissions = [];
    if (assignmentIds.length) {
      let submissionQuery = supabaseClient.from('submissions').select('id, assignment_id, student_id, content, file_path, submitted_at, grades(id, score, feedback)').in('assignment_id', assignmentIds).order('submitted_at', { ascending: false });
      if (role !== 'teacher') submissionQuery = submissionQuery.eq('student_id', currentUser.id);
      const submissionResult = await withTimeout(submissionQuery, 12000, 'Las entregas tardaron demasiado en cargar.');
      if (requestId !== courseDetailRequest) return;
      if (submissionResult.error) throw new Error(submissionResult.error.message);
      submissions = submissionResult.data || [];
    }
    renderCourseDetail(courseResult.data, assignments, submissions, enrollmentResult.data || [], role);
  } catch (error) {
    if (requestId !== courseDetailRequest) return;
    document.getElementById('course-detail-content').innerHTML = `<div class="detail-error"><span>!</span><h2>No se pudo abrir el curso</h2><p>${escapeHtml(error.message || 'Ocurrió un error inesperado.')}</p><button class="secondary-button" type="button" data-course-back>Volver a Mis cursos</button></div>`;
  }
}

function closeTaskModal() {
  taskModalRequest += 1;
  document.getElementById('task-modal').classList.add('hidden');
}

async function openAssignmentModal(assignmentId) {
  if (!assignmentId || !supabaseClient || !currentUser) return;
  const requestId = ++taskModalRequest;
  const modal = document.getElementById('task-modal');
  const content = document.getElementById('task-modal-content');
  modal.classList.remove('hidden');
  content.innerHTML = '<div class="detail-loading"><span></span><p>Cargando tarea...</p></div>';
  const role = currentProfile.role || currentUser.user_metadata?.role || 'student';
  try {
    const assignmentResult = await withTimeout(
      supabaseClient.from('assignments').select('id, course_id, title, description, due_at, status, attachment_path, courses(name, subject)').eq('id', assignmentId).maybeSingle(),
      12000,
      'La tarea tardó demasiado en cargar.'
    );
    if (requestId !== taskModalRequest) return;
    if (assignmentResult.error) throw new Error(assignmentResult.error.message);
    const assignment = assignmentResult.data;
    if (!assignment) throw new Error('No tienes permiso para consultar esta tarea.');
    const course = relatedOne(assignment.courses) || {};
    if (role === 'teacher') {
      content.innerHTML = `<div class="task-modal-heading"><div><span class="eyebrow accent">Edición protegida por RLS</span><h2>Editar tarea</h2><p>${escapeHtml(course.name || 'Curso')} · Los cambios se reflejan inmediatamente.</p></div><span class="task-status-pill ${assignment.status}">${assignmentStatusLabel(assignment.status)}</span></div><form class="task-edit-form" data-task-edit-form data-assignment-id="${assignment.id}"><label class="form-field">Título<input name="title" maxlength="100" required value="${escapeHtml(assignment.title)}" /></label><label class="form-field">Instrucciones<textarea name="description" rows="5" maxlength="1200" required>${escapeHtml(assignment.description || '')}</textarea></label><div class="assignment-form-grid"><label class="form-field">Fecha de entrega<input name="due_at" type="date" required value="${dateInputValue(assignment.due_at)}" /></label><label class="form-field">Estado<select name="status"><option value="draft" ${assignment.status === 'draft' ? 'selected' : ''}>Borrador privado</option><option value="published" ${assignment.status === 'published' ? 'selected' : ''}>Publicada</option><option value="closed" ${assignment.status === 'closed' ? 'selected' : ''}>Cerrada</option></select></label></div><div class="task-existing-file"><div><span>Material adjunto</span><small>${assignment.attachment_path ? 'Archivo almacenado de forma privada.' : 'Esta tarea no tiene archivo.'}</small></div>${assignment.attachment_path ? `<button class="file-link" type="button" data-file-path="${escapeHtml(assignment.attachment_path)}">Abrir material</button>` : '<span class="detail-muted">Sin archivo</span>'}</div><div class="task-edit-footer"><button class="danger-button" type="button" data-delete-assignment="${assignment.id}" data-delete-title="${escapeHtml(assignment.title)}"><span>Eliminar tarea</span></button><button class="primary-button auth-submit" type="submit"><span>Guardar cambios</span><span>→</span></button></div><p class="task-delete-note">Eliminar también borra sus entregas, calificaciones y archivos privados.</p><p class="form-feedback" data-task-edit-feedback aria-live="polite"></p></form>`;
      return;
    }
    const submissionResult = await withTimeout(
      supabaseClient.from('submissions').select('id, content, file_path, submitted_at, grades(score, feedback)').eq('assignment_id', assignment.id).eq('student_id', currentUser.id).maybeSingle(),
      12000,
      'Tu entrega tardó demasiado en cargar.'
    );
    if (requestId !== taskModalRequest) return;
    if (submissionResult.error) throw new Error(submissionResult.error.message);
    const submission = submissionResult.data;
    const grade = relatedOne(submission?.grades);
    let submissionState = `<button class="primary-button" type="button" data-submit-assignment="${assignment.id}" data-submit-title="${escapeHtml(assignment.title)}">Entregar tarea <span>→</span></button>`;
    if (grade) submissionState = `<div class="task-grade-result"><span>Calificación</span><strong>${Number(grade.score).toFixed(1)} <em>/ 10</em></strong><p>${escapeHtml(grade.feedback || 'Calificación publicada.')}</p></div>`;
    else if (submission) submissionState = `<div class="task-submitted-state"><span>✓</span><div><strong>Entrega enviada</strong><small>${formatLongDate(submission.submitted_at)}${assignment.status === 'published' ? ' · Aún puedes editarla' : ''}</small></div>${submission.file_path ? `<button class="file-link" type="button" data-file-path="${escapeHtml(submission.file_path)}">Mi archivo</button>` : ''}${assignment.status === 'published' ? `<button class="submission-edit-button" type="button" data-edit-submission-assignment="${assignment.id}" data-submit-title="${escapeHtml(assignment.title)}">Editar entrega</button>` : ''}</div>`;
    else if (assignment.status === 'closed') submissionState = '<div class="task-closed-state">Esta tarea está cerrada y ya no acepta entregas.</div>';
    content.innerHTML = `<div class="task-modal-heading"><div><span class="eyebrow accent">${escapeHtml(course.subject || 'Actividad')}</span><h2>${escapeHtml(assignment.title)}</h2><p>${escapeHtml(course.name || 'Curso')}</p></div><span class="task-status-pill ${assignment.status}">${assignmentStatusLabel(assignment.status)}</span></div><div class="task-detail-meta"><div><span>Fecha de entrega</span><strong>${formatAssignmentDate(assignment.due_at)}</strong></div><div><span>Estado</span><strong>${assignmentStatusLabel(assignment.status)}</strong></div><div><span>Privacidad</span><strong>Solo participantes</strong></div></div><section class="task-instructions"><span class="eyebrow">Instrucciones</span><p>${escapeHtml(assignment.description || 'El profesor no añadió instrucciones adicionales.')}</p></section><div class="task-modal-actions">${assignment.attachment_path ? `<button class="secondary-button" type="button" data-file-path="${escapeHtml(assignment.attachment_path)}">Abrir material protegido</button>` : '<span class="detail-muted">Sin material adjunto</span>'}${submissionState}</div><div class="task-privacy-note"><span>✓</span><p>Tu entrega solo puede ser consultada por ti y por el profesor de este curso.</p></div>`;
  } catch (error) {
    if (requestId !== taskModalRequest) return;
    content.innerHTML = `<div class="detail-error task-modal-error"><span>!</span><h2>No se pudo abrir la tarea</h2><p>${escapeHtml(error.message || 'Ocurrió un error inesperado.')}</p></div>`;
  }
}

async function updateAssignment(event) {
  const form = event.target.closest('[data-task-edit-form]');
  if (!form) return;
  event.preventDefault();
  const feedback = form.querySelector('[data-task-edit-feedback]');
  const button = form.querySelector('button[type="submit"]');
  const status = form.elements.namedItem('status').value;
  const assignmentId = form.dataset.assignmentId;
  const payload = {
    title: form.elements.namedItem('title').value.trim(),
    description: form.elements.namedItem('description').value.trim(),
    due_at: form.elements.namedItem('due_at').value || null,
    status
  };
  if (!payload.title || !payload.description) {
    feedback.textContent = 'Completa el título y las instrucciones.';
    return;
  }
  button.disabled = true;
  feedback.className = 'form-feedback';
  feedback.textContent = 'Guardando cambios...';
  try {
    const result = await withTimeout(
      supabaseClient.from('assignments').update(payload).eq('id', assignmentId).select('id').maybeSingle(),
      12000,
      'La actualización tardó demasiado.'
    );
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error('RLS bloqueó la actualización porque no eres el profesor de este curso.');
    const detailId = currentCourseDetailId;
    closeTaskModal();
    showToast(`Tarea ${status === 'draft' ? 'guardada como borrador' : status === 'closed' ? 'cerrada' : 'publicada'}.`);
    await logAudit('assignment_updated', 'assignment', { assignment_id: assignmentId, status });
    await loadTeacherCourses();
    if (detailId) await openCourseDetail(detailId);
  } catch (error) {
    feedback.textContent = error.message || 'No se pudo actualizar la tarea.';
    button.disabled = false;
  }
}

async function deleteAssignment(button) {
  const assignmentId = button?.dataset.deleteAssignment;
  const assignmentTitle = button?.dataset.deleteTitle || 'esta tarea';
  if (!assignmentId) return;
  const confirmed = window.confirm(`¿Eliminar “${assignmentTitle}”?\n\nTambién se eliminarán sus entregas, calificaciones y archivos privados. Esta acción no se puede deshacer.`);
  if (!confirmed) return;

  const feedback = button.closest('form')?.querySelector('[data-task-edit-feedback]');
  const originalContent = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span>Eliminando...</span>';
  if (feedback) {
    feedback.className = 'form-feedback';
    feedback.textContent = 'Eliminando datos y archivos protegidos...';
  }

  try {
    const [assignmentResult, submissionsResult] = await withTimeout(Promise.all([
      supabaseClient.from('assignments').select('id, title, attachment_path').eq('id', assignmentId).maybeSingle(),
      supabaseClient.from('submissions').select('file_path').eq('assignment_id', assignmentId)
    ]), 12000, 'Preparar la eliminación tardó demasiado.');
    if (assignmentResult.error) throw new Error(assignmentResult.error.message);
    if (submissionsResult.error) throw new Error(submissionsResult.error.message);
    if (!assignmentResult.data) throw new Error('RLS bloqueó la eliminación porque no eres el profesor de este curso.');

    const protectedPaths = [
      assignmentResult.data.attachment_path,
      ...(submissionsResult.data || []).map((submission) => submission.file_path)
    ].filter(Boolean);
    const uniquePaths = [...new Set(protectedPaths)];
    if (uniquePaths.length) {
      const storageResult = await withTimeout(
        supabaseClient.storage.from('course-files').remove(uniquePaths),
        15000,
        'Eliminar los archivos privados tardó demasiado.'
      );
      if (storageResult.error) throw new Error(`No se pudieron eliminar los archivos: ${storageResult.error.message}`);
    }

    const deleteResult = await withTimeout(
      supabaseClient.from('assignments').delete().eq('id', assignmentId).select('id').maybeSingle(),
      12000,
      'Eliminar la tarea tardó demasiado.'
    );
    if (deleteResult.error) throw new Error(deleteResult.error.message);
    if (!deleteResult.data) throw new Error('RLS bloqueó la eliminación de esta tarea.');

    const detailId = currentCourseDetailId;
    closeTaskModal();
    showToast('Tarea eliminada junto con sus datos asociados.');
    await logAudit('assignment_deleted', 'assignment', { assignment_id: assignmentId, deleted_files: uniquePaths.length });
    await loadTeacherCourses();
    if (detailId) await openCourseDetail(detailId);
  } catch (error) {
    if (feedback) feedback.textContent = error.message || 'No se pudo eliminar la tarea.';
    else showToast(`No se pudo eliminar la tarea: ${error.message || 'Error inesperado.'}`);
    button.disabled = false;
    button.innerHTML = originalContent;
  }
}

async function updateCourseStatus(button) {
  const courseId = button.dataset.courseStatusId;
  const nextStatus = button.dataset.nextCourseStatus;
  if (!courseId || !['active', 'archived'].includes(nextStatus)) return;
  if (nextStatus === 'archived' && !window.confirm('¿Archivar este curso? Los estudiantes dejarán de verlo hasta que lo reactives.')) return;
  button.disabled = true;
  try {
    const result = await withTimeout(
      supabaseClient.from('courses').update({ status: nextStatus }).eq('id', courseId).select('id').maybeSingle(),
      12000,
      'Actualizar el curso tardó demasiado.'
    );
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error('RLS bloqueó el cambio porque no eres el propietario del curso.');
    showToast(nextStatus === 'archived' ? 'Curso archivado. Puedes reactivarlo cuando quieras.' : 'Curso reactivado correctamente.');
    await logAudit(nextStatus === 'archived' ? 'course_archived' : 'course_reactivated', 'course', { course_id: courseId });
    await loadTeacherCourses();
    await openCourseDetail(courseId);
  } catch (error) {
    showToast(`No se pudo actualizar el curso: ${error.message}`);
    button.disabled = false;
  }
}

async function joinCourse(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const feedback = document.getElementById('join-course-feedback');
  const code = document.getElementById('join-course-code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    feedback.className = 'form-feedback';
    feedback.textContent = 'Escribe el código completo de 6 caracteres.';
    return;
  }
  button.disabled = true;
  feedback.className = 'form-feedback';
  feedback.textContent = 'Comprobando invitación...';
  try {
    const result = await withTimeout(supabaseClient.rpc('join_course_by_code', { course_code: code }), 12000, 'La matrícula tardó demasiado.');
    if (result.error) throw new Error(result.error.message);
    form.reset();
    feedback.className = 'form-feedback success';
    feedback.textContent = 'Te uniste al curso correctamente.';
    showToast('Curso añadido a tu cuenta.');
    await loadStudentDashboard();
  } catch (error) {
    feedback.textContent = error.message || 'No fue posible unirte al curso.';
  } finally {
    button.disabled = false;
  }
}

async function copyCourseCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    showToast(`Código ${code} copiado.`);
  } catch {
    showToast(`Código del curso: ${code}`);
  }
}

async function createCourse(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = document.getElementById('course-feedback');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  feedback.textContent = '';
  const payload = {
    teacher_id: currentUser.id,
    name: document.getElementById('course-name').value.trim(),
    subject: document.getElementById('course-subject').value.trim(),
    description: document.getElementById('course-description').value.trim()
  };
  const { error } = await supabaseClient.from('courses').insert(payload);
  if (error) feedback.textContent = error.message;
  else {
    feedback.textContent = 'Curso creado correctamente.';
    feedback.className = 'form-feedback success';
    form.reset();
    await loadTeacherCourses();
  }
  button.disabled = false;
}

async function createAssignment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = document.getElementById('assignment-feedback');
  const button = form.querySelector('button[type="submit"]');
  const courseId = document.getElementById('assignment-course').value;
  const file = document.getElementById('assignment-file').files[0];
  if (!courseId) {
    feedback.className = 'form-feedback';
    feedback.textContent = 'Primero selecciona el curso al que pertenece esta tarea.';
    return;
  }
  button.disabled = true;
  feedback.className = 'form-feedback';
  feedback.textContent = 'Guardando tarea...';
  let attachmentPath = null;
  let assignmentCreated = false;
  try {
    if (file) {
      if (file.size > 10 * 1024 * 1024) throw new Error('El archivo supera el límite de 10 MB.');
      attachmentPath = `assignments/${courseId}/${currentUser.id}/${crypto.randomUUID()}-${file.name}`;
      const upload = await withTimeout(supabaseClient.storage.from('course-files').upload(attachmentPath, file, { upsert: false }), 15000, 'La subida tardó demasiado. Comprueba tu conexión y las políticas del bucket.');
      if (upload.error) throw new Error(`No se pudo subir el archivo: ${upload.error.message}`);
    }
    const status = document.getElementById('assignment-status').value;
    const result = await withTimeout(supabaseClient.from('assignments').insert({
      course_id: courseId,
      created_by: currentUser.id,
      title: document.getElementById('assignment-title').value.trim(),
      description: document.getElementById('assignment-description').value.trim(),
      due_at: document.getElementById('assignment-due').value || null,
      status,
      attachment_path: attachmentPath
    }), 15000, 'Guardar la tarea tardó demasiado. Comprueba tu conexión y las políticas RLS.');
    if (result.error) throw new Error(result.error.message);
    assignmentCreated = true;
    form.reset();
    document.getElementById('assignment-file-name').textContent = 'Selecciona un archivo';
    feedback.textContent = status === 'draft' ? 'Borrador guardado correctamente.' : `Tarea publicada${attachmentPath ? ' con material protegido' : ''}.`;
    feedback.className = 'form-feedback success';
    await logAudit('assignment_created', 'assignment', { has_file: Boolean(attachmentPath), status });
    await loadTeacherCourses();
  } catch (error) {
    if (attachmentPath && !assignmentCreated) await supabaseClient.storage.from('course-files').remove([attachmentPath]);
    feedback.textContent = error.message || 'No se pudo publicar la tarea.';
    feedback.className = 'form-feedback';
  } finally {
    button.disabled = false;
  }
}

async function openProtectedFile(path) {
  if (!path || !supabaseClient) return;
  const { data, error } = await supabaseClient.storage.from('course-files').createSignedUrl(path, 60);
  if (error) {
    window.alert(`No se pudo abrir el archivo: ${error.message}`);
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}

function submissionFileName(path = '') {
  return String(path).split('/').pop().replace(/^[0-9a-f-]{36}-/i, '') || 'Archivo actual';
}

function resetSubmissionModal() {
  const form = document.getElementById('submission-form');
  form.reset();
  document.getElementById('submission-assignment-id').value = '';
  document.getElementById('submission-id').value = '';
  document.getElementById('submission-current-file').value = '';
  document.getElementById('submission-modal-eyebrow').textContent = 'Entrega privada';
  document.getElementById('submission-title').textContent = 'Entregar tarea';
  document.getElementById('submission-file-label').textContent = 'Archivo de entrega';
  document.getElementById('submission-file-name').textContent = 'Selecciona tu entrega';
  document.getElementById('submission-file-help').textContent = 'Tu archivo solo será visible para ti y tu profesor.';
  document.getElementById('submission-submit-label').textContent = 'Enviar entrega';
  document.getElementById('submission-file').required = true;
  const feedback = document.getElementById('submission-feedback');
  feedback.className = 'form-feedback';
  feedback.textContent = '';
}

function closeSubmissionModal() {
  document.getElementById('submission-modal').classList.add('hidden');
  resetSubmissionModal();
}

async function openSubmissionModal(assignmentId, title, editing = false) {
  if (!assignmentId || !supabaseClient || !currentUser) return;
  resetSubmissionModal();
  const modal = document.getElementById('submission-modal');
  const feedback = document.getElementById('submission-feedback');
  const submitButton = document.querySelector('#submission-form button[type="submit"]');
  const fileInput = document.getElementById('submission-file');
  document.getElementById('submission-assignment-id').value = assignmentId;
  document.getElementById('submission-title').textContent = editing ? `Editar entrega · ${title}` : title;
  modal.classList.remove('hidden');
  if (!editing) return;

  document.getElementById('submission-modal-eyebrow').textContent = 'Entrega sin calificar';
  document.getElementById('submission-file-label').textContent = 'Reemplazar archivo (opcional)';
  document.getElementById('submission-submit-label').textContent = 'Guardar cambios';
  fileInput.required = false;
  submitButton.disabled = true;
  feedback.textContent = 'Cargando tu entrega...';
  let canEdit = false;
  try {
    const result = await withTimeout(
      supabaseClient.from('submissions').select('id, content, file_path, grades(id), assignments(status)').eq('assignment_id', assignmentId).eq('student_id', currentUser.id).maybeSingle(),
      12000,
      'Tu entrega tardó demasiado en cargar.'
    );
    if (result.error) throw new Error(result.error.message);
    const submission = result.data;
    if (!submission) throw new Error('No se encontró una entrega editable para esta tarea.');
    if (relatedOne(submission.grades)) throw new Error('Esta entrega ya fue calificada y quedó bloqueada para proteger la nota.');
    if (relatedOne(submission.assignments)?.status !== 'published') throw new Error('La tarea está cerrada y ya no permite cambios.');
    document.getElementById('submission-id').value = submission.id;
    document.getElementById('submission-current-file').value = submission.file_path || '';
    document.getElementById('submission-content').value = submission.content || '';
    document.getElementById('submission-file-name').textContent = submission.file_path ? `Actual: ${submissionFileName(submission.file_path)}` : 'Selecciona un archivo';
    document.getElementById('submission-file-help').textContent = submission.file_path
      ? 'Si no eliges otro archivo, se conservará el actual. Solo tú y tu profesor pueden verlo.'
      : 'Esta entrega no tiene archivo; selecciona uno antes de guardar.';
    fileInput.required = !submission.file_path;
    feedback.textContent = '';
    canEdit = true;
  } catch (error) {
    feedback.textContent = error.message || 'No se pudo cargar tu entrega.';
  } finally {
    submitButton.disabled = !canEdit;
  }
}

async function createSubmission(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = document.getElementById('submission-feedback');
  const button = form.querySelector('button[type="submit"]');
  const assignmentId = document.getElementById('submission-assignment-id').value;
  const submissionId = document.getElementById('submission-id').value;
  const currentFilePath = document.getElementById('submission-current-file').value;
  const file = document.getElementById('submission-file').files[0];
  const isEditing = Boolean(submissionId);
  if (!file && !currentFilePath) {
    feedback.textContent = 'Selecciona un archivo para enviar tu entrega.';
    return;
  }
  button.disabled = true;
  feedback.className = 'form-feedback';
  feedback.textContent = isEditing ? 'Guardando cambios...' : 'Enviando entrega...';
  let filePath = null;
  let submissionSaved = false;
  try {
    if (file) {
      if (file.size > 10 * 1024 * 1024) throw new Error('El archivo supera el límite de 10 MB.');
      filePath = `submissions/${assignmentId}/${currentUser.id}/${crypto.randomUUID()}-${file.name}`;
      const upload = await withTimeout(supabaseClient.storage.from('course-files').upload(filePath, file, { upsert: false }), 15000, 'La subida tardó demasiado. Comprueba tu conexión y Storage.');
      if (upload.error) throw new Error(upload.error.message);
    }
    const content = document.getElementById('submission-content').value.trim();
    const request = isEditing
      ? supabaseClient.from('submissions').update({ content, submitted_at: new Date().toISOString(), ...(filePath ? { file_path: filePath } : {}) }).eq('id', submissionId).eq('student_id', currentUser.id).select('id').maybeSingle()
      : supabaseClient.from('submissions').insert({ assignment_id: assignmentId, student_id: currentUser.id, content, file_path: filePath }).select('id').single();
    const result = await withTimeout(request, 15000, isEditing ? 'Actualizar la entrega tardó demasiado.' : 'Guardar la entrega tardó demasiado.');
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error('RLS bloqueó el cambio. La tarea puede estar cerrada o la entrega ya fue calificada.');
    submissionSaved = true;
    if (isEditing && filePath && currentFilePath && currentFilePath !== filePath) {
      const cleanup = await supabaseClient.storage.from('course-files').remove([currentFilePath]);
      if (cleanup.error) console.warn('No se pudo limpiar el archivo anterior:', cleanup.error.message);
    }
    const detailId = currentCourseDetailId;
    closeSubmissionModal();
    showToast(isEditing ? 'Entrega actualizada correctamente.' : 'Entrega enviada correctamente.');
    await logAudit(isEditing ? 'submission_updated' : 'submission_created', 'submission', { assignment_id: assignmentId, replaced_file: Boolean(isEditing && filePath) });
    await loadStudentDashboard();
    if (detailId) await openCourseDetail(detailId);
  } catch (error) {
    if (filePath && !submissionSaved) await supabaseClient.storage.from('course-files').remove([filePath]);
    feedback.textContent = error.message || (isEditing ? 'No se pudo actualizar la entrega.' : 'No se pudo enviar la entrega.');
  } finally {
    button.disabled = false;
  }
}

async function gradeSubmission(button) {
  const submissionId = button?.dataset.gradeSubmit;
  const scope = button?.closest('.submission-card, .detail-review-row');
  const score = Number(scope?.querySelector(`[data-grade-score="${submissionId}"]`)?.value);
  const feedback = scope?.querySelector(`[data-grade-feedback="${submissionId}"]`)?.value.trim() || 'Calificación publicada.';
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    showToast('Escribe una nota válida entre 0 y 10.');
    return;
  }
  button.disabled = true;
  const gradeId = button.dataset.gradeId;
  try {
    const request = gradeId
      ? supabaseClient.from('grades').update({ score, feedback }).eq('id', gradeId).select('id').maybeSingle()
      : supabaseClient.from('grades').insert({ submission_id: submissionId, graded_by: currentUser.id, score, feedback }).select('id').single();
    const result = await withTimeout(request, 12000, 'Guardar la calificación tardó demasiado.');
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error('RLS bloqueó la actualización de esta calificación.');
    const detailId = currentCourseDetailId;
    showToast(gradeId ? 'Calificación actualizada.' : 'Calificación publicada correctamente.');
    await logAudit(gradeId ? 'grade_updated' : 'grade_created', 'grade', { submission_id: submissionId, score });
    await loadTeacherCourses();
    if (detailId) await openCourseDetail(detailId);
  } catch (error) {
    showToast(`No se pudo calificar: ${error.message}`);
    button.disabled = false;
  }
}

async function loadProfile(user) {
  if (!supabaseClient) return {};
  const { data } = await supabaseClient.from('profiles').select('full_name, role').eq('id', user.id).maybeSingle();
  return data || {};
}

async function handleAuth(event) {
  event.preventDefault();
  showMessage('');
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const name = fullNameInput.value.trim();
  const submitButton = authForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  authSubmitLabel.textContent = authMode === 'login' ? 'Verificando...' : 'Creando cuenta...';

  if (!supabaseClient) {
    showMessage('Configura config.js con la URL y anon key de Supabase para activar Auth.');
    submitButton.disabled = false;
    authSubmitLabel.textContent = authMode === 'login' ? 'Entrar al portal' : 'Crear mi cuenta';
    return;
  }

  const result = authMode === 'login'
    ? await supabaseClient.auth.signInWithPassword({ email, password })
    : await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name, role: roleInput.value } } });

  if (result.error) showMessage(result.error.message);
  else if (authMode === 'signup') showMessage('Cuenta creada. Revisa tu correo para confirmar el acceso.', 'success');
  else if (result.data.user) setAuthenticated(result.data.user, await loadProfile(result.data.user));

  submitButton.disabled = false;
  authSubmitLabel.textContent = authMode === 'login' ? 'Entrar al portal' : 'Crear mi cuenta';
}

function setAuthMode(mode) {
  authMode = mode;
  modeTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.authMode === mode));
  const signup = mode === 'signup';
  signupFields.forEach((field) => field.classList.toggle('hidden', !signup));
  authTitle.textContent = signup ? 'Crea tu cuenta' : 'Bienvenido de nuevo';
  authSubtitle.textContent = signup ? 'Únete a tu espacio académico seguro.' : 'Ingresa para continuar con tus clases.';
  authSubmitLabel.textContent = signup ? 'Crear mi cuenta' : 'Entrar al portal';
  showMessage('');
}

modeTabs.forEach((tab) => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
authForm.addEventListener('submit', handleAuth);
document.getElementById('course-form').addEventListener('submit', createCourse);
document.getElementById('join-course-form').addEventListener('submit', joinCourse);
document.getElementById('assignment-form').addEventListener('submit', createAssignment);
document.getElementById('new-course-button').addEventListener('click', () => openTeacherComposer('course'));
document.getElementById('close-course-form').addEventListener('click', () => document.getElementById('course-form-panel').classList.add('hidden'));
document.getElementById('student-task-list').addEventListener('click', (event) => {
  const fileButton = event.target.closest('[data-file-path]');
  if (fileButton) openProtectedFile(fileButton.dataset.filePath);
  const submitButton = event.target.closest('[data-submit-assignment]');
  if (submitButton) openSubmissionModal(submitButton.dataset.submitAssignment, submitButton.dataset.submitTitle);
  const editSubmissionButton = event.target.closest('[data-edit-submission-assignment]');
  if (editSubmissionButton) openSubmissionModal(editSubmissionButton.dataset.editSubmissionAssignment, editSubmissionButton.dataset.submitTitle, true);
  const detailButton = event.target.closest('[data-view-assignment]');
  if (detailButton) openAssignmentModal(detailButton.dataset.viewAssignment);
});
document.getElementById('space-file-list').addEventListener('click', (event) => {
  const fileButton = event.target.closest('[data-file-path]');
  if (fileButton) openProtectedFile(fileButton.dataset.filePath);
});
document.getElementById('course-list').addEventListener('click', (event) => {
  const codeButton = event.target.closest('[data-copy-code]');
  if (codeButton) copyCourseCode(codeButton.dataset.copyCode);
  const courseButton = event.target.closest('[data-open-course]');
  if (courseButton) openCourseDetail(courseButton.dataset.openCourse);
});
document.getElementById('space-course-list').addEventListener('click', (event) => {
  const codeButton = event.target.closest('[data-copy-code]');
  if (codeButton) copyCourseCode(codeButton.dataset.copyCode);
  const courseButton = event.target.closest('[data-open-course]');
  if (courseButton) openCourseDetail(courseButton.dataset.openCourse);
});
document.getElementById('space-task-list').addEventListener('click', (event) => {
  const fileButton = event.target.closest('[data-file-path]');
  if (fileButton) openProtectedFile(fileButton.dataset.filePath);
  const submitButton = event.target.closest('[data-submit-assignment]');
  if (submitButton) openSubmissionModal(submitButton.dataset.submitAssignment, submitButton.dataset.submitTitle);
  const editSubmissionButton = event.target.closest('[data-edit-submission-assignment]');
  if (editSubmissionButton) openSubmissionModal(editSubmissionButton.dataset.editSubmissionAssignment, editSubmissionButton.dataset.submitTitle, true);
  const viewButton = event.target.closest('[data-view-assignment]');
  if (viewButton) openAssignmentModal(viewButton.dataset.viewAssignment);
  const editButton = event.target.closest('[data-edit-assignment]');
  if (editButton) openAssignmentModal(editButton.dataset.editAssignment);
  const deleteButton = event.target.closest('[data-delete-assignment]');
  if (deleteButton) deleteAssignment(deleteButton);
});
document.getElementById('task-search').addEventListener('input', filterTaskWorkspace);
document.getElementById('task-status-filter').addEventListener('change', filterTaskWorkspace);
document.getElementById('teacher-course-insights').addEventListener('click', (event) => {
  const courseButton = event.target.closest('[data-open-course]');
  if (courseButton) openCourseDetail(courseButton.dataset.openCourse);
});
document.getElementById('teacher-deadline-list').addEventListener('click', (event) => {
  const editButton = event.target.closest('[data-edit-assignment]');
  if (editButton) openAssignmentModal(editButton.dataset.editAssignment);
  const deleteButton = event.target.closest('[data-delete-assignment]');
  if (deleteButton) deleteAssignment(deleteButton);
});
document.querySelector('[data-teacher-new-task]').addEventListener('click', () => openTeacherComposer('task'));
document.querySelector('[data-teacher-scroll-submissions]').addEventListener('click', focusTeacherSubmissions);
document.getElementById('submission-form').addEventListener('submit', createSubmission);
document.getElementById('close-submission-modal').addEventListener('click', closeSubmissionModal);
document.getElementById('teacher-submission-list').addEventListener('click', (event) => {
  const fileButton = event.target.closest('[data-file-path]');
  if (fileButton) openProtectedFile(fileButton.dataset.filePath);
  const gradeButton = event.target.closest('[data-grade-submit]');
  if (gradeButton) gradeSubmission(gradeButton);
});
document.getElementById('denied-access-test').addEventListener('click', () => runDeniedAccessTest('security-result'));
document.getElementById('open-security-console').addEventListener('click', openSecurityConsole);
document.getElementById('security-console-back').addEventListener('click', () => navigateView('overview'));
document.getElementById('run-security-suite').addEventListener('click', runSecuritySuite);
document.getElementById('refresh-security-audit').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  await loadSecurityAuditLogs();
  event.currentTarget.disabled = false;
  showToast('Registro de auditoría actualizado.');
});
document.getElementById('export-security-audit').addEventListener('click', exportSecurityAudit);
document.getElementById('security-audit-search').addEventListener('input', renderSecurityAuditRows);
document.getElementById('security-audit-filter').addEventListener('change', renderSecurityAuditRows);
document.getElementById('course-detail-back').addEventListener('click', () => navigateView('courses'));
document.getElementById('course-detail-view').addEventListener('click', (event) => {
  const backButton = event.target.closest('[data-course-back]');
  if (backButton) navigateView('courses');
  const fileButton = event.target.closest('[data-file-path]');
  if (fileButton) openProtectedFile(fileButton.dataset.filePath);
  const submitButton = event.target.closest('[data-submit-assignment]');
  if (submitButton) openSubmissionModal(submitButton.dataset.submitAssignment, submitButton.dataset.submitTitle);
  const editSubmissionButton = event.target.closest('[data-edit-submission-assignment]');
  if (editSubmissionButton) openSubmissionModal(editSubmissionButton.dataset.editSubmissionAssignment, editSubmissionButton.dataset.submitTitle, true);
  const codeButton = event.target.closest('[data-copy-code]');
  if (codeButton) copyCourseCode(codeButton.dataset.copyCode);
  const refreshButton = event.target.closest('[data-refresh-course]');
  if (refreshButton) openCourseDetail(refreshButton.dataset.refreshCourse);
  const taskButton = event.target.closest('[data-course-new-task]');
  if (taskButton) openTeacherComposer('task', taskButton.dataset.courseNewTask);
  const courseStatusButton = event.target.closest('[data-course-status-id]');
  if (courseStatusButton) updateCourseStatus(courseStatusButton);
  const gradeButton = event.target.closest('[data-grade-submit]');
  if (gradeButton) gradeSubmission(gradeButton);
  const viewButton = event.target.closest('[data-view-assignment]');
  if (viewButton) openAssignmentModal(viewButton.dataset.viewAssignment);
  const editButton = event.target.closest('[data-edit-assignment]');
  if (editButton) openAssignmentModal(editButton.dataset.editAssignment);
  const deleteButton = event.target.closest('[data-delete-assignment]');
  if (deleteButton) deleteAssignment(deleteButton);
  if (event.target.closest('[data-course-security-test]')) runDeniedAccessTest('course-security-result');
});
document.getElementById('close-task-modal').addEventListener('click', closeTaskModal);
document.getElementById('task-modal').addEventListener('click', (event) => {
  if (event.target.id === 'task-modal') closeTaskModal();
  const fileButton = event.target.closest('[data-file-path]');
  if (fileButton) openProtectedFile(fileButton.dataset.filePath);
  const submitButton = event.target.closest('[data-submit-assignment]');
  if (submitButton) {
    closeTaskModal();
    openSubmissionModal(submitButton.dataset.submitAssignment, submitButton.dataset.submitTitle);
  }
  const editSubmissionButton = event.target.closest('[data-edit-submission-assignment]');
  if (editSubmissionButton) {
    closeTaskModal();
    openSubmissionModal(editSubmissionButton.dataset.editSubmissionAssignment, editSubmissionButton.dataset.submitTitle, true);
  }
  const deleteButton = event.target.closest('[data-delete-assignment]');
  if (deleteButton) deleteAssignment(deleteButton);
});
document.getElementById('task-modal').addEventListener('submit', updateAssignment);
document.getElementById('open-guide').addEventListener('click', () => document.getElementById('guide-modal').classList.remove('hidden'));
document.getElementById('close-guide').addEventListener('click', () => document.getElementById('guide-modal').classList.add('hidden'));
document.getElementById('guide-modal').addEventListener('click', (event) => {
  if (event.target.id === 'guide-modal') event.currentTarget.classList.add('hidden');
});
document.getElementById('assignment-file').addEventListener('change', (event) => {
  document.getElementById('assignment-file-name').textContent = event.target.files[0]?.name || 'Selecciona un archivo';
});
document.getElementById('submission-file').addEventListener('change', (event) => {
  const currentFile = document.getElementById('submission-current-file').value;
  document.getElementById('submission-file-name').textContent = event.target.files[0]?.name || (currentFile ? `Actual: ${submissionFileName(currentFile)}` : 'Selecciona tu entrega');
});
document.getElementById('workspace-new-course').addEventListener('click', () => openTeacherComposer('course'));
document.getElementById('workspace-new-task').addEventListener('click', () => openTeacherComposer('task'));
document.getElementById('profile-button').addEventListener('click', () => {
  const role = currentProfile.role || currentUser?.user_metadata?.role || 'student';
  showToast(`Sesión activa: ${role === 'teacher' ? 'Profesor/a' : 'Estudiante'}. Usa “Cerrar sesión” para cambiar de cuenta.`);
});
document.getElementById('notifications-button').addEventListener('click', openNotificationCenter);
document.getElementById('close-notifications').addEventListener('click', closeNotificationCenter);
document.getElementById('notification-backdrop').addEventListener('click', closeNotificationCenter);
document.getElementById('refresh-notifications').addEventListener('click', refreshNotifications);
document.getElementById('mark-all-notifications-read').addEventListener('click', markAllNotificationsRead);
document.querySelectorAll('[data-notification-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    notificationFilter = button.dataset.notificationFilter;
    renderNotificationCenter();
  });
});
document.getElementById('notification-list').addEventListener('click', async (event) => {
  const readButton = event.target.closest('[data-mark-notification]');
  if (readButton) {
    toggleNotificationRead(readButton.dataset.markNotification);
    return;
  }
  const actionButton = event.target.closest('[data-notification-action]');
  if (actionButton) await handleNotificationAction(actionButton.dataset.notificationAction);
});
document.getElementById('notification-open-security').addEventListener('click', () => {
  closeNotificationCenter();
  openSecurityConsole();
});
document.getElementById('theme-toggle').addEventListener('click', () => {
  const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
  applyTheme(nextTheme);
  showToast(nextTheme === 'dark' ? 'Modo oscuro activado.' : 'Modo claro activado.');
});
document.getElementById('period-toggle').addEventListener('click', (event) => {
  const showingAll = event.currentTarget.dataset.mode === 'all';
  event.currentTarget.dataset.mode = showingAll ? 'period' : 'all';
  event.currentTarget.textContent = showingAll ? 'Este periodo⌄' : 'Todas las notas⌃';
  showToast(showingAll ? 'Mostrando calificaciones del periodo actual.' : 'Mostrando todas las calificaciones disponibles.');
});
document.addEventListener('mouseup', (event) => {
  if (event.target.closest('input, textarea')) return;
  window.getSelection()?.removeAllRanges();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeTaskModal();
  closeNotificationCenter();
  closeSubmissionModal();
  document.getElementById('guide-modal').classList.add('hidden');
});
logoutButton.addEventListener('click', async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  showLoggedOut();
});

function navigateView(view) {
  const role = currentProfile.role || currentUser?.user_metadata?.role || 'student';
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  currentCourseDetailId = null;
  courseDetailRequest += 1;
  hideWorkspaceSections();
  if (view === 'overview') {
    showRoleView(role);
    return;
  }
  if (role === 'teacher') {
    document.querySelector('.page-heading').classList.add('hidden');
    document.querySelector('.stats-grid').classList.add('hidden');
    document.querySelector('.dashboard-grid').classList.add('hidden');
    document.getElementById('role-help').classList.add('hidden');
    document.getElementById('teacher-view').classList.add('hidden');
    const teacherSpace = document.getElementById(`workspace-${view}`);
    if (teacherSpace) teacherSpace.classList.remove('hidden');
    return;
  }
  document.querySelector('.page-heading').classList.add('hidden');
  document.querySelector('.stats-grid').classList.add('hidden');
  document.querySelector('.dashboard-grid').classList.add('hidden');
  document.getElementById('role-help').classList.add('hidden');
  const studentSpace = document.getElementById(`workspace-${view}`);
  if (studentSpace) studentSpace.classList.remove('hidden');
}

function focusTeacherSubmissions() {
  navigateView('overview');
  window.setTimeout(() => document.querySelector('.submissions-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
}

function openTeacherComposer(type, courseId = '') {
  currentCourseDetailId = null;
  courseDetailRequest += 1;
  hideWorkspaceSections();
  showRoleView('teacher', false);
  const target = type === 'course' ? document.getElementById('course-form-panel') : document.getElementById('assignment-form-panel');
  if (type === 'course') target.classList.remove('hidden');
  if (type === 'task' && courseId) document.getElementById('assignment-course').value = courseId;
  window.setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

document.querySelector('.main-nav').addEventListener('click', (event) => {
  const item = event.target.closest('[data-view]');
  if (!item) return;
  event.preventDefault();
  document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.remove('active'));
  item.classList.add('active');
  navigateView(item.dataset.view);
});
document.querySelectorAll('[data-view]:not(.nav-item)').forEach((item) => {
  item.addEventListener('click', () => navigateView(item.dataset.view));
});

async function bootstrap() {
  if (!supabaseClient) {
    showLoggedOut();
    return;
  }
  const { data } = await supabaseClient.auth.getSession();
  if (data.session?.user) setAuthenticated(data.session.user, await loadProfile(data.session.user));
  else showLoggedOut();
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) setAuthenticated(session.user, await loadProfile(session.user));
    else showLoggedOut();
  });
}

bootstrap();
applyTheme(localStorage.getItem('aulasegura-theme') || 'light');
