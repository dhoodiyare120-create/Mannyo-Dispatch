require('dotenv').config();
const express = require('express');
const fs = require('fs');
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
  role TEXT NOT NULL CHECK(role IN ('owner','driver')),
  driver_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  licence INTEGER DEFAULT 0,
  insurance INTEGER DEFAULT 0,
  registration INTEGER DEFAULT 0,
  background_check INTEGER DEFAULT 0,
  w9 INTEGER DEFAULT 0,
  signed_agreement INTEGER DEFAULT 0,
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client TEXT NOT NULL,
  pickup TEXT NOT NULL,
  area TEXT,
  date TEXT,
  pay_basis TEXT NOT NULL CHECK(pay_basis IN ('per_stop','per_mile','flat')),
  client_rate REAL NOT NULL DEFAULT 0,
  driver_rate REAL NOT NULL DEFAULT 0,
  other_cost REAL NOT NULL DEFAULT 0,
  miles REAL NOT NULL DEFAULT 0,
  driver_id INTEGER,
  status TEXT NOT NULL DEFAULT 'needs-driver' CHECK(status IN ('needs-driver','out','completed')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  seq INTEGER DEFAULT 0,
  address TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','picked_up','failed')),
  FOREIGN KEY(route_id) REFERENCES routes(id) ON DELETE CASCADE
);
`);

const app = express();
app.use(express.json());

// The dispatch pages normally live in public/. If they were uploaded flat at
// the project root instead (no public/ folder), move them into public/ on
// startup so the app still works. If that move is not possible, serve the
// root as a fallback but never serve server code, the database or secrets.
const PUBLIC_DIR = path.join(__dirname, 'public');
const FRONTEND_FILES = ['index.html', 'styles.css', 'app.js', 'logo.png', 'logo-white.png'];
let hasPublic = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'));
if (!hasPublic && fs.existsSync(path.join(__dirname, 'index.html'))) {
  try {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    for (const f of FRONTEND_FILES) {
      const src = path.join(__dirname, f);
      if (fs.existsSync(src)) fs.renameSync(src, path.join(PUBLIC_DIR, f));
    }
    hasPublic = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'));
    if (hasPublic) console.log('Moved flat dispatch files into public/ — app will serve from there.');
  } catch (e) {
    console.warn('Could not move dispatch files into public/:', e.message);
  }
}
if (hasPublic) app.use(express.static(PUBLIC_DIR));
else {
  app.use((req, res, next) => {
    if (/^\/(server\.js|package\.json|package-lock\.json|Dockerfile|\.gitignore|\.env.*|README\.md|mannyo\.db.*)/.test(req.path))
      return res.status(404).send('Not found');
    next();
  });
  app.use(express.static(__dirname));
}

// ---------- helpers ----------
function payBreakdown(route, stopCount) {
  const c = Number(route.client_rate) || 0;
  const d = Number(route.driver_rate) || 0;
  const o = Number(route.other_cost) || 0;
  const miles = Number(route.miles) || 0;
  let clientPays = 0, driverGets = 0, other = 0;
  if (route.pay_basis === 'per_stop') {
    clientPays = c * stopCount; driverGets = d * stopCount; other = o * stopCount;
  } else if (route.pay_basis === 'per_mile') {
    clientPays = c * miles; driverGets = d * miles; other = o * miles;
  } else { // flat: rates are totals for the whole route
    clientPays = c; driverGets = d; other = o;
  }
  const round = (n) => Math.round(n * 100) / 100;
  return { clientPays: round(clientPays), driverGets: round(driverGets), otherCost: round(other), mannyoKeeps: round(clientPays - driverGets - other), stopCount, miles };
}
function driverRow(r) {
  const ready = [r.licence, r.insurance, r.registration, r.background_check, r.w9, r.signed_agreement].every(v => Number(v) === 1);
  return { ...r, ready };
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired login — please log in again' }); }
}
function ownerOnly(req, res, next) {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
  next();
}
function routeWithStops(route) {
  const stops = db.prepare('SELECT * FROM stops WHERE route_id = ? ORDER BY seq, id').all(route.id);
  return { ...route, stops, pay: payBreakdown(route, stops.length) };
}

// ---------- auth ----------
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'mannyo-dispatch', version: '1.0.0' }));
app.get('/api/auth/setup-needed', (req, res) => {
  const n = db.prepare("SELECT COUNT(*) c FROM users WHERE role='owner'").get().c;
  res.json({ setupNeeded: n === 0 });
});
app.post('/api/auth/setup', (req, res) => {
  const n = db.prepare("SELECT COUNT(*) c FROM users WHERE role='owner'").get().c;
  if (n > 0) return res.status(400).json({ error: 'Owner account already exists — log in instead' });
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || String(password).length < 8)
    return res.status(400).json({ error: 'Name, email and a password of at least 8 characters are required' });
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
    .run(name, String(email).toLowerCase(), hash, 'owner');
  const user = { id: info.lastInsertRowid, name, email: String(email).toLowerCase(), role: 'owner' };
  res.status(201).json({ user, token: jwt.sign(user, SECRET, { expiresIn: '7d' }) });
});
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash))
    return res.status(401).json({ error: 'Wrong email or password' });
  const payload = { id: user.id, name: user.name, email: user.email, role: user.role, driver_id: user.driver_id };
  res.json({ user: payload, token: jwt.sign(payload, SECRET, { expiresIn: '7d' }) });
});
app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

// ---------- drivers (owner only for create/update) ----------
app.get('/api/drivers', auth, (req, res) => {
  if (req.user.role === 'driver') return res.json({ drivers: [] });
  res.json({ drivers: db.prepare('SELECT * FROM drivers ORDER BY name').all().map(driverRow) });
});
app.post('/api/drivers', auth, ownerOnly, (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Driver name is required' });
  if (email && password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'Driver password must be at least 8 characters' });
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase());
    if (exists) return res.status(400).json({ error: 'That email already has a login' });
  }
  const info = db.prepare('INSERT INTO drivers (name,email,phone) VALUES (?,?,?)')
    .run(name, email ? String(email).toLowerCase() : null, phone || null);
  let userId = null;
  if (email && password) {
    const hash = bcrypt.hashSync(String(password), 10);
    const u = db.prepare('INSERT INTO users (name,email,password_hash,role,driver_id) VALUES (?,?,?,?,?)')
      .run(name, String(email).toLowerCase(), hash, 'driver', info.lastInsertRowid);
    userId = u.lastInsertRowid;
    db.prepare('UPDATE drivers SET user_id = ? WHERE id = ?').run(userId, info.lastInsertRowid);
  }
  res.status(201).json({ driver: driverRow(db.prepare('SELECT * FROM drivers WHERE id = ?').get(info.lastInsertRowid)) });
});
app.patch('/api/drivers/:id', auth, ownerOnly, (req, res) => {
  const fields = ['name','email','phone','licence','insurance','registration','background_check','w9','signed_agreement'];
  const sets = [], vals = [];
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(f === 'email' && req.body[f] ? String(req.body[f]).toLowerCase() : req.body[f]); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE drivers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const row = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Driver not found' });
  res.json({ driver: driverRow(row) });
});

// ---------- routes ----------
app.get('/api/routes', auth, (req, res) => {
  let rows;
  if (req.user.role === 'driver') {
    rows = db.prepare('SELECT * FROM routes WHERE driver_id = ? ORDER BY date DESC, id DESC').all(req.user.driver_id);
  } else {
    rows = db.prepare('SELECT * FROM routes ORDER BY date DESC, id DESC').all();
  }
  res.json({ routes: rows.map(routeWithStops) });
});
app.post('/api/routes', auth, ownerOnly, (req, res) => {
  const { client, pickup, area, date, pay_basis, client_rate, driver_rate, other_cost, miles, driver_id } = req.body || {};
  if (!client || !pickup) return res.status(400).json({ error: 'Client and pickup are required' });
  if (!['per_stop','per_mile','flat'].includes(pay_basis)) return res.status(400).json({ error: 'pay_basis must be per_stop, per_mile or flat' });
  const info = db.prepare(`INSERT INTO routes (client,pickup,area,date,pay_basis,client_rate,driver_rate,other_cost,miles,driver_id,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(client, pickup, area || '', date || new Date().toISOString().slice(0,10),
    pay_basis, Number(client_rate)||0, Number(driver_rate)||0, Number(other_cost)||0, Number(miles)||0,
    driver_id || null, driver_id ? 'out' : 'needs-driver');
  res.status(201).json({ route: routeWithStops(db.prepare('SELECT * FROM routes WHERE id = ?').get(info.lastInsertRowid)) });
});
app.get('/api/routes/:id', auth, (req, res) => {
  const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  if (req.user.role === 'driver' && route.driver_id !== req.user.driver_id) return res.status(403).json({ error: 'Not your route' });
  res.json({ route: routeWithStops(route) });
});
app.patch('/api/routes/:id', auth, ownerOnly, (req, res) => {
  const fields = ['client','pickup','area','date','pay_basis','client_rate','driver_rate','other_cost','miles','driver_id','status'];
  const sets = [], vals = [];
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE routes SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  res.json({ route: routeWithStops(route) });
});

