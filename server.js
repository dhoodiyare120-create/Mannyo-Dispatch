require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { DatabaseSync } = require('node:sqlite'); // Node 22+ built-in SQLite, no native build step

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, 'mannyo.db');
const JWT_SECRET = process.env.JWT_SECRET || null;
if (!JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set. Using a random secret for this run only — logins will not survive a restart. Set JWT_SECRET in .env / on your host.');
}
const SECRET = JWT_SECRET || crypto.randomBytes(32).toString('hex');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '📦',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  type TEXT NOT NULL CHECK(type IN ('business','driver')),
  message TEXT NOT NULL DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ---------- seed homepage content (only if empty) ----------
const DEFAULT_SETTINGS = {
  hero_headline: 'Your Deliveries, Delivered On Time.',
  hero_sub: 'Fast, reliable last-mile delivery across the Twin Cities, Minnesota — from our wings to your door.',
  about_text: 'MANNYO Logistics and Hospitality, LLC is a Twin Cities delivery and transportation company. We do not own a fleet — we work with vetted local 1099 independent drivers who use their own cars, so we can scale to your volume and deliver with care on every stop.',
  services_intro: 'One trusted local partner for all your deliveries. Reliable drivers, flexible scheduling, and careful handling on every stop.',
  how_it_works_intro: 'Getting a delivery moving with MANNYO takes three simple steps.',
  drivers_text: 'Drive with MANNYO and earn on your schedule. As a 1099 independent driver you use your own car, choose your own hours, and get paid per stop or per mile — with weekly pay.',
  areas_text: 'We deliver across the Twin Cities metro — Minneapolis, St. Paul, and the surrounding suburbs.',
  contact_email: 'dhoodiyare120@gmail.com',
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
}

const DEFAULT_SERVICES = [
  ['last-mile', 'Last-Mile Delivery', 'Direct to your customer, on time — the final mile, done right.', '🚚', 1],
  ['scheduled-routes', 'Scheduled Routes', 'Consistent daily or weekly runs your business can count on.', '🗓️', 2],
  ['pharmacy-medical', 'Pharmacy & Medical', 'Sensitive, secure, compliant delivery for pharmacies and clinics.', '💊', 3],
  ['auto-parts', 'Auto Parts', 'Fast parts transport to shops and garages across the metro.', '⚙️', 4],
  ['retail-ecommerce', 'Retail & E-Commerce', 'E-commerce and retail store fulfillment, from shelf to doorstep.', '🛍️', 5],
  ['hospitality', 'Hospitality', 'Restaurants, hotels, and event supplies — delivered when you need them.', '🍽️', 6],
];
for (const [slug, title, description, icon, sort] of DEFAULT_SERVICES) {
  db.prepare('INSERT OR IGNORE INTO services (slug, title, description, icon, sort_order) VALUES (?,?,?,?,?)')
    .run(slug, title, description, icon, sort);
}

if (db.prepare('SELECT COUNT(*) c FROM posts').get().c === 0) {
  db.prepare("INSERT INTO posts (title, body) VALUES (?, ?)")
    .run('Welcome to MANNYO',
      'MANNYO Logistics and Hospitality, LLC is now delivering across the Twin Cities, Minnesota. Last-mile, pharmacy, auto parts, retail and hospitality — from our wings to your door. Contact us to set up deliveries for your business, or apply to drive with us.');
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired login — please log in again' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}
function getSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

// ---------- public API ----------
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'mannyo-website', version: '1.0.0' }));

// Everything the public homepage needs: settings, services, posts.
app.get('/api/content', (req, res) => {
  const services = db.prepare('SELECT id, slug, title, description, icon FROM services ORDER BY sort_order, id').all();
  const posts = db.prepare('SELECT id, title, body, created_at FROM posts ORDER BY created_at DESC, id DESC').all();
  res.json({ settings: getSettings(), services, posts });
});

