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
}

function renderCourses(courses) {
  const list = document.getElementById('course-list');
  document.getElementById('course-count').textContent = `${courses.length} ${courses.length === 1 ? 'curso' : 'cursos'}`;
  if (!courses.length) {
    list.innerHTML = '<div class="empty-state">Aún no tienes cursos. Crea el primero para comenzar.</div>';
    return;
  }
  list.innerHTML = courses.map((course) => `<div class="course-card"><span class="course-icon">${course.subject.slice(0, 3).toUpperCase()}</span><div><strong>${course.name}</strong><small>${course.subject} · ${course.description || 'Sin descripción'}</small></div><span class="course-status">Activo</span></div>`).join('');
}

async function loadTeacherCourses() {
  if (!supabaseClient || !currentUser) return;
  const { data, error } = await supabaseClient.from('courses').select('id, name, subject, description, status').eq('teacher_id', currentUser.id).order('created_at', { ascending: false });
  if (error) {
    document.getElementById('course-list').innerHTML = `<div class="empty-state">No se pudieron cargar los cursos: ${error.message}</div>`;
    return;
  }
  renderCourses(data || []);
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
document.getElementById('new-course-button').addEventListener('click', () => document.getElementById('course-form-panel').classList.remove('hidden'));
document.getElementById('close-course-form').addEventListener('click', () => document.getElementById('course-form-panel').classList.add('hidden'));
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