// ---------- stops ----------
app.post('/api/routes/:id/stops', auth, ownerOnly, (req, res) => {
  const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  const { address, notes } = req.body || {};
  if (!address) return res.status(400).json({ error: 'Stop address is required' });
  const count = db.prepare('SELECT COUNT(*) c FROM stops WHERE route_id = ?').get(req.params.id).c;
  const info = db.prepare('INSERT INTO stops (route_id,seq,address,notes) VALUES (?,?,?,?)')
    .run(req.params.id, count + 1, address, notes || '');
  res.status(201).json({ stop: db.prepare('SELECT * FROM stops WHERE id = ?').get(info.lastInsertRowid) });
});
app.patch('/api/stops/:id', auth, (req, res) => {
  const stop = db.prepare('SELECT * FROM stops WHERE id = ?').get(req.params.id);
  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  if (req.user.role === 'driver') {
    const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(stop.route_id);
    if (!route || route.driver_id !== req.user.driver_id) return res.status(403).json({ error: 'Not your route' });
  }
  const { status, address, notes } = req.body || {};
  if (status && !['pending','delivered','picked_up','failed'].includes(status)) return res.status(400).json({ error: 'Invalid stop status' });
  const sets = [], vals = [];
  if (status) { sets.push('status = ?'); vals.push(status); }
  if (address !== undefined) { sets.push('address = ?'); vals.push(address); }
  if (notes !== undefined) { sets.push('notes = ?'); vals.push(notes); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE stops SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ stop: db.prepare('SELECT * FROM stops WHERE id = ?').get(req.params.id) });
});