// Contact forms (public): business enquiries and driver applications.
app.post('/api/contact', (req, res) => {
  const { name, email, phone, type, message } = req.body || {};
  if (!name || !email || !message) return res.status(400).json({ error: 'Name, email and a message are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (!['business', 'driver'].includes(type)) return res.status(400).json({ error: 'type must be business or driver' });
  const info = db.prepare('INSERT INTO messages (name, email, phone, type, message) VALUES (?,?,?,?,?)')
    .run(String(name), String(email).toLowerCase(), phone || '', type, String(message));
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

// ---------- auth (admin) ----------
app.get('/api/auth/setup-needed', (req, res) => {
  const n = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;
  res.json({ setupNeeded: n === 0 });
});

app.post('/api/auth/setup', (req, res) => {
  const n = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;
  if (n > 0) return res.status(400).json({ error: 'Admin account already exists — log in instead' });
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || String(password).length < 8)
    return res.status(400).json({ error: 'Name, email and a password of at least 8 characters are required' });
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
    .run(name, String(email).toLowerCase(), hash, 'admin');
  const user = { id: info.lastInsertRowid, name, email: String(email).toLowerCase(), role: 'admin' };
  res.status(201).json({ user, token: jwt.sign(user, SECRET, { expiresIn: '7d' }) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash))
    return res.status(401).json({ error: 'Wrong email or password' });
  const payload = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.json({ user: payload, token: jwt.sign(payload, SECRET, { expiresIn: '7d' }) });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

// ---------- admin API (all admin-only, enforced server-side) ----------
app.get('/api/admin/settings', auth, adminOnly, (req, res) => res.json({ settings: getSettings() }));
app.put('/api/admin/settings', auth, adminOnly, (req, res) => {
  const settings = req.body.settings || req.body || {};
  const allowed = Object.keys(DEFAULT_SETTINGS);
  let updated = 0;
  for (const [k, v] of Object.entries(settings)) {
    if (!allowed.includes(k)) continue;
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(k, String(v ?? ''));
    updated++;
  }
  res.json({ ok: true, updated, settings: getSettings() });
});

app.put('/api/admin/services/:id', auth, adminOnly, (req, res) => {
  const { title, description, icon } = req.body || {};
  const sets = [], vals = [];
  if (title !== undefined) { sets.push('title = ?'); vals.push(String(title)); }
  if (description !== undefined) { sets.push('description = ?'); vals.push(String(description)); }
  if (icon !== undefined) { sets.push('icon = ?'); vals.push(String(icon)); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Service not found' });
  res.json({ service: row });
});

app.get('/api/admin/posts', auth, adminOnly, (req, res) => {
  res.json({ posts: db.prepare('SELECT * FROM posts ORDER BY created_at DESC, id DESC').all() });
});
app.post('/api/admin/posts', auth, adminOnly, (req, res) => {
  const { title, body } = req.body || {};
  if (!title) return res.status(400).json({ error: 'A title is required' });
  const info = db.prepare('INSERT INTO posts (title, body) VALUES (?,?)').run(String(title), String(body || ''));
  res.status(201).json({ post: db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid) });
});
app.put('/api/admin/posts/:id', auth, adminOnly, (req, res) => {
  const { title, body } = req.body || {};
  const sets = [], vals = [];
  if (title !== undefined) { sets.push('title = ?'); vals.push(String(title)); }
  if (body !== undefined) { sets.push('body = ?'); vals.push(String(body)); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  sets.push("updated_at = datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  res.json({ post: row });
});
app.delete('/api/admin/posts/:id', auth, adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/messages', auth, adminOnly, (req, res) => {
  res.json({ messages: db.prepare('SELECT * FROM messages ORDER BY created_at DESC, id DESC').all() });
});
app.patch('/api/admin/messages/:id', auth, adminOnly, (req, res) => {
  const { read } = req.body || {};
  db.prepare('UPDATE messages SET read = ? WHERE id = ?').run(read ? 1 : 0, req.params.id);
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Message not found' });
  res.json({ message: row });
});
app.delete('/api/admin/messages/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- pages ----------
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`MANNYO Website running on port ${PORT} — open http://localhost:${PORT}`));
