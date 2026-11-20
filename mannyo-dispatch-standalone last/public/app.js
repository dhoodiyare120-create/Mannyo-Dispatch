const $ = (s) => document.querySelector(s);
let token = localStorage.getItem('mannyo_token') || '';
let me = null;
let drivers = [];
let routes = [];

async function api(path, method = 'GET', body) {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('Request failed: ' + r.status));
  return data;
}
const money = (n) => '$' + Number(n || 0).toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function init() {
  if (token) {
    try { me = (await api('/api/auth/me')).user; showApp(); return; } catch { token = ''; localStorage.removeItem('mannyo_token'); }
  }
  try {
    const { setupNeeded } = await api('/api/auth/setup-needed');
    if (setupNeeded) {
      $('#authTitle').textContent = 'Set up the owner account';
      $('#setupNote').classList.remove('hidden');
      $('#nameLabel').classList.remove('hidden');
      $('#authBtn').textContent = 'Create owner account';
      $('#authPassword').autocomplete = 'new-password';
    }
  } catch (e) { $('#authError').textContent = 'Could not reach the server. Is it running?'; }
}
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#authError').textContent = '';
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;
  try {
    let data;
    if ($('#authBtn').textContent.includes('owner')) {
      data = await api('/api/auth/setup', 'POST', { name: $('#authName').value.trim(), email, password });
    } else {
      data = await api('/api/auth/login', 'POST', { email, password });
    }
    token = data.token; me = data.user; localStorage.setItem('mannyo_token', token);
    showApp();
  } catch (err) { $('#authError').textContent = err.message; }
});
$('#logoutBtn').addEventListener('click', () => { token = ''; me = null; localStorage.removeItem('mannyo_token'); location.reload(); });

