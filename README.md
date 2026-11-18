# MANNYO Website — Standalone Public Version

Public website for **MANNYO Logistics and Hospitality, LLC** (Twin Cities, Minnesota) with an **admin login** so the owner can change homepage content, post announcements, and read contact-form messages — no code changes needed.

This is a plain Node.js app you deploy yourself. It does **not** live on Muse.

## What is inside

- **Public website** (`/`): royal blue header with the white MANNYO logo and slogan *"FROM OUR WINGS TO YOUR DOOR."*, white cards, six delivery services (last-mile, scheduled routes, pharmacy/medical, auto parts, retail/e-commerce, hospitality), how it works in 3 steps, Twin Cities areas covered, a route estimator, a Drive with MANNYO section for 1099 drivers, news/announcements, and contact forms for businesses and drivers. Fully responsive (phone, tablet, desktop).
- **Admin panel** (`/admin`): first-run setup creates the first admin account (email + password, one-time only). After logging in, the admin can:
  - Edit homepage content (hero headline, hero subheading, about text, services intro, how-it-works intro, drivers text, areas text, contact email).
  - Edit the six services (title and description).
  - Create, edit and delete posts/announcements — they appear on the public site immediately.
  - Read, mark and delete messages from the business and driver contact forms.
- **Content lives in the database** (SQLite), so admin edits show up on the public site right away. The site is seeded with the current MANNYO website content.
- Only a logged-in admin can change anything. Unauthenticated edit attempts are rejected by the server (401/403).

## Tech

Node.js ≥ 22, Express, SQLite via Node's built-in `node:sqlite` (no native build step), JWT auth, bcryptjs password hashing. No hardcoded passwords, no secrets committed.

## Run locally

```bash
npm install
cp .env.example .env
# Edit .env and put a LONG random string in JWT_SECRET.
# Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm start
```

Then open http://localhost:3000

- First visit: go to http://localhost:3000/admin and create the admin account (name, email, password of at least 8 characters). This setup page only works once — after an admin exists it shows the login form instead.
- Log in at `/admin` to edit the site.

## Deploy publicly — Render (recommended)

1. Push this folder to a GitHub repository (do **not** commit `.env` or `*.db` — they are in `.gitignore`).
2. In Render: **New → Web Service → connect the repo**.
3. Build command: `npm install`
4. Start command: `npm start`
5. Environment variables:
   - `JWT_SECRET` = a long random string (generate one as above)
   - `NODE_ENV` = `production`
6. Deploy. Your public website address is the URL Render gives you (e.g. `https://mannyo-website.onrender.com`). Open `/admin` on that URL to create the admin account and start editing.

> **Important — free-tier disk warning:** Render's free tier (and Railway's default setup) uses an **ephemeral disk**, so the SQLite file (`mannyo.db`) — with your admin account, posts, settings and contact messages — can be lost when the service restarts or redeploys. For business-critical use, attach a **persistent disk** (Render) or a **persistent volume** (Railway) mounted where the app can store the database, and set `DATABASE_URL` to a path on that disk. Otherwise, keep a copy of important contact messages elsewhere.

## Deploy publicly — Railway

1. Push to GitHub, then **New Project → Deploy from GitHub repo**.
2. Set the same variables (`JWT_SECRET`, `NODE_ENV=production`).
3. Add a persistent **volume** for the database (see the warning above) and set `DATABASE_URL` to a path on it, e.g. `/data/mannyo.db`.

## Deploy publicly — Docker

```bash
docker build -t mannyo-website .
docker run -p 3000:3000 -e JWT_SECRET='<redacted>' -e NODE_ENV=production mannyo-website
```

For a persistent database with Docker, mount a volume and set `DATABASE_URL`, e.g.:

```bash
docker run -p 3000:3000 -e JWT_SECRET='<redacted>' -e NODE_ENV=production \
  -e DATABASE_URL=/data/mannyo.db -v mannyo-data:/data mannyo-website
```

## API (for reference)

| Route | Who | What |
|---|---|---|
| `GET /api/health` | anyone | Health check |
| `GET /api/content` | anyone | Homepage settings, services, posts |
| `POST /api/contact` | anyone | Submit a business/driver contact message |
| `GET /api/auth/setup-needed` | anyone | Is first-run admin setup still open? |
| `POST /api/auth/setup` | anyone, once | Create the first admin account |
| `POST /api/auth/login` | anyone | Log in, returns a JWT (7 days) |
| `GET /api/auth/me` | logged in | Current admin |
| `GET/PUT /api/admin/settings` | admin | Homepage content |
| `PUT /api/admin/services/:id` | admin | Edit a service |
| `GET/POST /api/admin/posts` | admin | List / create posts |
| `PUT/DELETE /api/admin/posts/:id` | admin | Edit / delete a post |
| `GET /api/admin/messages` | admin | Contact-form messages |
| `PATCH/DELETE /api/admin/messages/:id` | admin | Mark read / delete a message |

## Files

- `server.js` — Express server, SQLite database, auth and admin API
- `public/index.html`, `public/app.js` — public website
- `public/admin.html`, `public/admin.js` — admin login and panel
- `public/styles.css` — site + admin styles (responsive)
- `public/logo.png` — navy MANNYO logo with slogan (white backgrounds)
- `public/logo-white.png` — white MANNYO logo with slogan (blue header)
- `public/favicon.svg` — browser tab icon

## Notes

- The route estimator uses **example rates only** (per stop $12.00, per mile $2.50) and says so on the page. Replace them with real contract rates before quoting.
- The public site never shows contact-form messages or admin details — messages are only visible after logging in at `/admin`.
