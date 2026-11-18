// MANNYO website admin — setup, login, and the admin panel.
// Token is stored in localStorage; every change goes through the
// server-side admin-only API, so a logged-out visitor cannot edit anything.
const api = (path, opts = {}) => fetch(path, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
});
let token = localStorage.getItem('mannyo_admin_token') || null;
let setupMode = false;

const authBox = document.getElementById('authBox');
const panel = document.getElementById('panel');
const authForm = document.getElementById('authForm');
const authNote = document.getElementById('authNote');

function authHeaders() {
  return { Authorization: 'Bearer ' + token };
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showPanel(user) {
  authBox.hidden = true;
  panel.hidden = false;
  document.getElementById('logoutLink').hidden = false;
  document.getElementById('adminWho').textContent = user.name + ' (' + user.email + ')';
  loadAll();
}
function showAuth() {
  authBox.hidden = false;
  panel.hidden = true;
  document.getElementById('logoutLink').hidden = true;
  token = null;
  localStorage.removeItem('mannyo_admin_token');
}

async function init() {
  // One-time first-run setup?
  try {
    const r = await fetch('/api/auth/setup-needed');
    const d = await r.json();
    if (d.setupNeeded) {
      setupMode = true;
      document.getElementById('authTitle').textContent = 'First-Time Setup — Create the Admin Account';
      document.getElementById('authDesc').textContent = 'No admin exists yet. Create the first admin account — this can only be done once.';
      document.getElementById('nameRow').hidden = false;
      document.getElementById('authBtn').textContent = 'Create Admin Account';
    }
  } catch { /* API down — leave the login form as-is */ }
  // Already logged in?
  if (token && !setupMode) {
    try {
      const r = await fetch('/api/auth/me', { headers: authHeaders() });
      if (r.ok) { showPanel((await r.json()).user); return; }
    } catch { /* fall through to login */ }
    showAuth();
  }
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authNote.className = 'form-note';
  authNote.textContent = setupMode ? 'Creating admin account…' : 'Logging in…';
  const payload = {
    email: document.getElementById('authEmail').value.trim(),
    password: document.getElementById('authPassword').value,
  };
  if (setupMode) payload.name = document.getElementById('authName').value.trim();
  try {
    const res = await api(setupMode ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST', body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    token = data.token;
    localStorage.setItem('mannyo_admin_token', token);
    authNote.textContent = '';
    showPanel(data.user);
  } catch (err) {
    authNote.className = 'form-note err';
    authNote.textContent = err.message;
  }
});

function logout() { showAuth(); }
document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

// Tabs
document.querySelectorAll('.admin-tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-tabs button').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== btn.dataset.tab; });
    if (btn.dataset.tab === 'messages') loadMessages();
    if (btn.dataset.tab === 'posts') loadPosts();
    if (btn.dataset.tab === 'services') loadServices();
  });
});

// ---------- homepage settings ----------
async function loadSettings() {
  const r = await fetch('/api/admin/settings', { headers: authHeaders() });
  if (!r.ok) return;
  const { settings } = await r.json();
  document.querySelectorAll('#settingsForm [data-key]').forEach(el => {
    el.value = settings[el.dataset.key] || '';
  });
}
document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const note = document.getElementById('settingsNote');
  const settings = {};
  document.querySelectorAll('#settingsForm [data-key]').forEach(el => { settings[el.dataset.key] = el.value; });
  try {
    const r = await api('/api/admin/settings', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ settings }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Save failed');
    note.className = 'form-note ok';
    note.textContent = 'Saved — the public website now shows the new text.';
  } catch (err) {
    note.className = 'form-note err';
    note.textContent = err.message;
  }
});

// ---------- services ----------
async function loadServices() {
  const r = await fetch('/api/content');
  if (!r.ok) return;
  const { services } = await r.json();
  document.getElementById('servicesList').innerHTML = services.map(s => `
    <div class="msg-item">
      <strong>${escapeHtml(s.icon)} ${escapeHtml(s.title)}</strong>
      <label>Title</label>
      <input data-svc-title="${s.id}" value="${escapeHtml(s.title)}">
      <label>Description</label>
      <textarea data-svc-desc="${s.id}">${escapeHtml(s.description)}</textarea>
      <button class="small-btn solid" type="button" data-svc-save="${s.id}">Save Service</button>
    </div>`).join('');
  document.querySelectorAll('[data-svc-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.svcSave;
      const title = document.querySelector(`[data-svc-title="${id}"]`).value;
      const description = document.querySelector(`[data-svc-desc="${id}"]`).value;
      const note = document.getElementById('servicesNote');
      try {
        const r = await api('/api/admin/services/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ title, description }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Save failed');
        note.className = 'form-note ok';
        note.textContent = 'Service saved.';
        loadServices();
      } catch (err) {
        note.className = 'form-note err';
        note.textContent = err.message;
      }
    });
  });
}