function showApp() {
  $('#authCard').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#userBar').classList.remove('hidden');
  $('#userLabel').textContent = me.name + ' — ' + me.role;
  if (me.role === 'driver') {
    document.querySelectorAll('.owner-only').forEach((el) => el.classList.add('hidden'));
    $('#driversTabBtn').classList.add('hidden');
    const dn = $('#driversNavBtn'); if (dn) dn.classList.add('hidden');
  }
  loadAll();
}
function switchTab(tab) {
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  document.querySelectorAll('#sideNav button[data-tab]').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((t) => t.classList.add('hidden'));
  $('#tab-' + tab).classList.remove('hidden');
  const names = { board: 'Board', routes: 'Routes', drivers: 'Drivers', pay: 'Pay' };
  const tn = $('#topTabName'); if (tn) tn.textContent = names[tab] || tab;
  document.body.classList.remove('nav-open');
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
document.querySelectorAll('#sideNav button[data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
document.querySelectorAll('#sideNav button[data-action]').forEach((b) => b.addEventListener('click', () => {
  switchTab('routes');
  const detail = $('#routeDetail');
  if (detail && routes.length === 1) openRoute(routes[0].id);
}));
const menuBtn = $('#menuBtn');
if (menuBtn) menuBtn.addEventListener('click', () => document.body.classList.toggle('nav-open'));

async function loadAll() {
  try {
    drivers = (await api('/api/drivers')).drivers;
    routes = (await api('/api/routes')).routes;
    renderBoard(); renderRoutes(); renderDrivers(); renderPay();
    const sel = $('#rDriver');
    sel.innerHTML = '<option value="">— needs driver —</option>' + drivers.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  } catch (err) { alert(err.message); }
}

function renderBoard() {
  const today = new Date().toISOString().slice(0, 10);
  const todays = routes.filter((r) => (r.date || '').slice(0, 10) === today);
  const count = (s) => todays.filter((r) => r.status === s).length;
  $('#boardCounts').innerHTML = `
    <div><b>${count('needs-driver')}</b>needs driver</div>
    <div><b>${count('out')}</b>out</div>
    <div><b>${count('completed')}</b>completed</div>
    <div><b>${todays.length}</b>routes today</div>`;
  $('#boardList').innerHTML = todays.length ? todays.map(routeCard).join('') : '<p>No routes for today yet. Create one in the Routes tab.</p>';
}
function routeCard(r) {
  const done = r.stops.filter((s) => s.status === 'delivered' || s.status === 'picked_up').length;
  const driver = drivers.find((d) => d.id === r.driver_id);
  const isDone = r.status === 'completed';
  return `<div class="route-row">
    <div class="route-ico ${isDone ? 'done' : 'warn'}">${isDone ? '✓' : '📦'}</div>
    <div class="route-body">
      <div class="route-title">${esc(r.client)} — ${esc(r.pickup)}</div>
      <div class="route-sub">${esc(r.area || '')} · ${esc(r.date || '')} · Driver: ${driver ? esc(driver.name) : '—'} · Stops: ${done}/${r.stops.length} done</div>
      ${r.status === 'needs-driver' ? '<div class="tag-red">● NEEDS DRIVER</div>' : ''}
      <div class="route-thumb">📦 Package · ${r.stops.length} stop${r.stops.length === 1 ? '' : 's'}</div>
      <div><span class="badge ${r.status === 'needs-driver' ? 'warn' : isDone ? 'done' : ''}">${esc(r.status)}</span></div>
      <div class="pay-line">Client pays ${money(r.pay.clientPays)} → Driver gets ${money(r.pay.driverGets)} → MANNYO keeps ${money(r.pay.mannyoKeeps)}</div>
      <button onclick="openRoute(${r.id})">Open route</button>
    </div></div>`;
}
function renderRoutes() {
  $('#routeList').innerHTML = routes.length ? routes.map(routeCard).join('') : '<p>No routes yet — the app starts empty.</p>';
}
window.openRoute = async (id) => {
  const r = routes.find((x) => x.id === id);
  if (!r) return;
  const d = $('#routeDetail');
  d.classList.remove('hidden');
  d.innerHTML = `<h3>${esc(r.client)} — ${esc(r.pickup)}</h3>
    <p>${esc(r.area || '')} · ${esc(r.date || '')} · ${esc(r.pay_basis)} · ${esc(r.status)}</p>
    <p>Client pays <b>${money(r.pay.clientPays)}</b> → Driver gets <b>${money(r.pay.driverGets)}</b> → MANNYO keeps <b>${money(r.pay.mannyoKeeps)}</b></p>
    ${r.stops.map((s) => `<div class="stop"><div class="stop-ico ${esc(s.status)}">${s.status === 'delivered' ? '✓' : s.status === 'picked_up' ? '📦' : s.status === 'failed' ? '✕' : '○'}</div>
      <div class="stop-body"><b>#${s.seq} ${esc(s.address)}</b> — <span class="badge ${s.status === 'delivered' || s.status === 'picked_up' ? 'done' : ''}">${esc(s.status)}</span> ${esc(s.notes || '')}
      <br><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}" target="_blank" rel="noopener">Navigate ↗</a>
      <div class="actions">
        <button onclick="setStop(${s.id},'delivered')">✓ Delivered</button>
        <button class="ghost" onclick="setStop(${s.id},'picked_up')">Picked up</button>
        <button class="danger" onclick="setStop(${s.id},'failed')">Failed</button>
      </div></div></div>`).join('') || '<p>No stops yet.</p>'}
    ${me.role === 'owner' ? `<form id="stopForm"><label>New stop address <input id="stopAddr" required></label><button type="submit">Add stop</button></form>
    <label>Route status <select id="routeStatus"><option value="needs-driver">needs-driver</option><option value="out">out</option><option value="completed">completed</option></select></label>
    <button onclick="setRouteStatus(${r.id})">Save status</button>` : ''}`;
  const rs = $('#routeStatus'); if (rs) rs.value = r.status;
  const sf = $('#stopForm');
  if (sf) sf.addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/routes/' + id + '/stops', 'POST', { address: $('#stopAddr').value.trim() });
    await loadAll(); openRoute(id);
  });
};
window.setStop = async (id, status) => {
  await api('/api/stops/' + id, 'PATCH', { status });
  await loadAll();
  const r = routes.find((x) => x.stops.some((s) => s.id === id));
  if (r) openRoute(r.id);
};
window.setRouteStatus = async (id) => { await api('/api/routes/' + id, 'PATCH', { status: $('#routeStatus').value }); await loadAll(); openRoute(id); };

