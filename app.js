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

function showMessage(message, type = '') {
  authFeedback.textContent = message;
  authFeedback.className = `auth-feedback ${type}`;
}

function setAuthenticated(user, profile = {}) {
  currentUser = user;
  currentProfile = profile;
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  logoutButton.classList.remove('hidden');
  const name = profile.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Estudiante';
  const role = profile.role || user.user_metadata?.role || 'student';
  const roleLabel = role === 'teacher' ? 'Profesor/a' : 'Estudiante';
  document.querySelector('.profile-chip strong').textContent = name;
  document.querySelector('.profile-chip small').textContent = roleLabel;
  document.getElementById('welcome-copy').textContent = `Aquí tienes un vistazo de tu actividad académica, ${name.split(' ')[0]}.`;
  document.querySelector('.page-heading h1').innerHTML = `Buenos días, ${name.split(' ')[0]} <span>✦</span>`;
  showRoleView(role);
  loadAuditLogs();
}

function showLoggedOut() {
  currentUser = null;
  currentProfile = {};
  authScreen.classList.remove('hidden');
  appShell.classList.add('hidden');
  logoutButton.classList.add('hidden');
}

function showRoleView(role) {
  const isTeacher = role === 'teacher';
  document.querySelector('.page-heading').classList.toggle('hidden', isTeacher);
  document.querySelector('.stats-grid').classList.toggle('hidden', isTeacher);
  document.querySelector('.dashboard-grid').classList.toggle('hidden', isTeacher);
  document.getElementById('teacher-view').classList.toggle('hidden', !isTeacher);
  if (isTeacher) loadTeacherCourses();
  else loadStudentDashboard();
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function formatDueDate(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return 'Mañana';
  return date.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
}

function subjectClass(subject = '') {
  const first = subject.toLowerCase()[0] || 'a';
  return first < 'h' ? 'orange' : first < 'r' ? 'violet' : 'teal';
}

async function logAudit(action, entityType, metadata = {}) {
  if (!supabaseClient || !currentUser) return;
  await supabaseClient.rpc('log_audit_event', { event_action: action, event_entity_type: entityType, event_metadata: metadata });
  await loadAuditLogs();
}

async function loadAuditLogs() {
  if (!supabaseClient || !currentUser) return;
  const { data } = await supabaseClient.from('audit_logs').select('action, entity_type, created_at').eq('actor_id', currentUser.id).order('created_at', { ascending: false }).limit(4);
  const list = document.getElementById('audit-list');
  if (!data?.length) {
    list.innerHTML = '<small>Sin actividad reciente.</small>';
    return;
  }
  list.innerHTML = data.map((log) => `<div class="audit-row"><span class="audit-icon">✓</span><span>${escapeHtml(log.action.replaceAll('_', ' '))}</span><span class="audit-time">${new Date(log.created_at).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('');
}

async function runDeniedAccessTest() {
  const result = document.getElementById('security-result');
  result.textContent = 'Comprobando permisos...';
  const { data, error } = await supabaseClient.from('profiles').select('id, full_name').neq('id', currentUser.id).limit(1);
  if (error) {
    result.textContent = `La política bloqueó la consulta: ${error.message}`;
    result.className = 'security-result denied';
    await logAudit('denied_access_test', 'profiles', { result: 'blocked_error' });
    return;
  }
  if (!data?.length) {
    result.textContent = '✓ Acceso bloqueado correctamente: no puedes ver el perfil de otro estudiante.';
    result.className = 'security-result denied';
    await logAudit('denied_access_test', 'profiles', { result: 'blocked_empty' });
  } else {
    result.textContent = '⚠ Revisa las políticas RLS: se obtuvo un perfil no autorizado.';
    result.className = 'security-result';
    await logAudit('denied_access_test', 'profiles', { result: 'unexpected_access' });
  }
}

async function loadStudentDashboard() {
  if (!supabaseClient || !currentUser) return;
  const taskList = document.getElementById('student-task-list');
  const gradeList = document.getElementById('student-grade-list');
  const { data: enrollments, error: enrollmentError } = await supabaseClient
    .from('enrollments')
    .select('course_id, courses (id, name, subject, status)')
    .eq('student_id', currentUser.id);
  if (enrollmentError) {
    taskList.innerHTML = `<div class="empty-state">No se pudieron cargar tus cursos.</div>`;
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
    return;
  }

  const { data: assignments, error: assignmentError } = await supabaseClient
    .from('assignments')
    .select('id, course_id, title, due_at, status, attachment_path, courses (name, subject)')
    .in('course_id', courseIds)
    .eq('status', 'published')
    .order('due_at', { ascending: true });
  if (assignmentError) {
    taskList.innerHTML = '<div class="empty-state">No se pudieron cargar las tareas.</div>';
    return;
  }
  const openAssignments = assignments || [];
  document.getElementById('pending-count').textContent = openAssignments.length;
  taskList.innerHTML = openAssignments.length ? '<div class="empty-state">Preparando tareas...</div>' : '<div class="empty-state">No tienes tareas pendientes.</div>';

  const { data: submissions } = await supabaseClient.from('submissions').select('id, assignment_id').eq('student_id', currentUser.id);
  const submittedIds = new Set((submissions || []).map((submission) => submission.assignment_id));
  taskList.innerHTML = openAssignments.length
    ? openAssignments.slice(0, 4).map((assignment) => `<div class="task-row"><span class="subject-tag ${subjectClass(assignment.courses?.subject)}">${escapeHtml((assignment.courses?.subject || 'CUR').slice(0, 3).toUpperCase())}</span><div><strong>${escapeHtml(assignment.title)}</strong><small>${escapeHtml(assignment.courses?.name || 'Curso')}</small></div>${assignment.attachment_path ? `<button class="file-link" type="button" data-file-path="${escapeHtml(assignment.attachment_path)}">Archivo</button>` : ''}${submittedIds.has(assignment.id) ? '<span class="grade-chip">Entregada</span>' : `<button class="file-link" type="button" data-submit-assignment="${assignment.id}" data-submit-title="${escapeHtml(assignment.title)}">Entregar</button>`}<span class="due">${formatDueDate(assignment.due_at)}</span></div>`).join('')
    : '<div class="empty-state">No tienes tareas pendientes.</div>';
  const submissionIds = (submissions || []).map((submission) => submission.id);
  const { data: grades } = submissionIds.length
    ? await supabaseClient.from('grades').select('score, feedback, submission_id, submissions (assignment_id, assignments (title, courses (name, subject)))').in('submission_id', submissionIds).order('graded_at', { ascending: false })
    : { data: [] };
  const gradeRows = grades || [];
  const scores = gradeRows.map((grade) => Number(grade.score)).filter((score) => Number.isFinite(score));
  const average = scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : '—';
  document.getElementById('average-stat').innerHTML = `${average} <em>/ 10</em>`;
  gradeList.innerHTML = gradeRows.length
    ? gradeRows.slice(0, 4).map((grade) => `<div class="grade-row"><span class="subject-tag ${subjectClass(grade.submissions?.assignments?.courses?.subject)}">${escapeHtml((grade.submissions?.assignments?.courses?.subject || 'CUR').slice(0, 3).toUpperCase())}</span><div><strong>${escapeHtml(grade.submissions?.assignments?.title || 'Actividad')}</strong><small>${escapeHtml(grade.submissions?.assignments?.courses?.name || 'Curso')}</small></div><b class="grade">${Number(grade.score).toFixed(1)}</b></div>`).join('')
    : '<div class="empty-state">Todavía no tienes calificaciones.</div>';
  await loadAuditLogs();
}

function renderCourses(courses) {
  const list = document.getElementById('course-list');
  document.getElementById('course-count').textContent = `${courses.length} ${courses.length === 1 ? 'curso' : 'cursos'}`;
  if (!courses.length) {
    list.innerHTML = '<div class="empty-state">Aún no tienes cursos. Crea el primero para comenzar.</div>';
    return;
  }
  list.innerHTML = courses.map((course) => `<div class="course-card"><span class="course-icon">${course.subject.slice(0, 3).toUpperCase()}</span><div><strong>${course.name}</strong><small>${course.subject} · ${course.description || 'Sin descripción'}</small></div><span class="course-status">Activo</span></div>`).join('');
  document.getElementById('assignment-course').innerHTML = '<option value="">Selecciona un curso</option>' + courses.map((course) => `<option value="${course.id}">${escapeHtml(course.name)} · ${escapeHtml(course.subject)}</option>`).join('');
}

async function loadTeacherCourses() {
  if (!supabaseClient || !currentUser) return;
  const { data, error } = await supabaseClient.from('courses').select('id, name, subject, description, status').eq('teacher_id', currentUser.id).order('created_at', { ascending: false });
  if (error) {
    document.getElementById('course-list').innerHTML = `<div class="empty-state">No se pudieron cargar los cursos: ${error.message}</div>`;
    return;
  }
  renderCourses(data || []);
  await loadTeacherSubmissions((data || []).map((course) => course.id));
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
  const { data: submissions } = await supabaseClient.from('submissions').select('id, assignment_id, student_id, file_path, submitted_at, grades(score, feedback)').in('assignment_id', assignmentIds).order('submitted_at', { ascending: false }).limit(8);
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
    const grade = Array.isArray(submission.grades) ? submission.grades[0] : submission.grades;
    return `<div class="submission-card"><div class="submission-meta"><div><strong>${escapeHtml(names[submission.student_id] || 'Estudiante')}</strong><small>${escapeHtml(assignment?.title || 'Tarea')} · ${escapeHtml(assignment?.courses?.name || 'Curso')}</small></div>${grade ? `<span class="grade-chip">${Number(grade.score).toFixed(1)} / 10</span>` : '<span class="due urgent">Sin calificar</span>'}</div><div class="grade-form">${submission.file_path ? `<button class="file-link" type="button" data-file-path="${escapeHtml(submission.file_path)}">Ver entrega</button>` : ''}${grade ? `<small>${escapeHtml(grade.feedback || 'Calificación registrada')}</small>` : `<input type="number" min="0" max="10" step="0.1" placeholder="Nota" data-grade-score="${submission.id}" /><button type="button" data-grade-submit="${submission.id}">Calificar</button>`}</div></div>`;
  }).join('');
}

async function createCourse(event) {
  event.preventDefault();
  const feedback = document.getElementById('course-feedback');
  const button = event.currentTarget.querySelector('button[type="submit"]');
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
    event.currentTarget.reset();
    await loadTeacherCourses();
  }
  button.disabled = false;
}

async function createAssignment(event) {
  event.preventDefault();
  const feedback = document.getElementById('assignment-feedback');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const courseId = document.getElementById('assignment-course').value;
  const file = document.getElementById('assignment-file').files[0];
  button.disabled = true;
  feedback.className = 'form-feedback';
  feedback.textContent = 'Publicando material...';
  let attachmentPath = null;
  if (file) {
    if (file.size > 10 * 1024 * 1024) {
      feedback.textContent = 'El archivo supera el límite de 10 MB.';
      button.disabled = false;
      return;
    }
    attachmentPath = `assignments/${courseId}/${currentUser.id}/${crypto.randomUUID()}-${file.name}`;
    const upload = await supabaseClient.storage.from('course-files').upload(attachmentPath, file, { upsert: false });
    if (upload.error) {
      feedback.textContent = `No se pudo subir el archivo: ${upload.error.message}`;
      button.disabled = false;
      return;
    }
  }
  const { error } = await supabaseClient.from('assignments').insert({
    course_id: courseId,
    created_by: currentUser.id,
    title: document.getElementById('assignment-title').value.trim(),
    due_at: document.getElementById('assignment-due').value || null,
    status: 'published',
    attachment_path: attachmentPath
  });
  if (error) {
    if (attachmentPath) await supabaseClient.storage.from('course-files').remove([attachmentPath]);
    feedback.textContent = error.message;
  } else {
    event.currentTarget.reset();
    feedback.textContent = 'Tarea publicada y archivo protegido correctamente.';
    feedback.className = 'form-feedback success';
    await logAudit('assignment_created', 'assignment', { has_file: Boolean(attachmentPath) });
  }
  button.disabled = false;
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

function openSubmissionModal(assignmentId, title) {
  document.getElementById('submission-assignment-id').value = assignmentId;
  document.getElementById('submission-title').textContent = title;
  document.getElementById('submission-feedback').textContent = '';
  document.getElementById('submission-modal').classList.remove('hidden');
}

async function createSubmission(event) {
  event.preventDefault();
  const feedback = document.getElementById('submission-feedback');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const assignmentId = document.getElementById('submission-assignment-id').value;
  const file = document.getElementById('submission-file').files[0];
  button.disabled = true;
  feedback.textContent = 'Enviando entrega...';
  const filePath = `submissions/${assignmentId}/${currentUser.id}/${crypto.randomUUID()}-${file.name}`;
  const upload = await supabaseClient.storage.from('course-files').upload(filePath, file, { upsert: false });
  if (upload.error) {
    feedback.textContent = upload.error.message;
    button.disabled = false;
    return;
  }
  const { error } = await supabaseClient.from('submissions').insert({ assignment_id: assignmentId, student_id: currentUser.id, content: document.getElementById('submission-content').value.trim(), file_path: filePath });
  if (error) {
    await supabaseClient.storage.from('course-files').remove([filePath]);
    feedback.textContent = error.message;
  } else {
    document.getElementById('submission-form').reset();
    document.getElementById('submission-modal').classList.add('hidden');
    await logAudit('submission_created', 'submission', { has_file: true });
    await loadStudentDashboard();
  }
  button.disabled = false;
}

async function gradeSubmission(submissionId) {
  const input = document.querySelector(`[data-grade-score="${submissionId}"]`);
  const score = Number(input?.value);
  if (!Number.isFinite(score) || score < 0 || score > 10) return;
  const { error } = await supabaseClient.from('grades').insert({ submission_id: submissionId, graded_by: currentUser.id, score, feedback: 'Calificación publicada.' });
  if (error) window.alert(error.message);
  else {
    await logAudit('grade_created', 'grade', { score });
    await loadTeacherSubmissions((await supabaseClient.from('courses').select('id').eq('teacher_id', currentUser.id)).data?.map((course) => course.id) || []);
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
document.getElementById('assignment-form').addEventListener('submit', createAssignment);
document.getElementById('new-course-button').addEventListener('click', () => document.getElementById('course-form-panel').classList.remove('hidden'));
document.getElementById('close-course-form').addEventListener('click', () => document.getElementById('course-form-panel').classList.add('hidden'));
document.getElementById('student-task-list').addEventListener('click', (event) => {
  const fileButton = event.target.closest('[data-file-path]');
  if (fileButton) openProtectedFile(fileButton.dataset.filePath);
  const submitButton = event.target.closest('[data-submit-assignment]');
  if (submitButton) openSubmissionModal(submitButton.dataset.submitAssignment, submitButton.dataset.submitTitle);
});
document.getElementById('submission-form').addEventListener('submit', createSubmission);
document.getElementById('close-submission-modal').addEventListener('click', () => document.getElementById('submission-modal').classList.add('hidden'));
document.getElementById('teacher-submission-list').addEventListener('click', (event) => {
  const fileButton = event.target.closest('[data-file-path]');
  if (fileButton) openProtectedFile(fileButton.dataset.filePath);
  const gradeButton = event.target.closest('[data-grade-submit]');
  if (gradeButton) gradeSubmission(gradeButton.dataset.gradeSubmit);
});
document.getElementById('denied-access-test').addEventListener('click', runDeniedAccessTest);
logoutButton.addEventListener('click', async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  showLoggedOut();
});

document.querySelectorAll('[data-view]').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.remove('active'));
    if (item.classList.contains('nav-item')) item.classList.add('active');
  });
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