// ---------- posts ----------
async function loadPosts() {
  const r = await fetch('/api/admin/posts', { headers: authHeaders() });
  if (!r.ok) return;
  const { posts } = await r.json();
  document.getElementById('postsList').innerHTML = posts.length ? posts.map(p => `
    <div class="msg-item">
      <div class="meta">${escapeHtml(new Date(p.created_at).toLocaleString())}</div>
      <strong>${escapeHtml(p.title)}</strong>
      <p>${escapeHtml(p.body)}</p>
      <button class="small-btn" type="button" data-post-edit="${p.id}">Edit</button>
      <button class="small-btn danger" type="button" data-post-del="${p.id}">Delete</button>
    </div>`).join('') : '<p style="color:var(--muted)">No posts yet.</p>';
  document.querySelectorAll('[data-post-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this post?')) return;
      await api('/api/admin/posts/' + btn.dataset.postDel, { method: 'DELETE', headers: authHeaders() });
      loadPosts();
    });
  });
  document.querySelectorAll('[data-post-edit]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.postEdit;
      const title = prompt('New title (leave blank to keep):');
      const body = prompt('New body (leave blank to keep):');
      const payload = {};
      if (title) payload.title = title;
      if (body) payload.body = body;
      if (!Object.keys(payload).length) return;
      await api('/api/admin/posts/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
      loadPosts();
    });
  });
}
document.getElementById('postForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const note = document.getElementById('postNote');
  const title = document.getElementById('postTitle').value.trim();
  const body = document.getElementById('postBody').value.trim();
  try {
    const r = await api('/api/admin/posts', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ title, body }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not publish');
    note.className = 'form-note ok';
    note.textContent = 'Post published — it is now on the public website.';
    e.target.reset();
    loadPosts();
  } catch (err) {
    note.className = 'form-note err';
    note.textContent = err.message;
  }
});

// ---------- messages ----------
async function loadMessages() {
  const r = await fetch('/api/admin/messages', { headers: authHeaders() });
  if (!r.ok) return;
  const { messages } = await r.json();
  const unread = messages.filter(m => !m.read).length;
  document.getElementById('msgCount').textContent = unread ? `(${unread} new)` : '';
  document.getElementById('messagesList').innerHTML = messages.length ? messages.map(m => `
    <div class="msg-item ${m.read ? '' : 'unread'}">
      <div class="meta">${m.type === 'driver' ? '🚗 Driver application' : '🏢 Business enquiry'} · ${escapeHtml(new Date(m.created_at).toLocaleString())}</div>
      <strong>${escapeHtml(m.name)}</strong> — <a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a>${m.phone ? ' · ' + escapeHtml(m.phone) : ''}
      <p>${escapeHtml(m.message)}</p>
      <button class="small-btn" type="button" data-msg-read="${m.id}">${m.read ? 'Mark Unread' : 'Mark Read'}</button>
      <button class="small-btn danger" type="button" data-msg-del="${m.id}">Delete</button>
    </div>`).join('') : '<p style="color:var(--muted)">No messages yet.</p>';
  document.querySelectorAll('[data-msg-read]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = btn.closest('.msg-item');
      const read = !item.classList.contains('unread');
      await api('/api/admin/messages/' + btn.dataset.msgRead, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ read: !read }) });
      loadMessages();
    });
  });
  document.querySelectorAll('[data-msg-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this message?')) return;
      await api('/api/admin/messages/' + btn.dataset.msgDel, { method: 'DELETE', headers: authHeaders() });
      loadMessages();
    });
  });
}

function loadAll() {
  loadSettings();
  loadServices();
  loadPosts();
  loadMessages();
}

// Mobile menu (same as public site)
const menuBtn = document.getElementById('menuBtn');
const nav = document.getElementById('mainNav');
menuBtn.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
});

init();