$('#routeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    client: $('#rClient').value.trim(), pickup: $('#rPickup').value.trim(), area: $('#rArea').value.trim(),
    date: $('#rDate').value || new Date().toISOString().slice(0, 10), pay_basis: $('#rBasis').value,
    client_rate: parseFloat($('#rClientRate').value) || 0, driver_rate: parseFloat($('#rDriverRate').value) || 0,
    other_cost: parseFloat($('#rOther').value) || 0, miles: parseFloat($('#rMiles').value) || 0,
    driver_id: $('#rDriver').value ? parseInt($('#rDriver').value) : null,
  };
  await api('/api/routes', 'POST', body);
  e.target.reset(); $('#rClientRate').value = 12; $('#rDriverRate').value = 7; $('#rOther').value = 0.50;
  loadAll();
});

function renderDrivers() {
  const checks = [['licence', 'Licence'], ['insurance', 'Insurance'], ['registration', 'Registration'], ['background_check', 'Background'], ['w9', 'W-9'], ['signed_agreement', 'Agreement']];
  $('#driverList').innerHTML = drivers.length ? drivers.map((d) => `<div class="card"><b>${esc(d.name)}</b> ${esc(d.email || '')} ${esc(d.phone || '')}
    <div class="checks">${checks.map(([k, label]) => `<span>${d[k] ? '✅' : '⬜'} ${label} <input type="checkbox" data-driver="${d.id}" data-check="${k}" ${d[k] ? 'checked' : ''}></span>`).join('')}</div>
    <p><b>${d.ready ? 'YES — ready to dispatch' : 'Not ready yet'}</b> — ready only when all six checks are done.</p></div>`).join('')
    : '<p>No drivers yet — the app starts empty.</p>';
  document.querySelectorAll('#driverList input[type=checkbox]').forEach((cb) => cb.addEventListener('change', async () => {
    await api('/api/drivers/' + cb.dataset.driver, 'PATCH', { [cb.dataset.check]: cb.checked ? 1 : 0 });
    loadAll();
  }));
}
$('#driverForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/drivers', 'POST', { name: $('#dName').value.trim(), email: $('#dEmail').value.trim(), phone: $('#dPhone').value.trim(), password: $('#dPassword').value });
  e.target.reset(); loadAll();
});

async function renderPay() {
  const { perDriver, totals } = await api('/api/pay');
  $('#paySummary').innerHTML = `<div class="card"><b>Totals:</b> Client pays ${money(totals.clientPays)} · Drivers get ${money(totals.driverGets)} · Other ${money(totals.otherCost)} · <b>MANNYO keeps ${money(totals.mannyoKeeps)}</b></div>`
    + (perDriver.length ? perDriver.map((p) => `<div class="card"><b>${esc(p.driverName)}</b> — ${p.routes} routes, ${p.stops} stops · Driver gets <b>${money(p.driverGets)}</b> · MANNYO keeps ${money(p.mannyoKeeps)}</b></div>`).join('') : '<p>No pay yet — no routes assigned.</p>');
}
$('#calcBtn').addEventListener('click', async () => {
  const { pay } = await api('/api/pricing/calculate', 'POST', {
    pay_basis: $('#cBasis').value, client_rate: parseFloat($('#cClient').value) || 0,
    driver_rate: parseFloat($('#cDriver').value) || 0, other_cost: parseFloat($('#cOther').value) || 0,
    stops: parseInt($('#cStops').value) || 0, miles: parseFloat($('#cMiles').value) || 0,
  });
  $('#calcResult').textContent = `Client pays ${money(pay.clientPays)} → Driver gets ${money(pay.driverGets)} → Other ${money(pay.otherCost)} → MANNYO keeps ${money(pay.mannyoKeeps)}`;
});

init();
