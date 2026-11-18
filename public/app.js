// MANNYO public website — loads content from /api/content, handles the
// estimator, mobile menu, and contact forms. All copy comes from the
// database so admin edits appear immediately.
async function loadContent() {
  try {
    const res = await fetch('/api/content');
    if (!res.ok) return;
    const { settings, services, posts } = await res.json();
    if (settings.hero_headline) document.getElementById('heroHeadline').textContent = settings.hero_headline;
    if (settings.hero_sub) document.getElementById('heroSub').textContent = settings.hero_sub;
    if (settings.services_intro) document.getElementById('servicesIntro').textContent = settings.services_intro;
    if (settings.how_it_works_intro) document.getElementById('howIntro').textContent = settings.how_it_works_intro;
    if (settings.areas_text) document.getElementById('areasText').textContent = settings.areas_text;
    if (settings.drivers_text) document.getElementById('driversText').textContent = settings.drivers_text;
    if (settings.about_text) document.getElementById('aboutText').textContent = settings.about_text;
    if (settings.contact_email) {
      const a = document.getElementById('contactEmail');
      a.textContent = settings.contact_email;
      a.href = 'mailto:' + settings.contact_email;
    }
    const grid = document.getElementById('servicesGrid');
    grid.innerHTML = services.map(s =>
      `<div class="card"><div class="icon">${escapeHtml(s.icon)}</div><h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.description)}</p></div>`
    ).join('');
    const list = document.getElementById('postsList');
    list.innerHTML = posts.length ? posts.map(p =>
      `<article class="card post"><div class="date">${escapeHtml(new Date(p.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))}</div><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.body)}</p></article>`
    ).join('') : '<p style="text-align:center;color:var(--muted)">No announcements yet — check back soon.</p>';
  } catch (e) {
    // Offline / API down: the static fallback copy in the HTML stays visible.
  }
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Mobile menu
const menuBtn = document.getElementById('menuBtn');
const nav = document.getElementById('mainNav');
menuBtn.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
});
nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
  nav.classList.remove('open');
  menuBtn.setAttribute('aria-expanded', 'false');
}));

// Estimator — example rates only, clearly labelled.
document.getElementById('estBtn').addEventListener('click', () => {
  const basis = document.getElementById('estBasis').value;
  const stops = Math.max(0, Number(document.getElementById('estStops').value) || 0);
  const miles = Math.max(0, Number(document.getElementById('estMiles').value) || 0);
  const result = document.getElementById('estResult');
  let text;
  if (basis === 'per_stop') {
    text = `<strong>Estimated route total: $${(stops * 12).toFixed(2)}</strong><br>${stops} stops × $12.00 per stop (example rate).`;
  } else {
    text = `<strong>Estimated route total: $${(miles * 2.5).toFixed(2)}</strong><br>${miles} miles × $2.50 per mile (example rate).`;
  }
  result.innerHTML = text;
  result.hidden = false;
});

// Contact forms — one form, two audiences.
let contactType = 'business';
const tabBusiness = document.getElementById('tabBusiness');
const tabDriver = document.getElementById('tabDriver');
const msgLabel = document.getElementById('cMessageLabel');
function setContactType(t) {
  contactType = t;
  tabBusiness.classList.toggle('active', t === 'business');
  tabDriver.classList.toggle('active', t === 'driver');
  msgLabel.textContent = t === 'business'
    ? 'What do you need delivered?'
    : 'Tell us about yourself and your vehicle';
}
tabBusiness.addEventListener('click', () => setContactType('business'));
tabDriver.addEventListener('click', () => setContactType('driver'));
document.querySelectorAll('[data-contact-type]').forEach(el =>
  el.addEventListener('click', () => setContactType(el.dataset.contactType)));

document.getElementById('contactForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const note = document.getElementById('contactNote');
  note.className = 'form-note';
  note.textContent = 'Sending…';
  const payload = {
    name: document.getElementById('cName').value.trim(),
    email: document.getElementById('cEmail').value.trim(),
    phone: document.getElementById('cPhone').value.trim(),
    type: contactType,
    message: document.getElementById('cMessage').value.trim(),
  };
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not send your message');
    note.className = 'form-note ok';
    note.textContent = 'Thank you — your message was sent. We will get back to you soon.';
    e.target.reset();
  } catch (err) {
    note.className = 'form-note err';
    note.textContent = err.message;
  }
});

loadContent();