// ---------- pay ----------
app.get('/api/pay', auth, (req, res) => {
  const routes = db.prepare('SELECT * FROM routes').all();
  const drivers = db.prepare('SELECT * FROM drivers').all();
  const byDriver = {};
  let totalClient = 0, totalDriver = 0, totalOther = 0;
  for (const r of routes) {
    const stopCount = db.prepare('SELECT COUNT(*) c FROM stops WHERE route_id = ?').get(r.id).c;
    const p = payBreakdown(r, stopCount);
    totalClient += p.clientPays; totalDriver += p.driverGets; totalOther += p.otherCost;
    if (r.driver_id) {
      byDriver[r.driver_id] = byDriver[r.driver_id] || { driverId: r.driver_id, routes: 0, stops: 0, clientPays: 0, driverGets: 0, otherCost: 0, mannyoKeeps: 0 };
      const b = byDriver[r.driver_id];
      b.routes++; b.stops += stopCount; b.clientPays += p.clientPays; b.driverGets += p.driverGets; b.otherCost += p.otherCost; b.mannyoKeeps += p.mannyoKeeps;
    }
  }
  const round = (n) => Math.round(n * 100) / 100;
  let perDriver = Object.values(byDriver).map(b => ({
    ...b, driverName: (drivers.find(d => d.id === b.driverId) || {}).name || 'Unassigned',
    clientPays: round(b.clientPays), driverGets: round(b.driverGets), otherCost: round(b.otherCost), mannyoKeeps: round(b.mannyoKeeps)
  }));
  if (req.user.role === 'driver') perDriver = perDriver.filter(b => b.driverId === req.user.driver_id);
  res.json({ perDriver, totals: { clientPays: round(totalClient), driverGets: round(totalDriver), otherCost: round(totalOther), mannyoKeeps: round(totalClient - totalDriver - totalOther) } });
});
app.post('/api/pricing/calculate', auth, (req, res) => {
  const { pay_basis, client_rate, driver_rate, other_cost, stops, miles } = req.body || {};
  const p = payBreakdown({ pay_basis: pay_basis || 'per_stop', client_rate, driver_rate, other_cost, miles }, Number(stops) || 0);
  res.json({ pay: p });
});

// SPA fallback (after API routes)
function pageFile(name) {
  const inPublic = path.join(PUBLIC_DIR, name);
  return fs.existsSync(inPublic) ? inPublic : path.join(__dirname, name);
}
app.get('*', (req, res) => res.sendFile(pageFile('index.html')));

app.listen(PORT, () => console.log(`MANNYO Dispatch running on port ${PORT} — open http://localhost:${PORT}`));
