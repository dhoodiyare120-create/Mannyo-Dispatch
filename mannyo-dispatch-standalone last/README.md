# MANNYO Dispatch — standalone public version

**MANNYO Logistics and Hospitality, LLC — Twin Cities, Minnesota**

A dispatch app for 1099 drivers that lives on the public internet, not inside Muse.
The owner and drivers log in from any computer or phone with a web browser.

- **No owned fleet.** Drivers are 1099 independent contractors who use their own cars.
- **Pay:** per stop, per mile, or flat route rate. Client pays → driver gets → MANNYO keeps.
- **Starts empty:** 0 drivers, 0 routes, 0 stops. No demo/sample data in the database.

> ⚠️ The dollar rates in the app ($12 client / $7 driver / $0.50 other = $4.50 MANNYO margin
> per stop) are **examples only**. Replace them with the real contract rates before quoting,
> hiring, or paying anyone.

## What it does

- **Owner login** — full access: Board, Routes, Drivers, Pay.
- **Driver login** — sees only their own assigned routes, marks stops delivered / picked up / failed.
- **Board** — today's routes, with needs-driver / out / completed counts.
- **Routes** — create a route (client, pickup, area, pay basis, client rate, driver rate,
  other cost, miles). Route detail shows stops, a Navigate link (Google Maps search from
  the stop address), and the live client-pays → driver-gets → MANNYO-keeps breakdown.
- **Drivers** — 1099 roster with six checks: licence, insurance, registration, background
  check, W-9, signed agreement. "Ready to dispatch" only when all six are Yes.
- **Pay** — totals owed per driver, plus a pricing calculator.
- **API** — REST API with JWT auth (see below). All endpoints except login/setup require a token.

## Run locally

Requires Node.js 22 or newer (the app uses Node's built-in SQLite — no native build step).

```bash
npm install
cp .env.example .env
# Edit .env and set a long random JWT_SECRET, e.g.:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm start
```

Open http://localhost:3000

## First login (owner setup)

1. Open the site. The first time, it shows **"Set up the owner account"** — this only
   appears when no owner exists.
2. Enter your name, email, and a password (at least 8 characters). That creates the
   owner account. Keep that password safe — it is stored only as a bcrypt hash in the
   database, never in a file or in chat.
3. Log in as owner, go to **Drivers**, and add each driver with their email and a
   password. Give the driver that email + password securely (in person or by a private
   message — never in a public post).

## How drivers log in from any computer

Drivers open the same public web address, enter the email and password the owner gave
them, and see only their assigned routes. They do not need Muse, an app install, or
an account of their own — just a browser.

## Deploy publicly — Render (recommended, free tier)

1. Put this folder in a GitHub repository (do **not** commit `.env` or `mannyo.db` —
   they are in `.gitignore`).
2. Go to https://dashboard.render.com → **New + → Web Service** → pick the repo.
3. Settings: **Runtime:** Node (set the Node version to 22 or newer — `package.json`
   already requires Node 22+) · **Build Command:** `npm install` ·
   **Start Command:** `npm start` · **Instance Type:** Free.
4. Under **Environment**, add:
   - `JWT_SECRET` = a long random string (generate one as above)
   - `NODE_ENV` = `production`
5. Click **Create Web Service**. Render gives you a public URL like
   `https://mannyo-dispatch.onrender.com` — that is the address you and drivers use.
6. Open that URL and do the owner setup above.

Note: Render's free tier uses an ephemeral disk, so the SQLite file (`mannyo.db`) can be
lost if the service restarts or redeploys. That is fine for getting started. For a
business-critical database, attach a Render persistent disk (mount it at `/app` and
set `DATABASE_URL` to the file on that disk), or move the data to a hosted database later.

## Deploy publicly — Railway

1. Put this folder in a GitHub repository.
2. Go to https://railway.app → **New Project → Deploy from GitHub repo** → pick the repo.
3. Railway detects Node and runs `npm install` / `npm start` automatically.
4. Under **Variables**, add `JWT_SECRET` = a long random string.
5. Under **Settings → Networking**, generate a public domain. That is your login address.
6. Open it and do the owner setup above. (Same note as Render: add a Railway volume
   for the SQLite file if you want the data to survive restarts.)

## Deploy with Docker

```bash
docker build -t mannyo-dispatch .
docker run -p 3000:3000 -e JWT_SECRET='<your-long-random-secret>' -v mannyo-data:/app mannyo-dispatch
```

## API

Base URL is the site address. Send the login token as `Authorization: Bearer <token>`.

| Method | Endpoint | Who | What |
|---|---|---|---|
| GET | `/api/health` | anyone | Server check |
| GET | `/api/auth/setup-needed` | anyone | Is first-owner setup still open? |
| POST | `/api/auth/setup` | first owner only | `{name, email, password}` → owner + token |
| POST | `/api/auth/login` | anyone with an account | `{email, password}` → user + token |
| GET | `/api/auth/me` | logged in | Current user |
| GET / POST | `/api/drivers` | owner | List / create driver (+ login account) |
| PATCH | `/api/drivers/:id` | owner | Update driver, incl. the six checks |
| GET / POST | `/api/routes` | owner creates; driver lists only theirs | List / create route |
| GET / PATCH | `/api/routes/:id` | owner | Route detail / assign driver / status |
| POST | `/api/routes/:id/stops` | owner | Add a stop |
| PATCH | `/api/stops/:id` | owner or assigned driver | Mark stop delivered / picked_up / failed |
| GET | `/api/pay` | owner (all) / driver (own) | Pay totals per driver |
| POST | `/api/pricing/calculate` | logged in | Pay breakdown for given rates |

Pay math: per stop, client = client rate × stops, driver = driver rate × stops,
other = other cost × stops; per mile uses miles instead of stops; flat uses the
rates as whole-route totals. MANNYO keeps = client − driver − other.

## Files

- `server.js` — Express API + static frontend server + SQLite setup (Node built-in `node:sqlite`)
- `public/index.html`, `public/app.js`, `public/styles.css` — the web app
- `package.json` — dependencies and `npm start`
- `.env.example` — settings to copy to `.env` (JWT_SECRET, PORT)
- `Dockerfile` — container build
- `README.md` — this file

## Security notes

- No passwords are in this code or in any file. Passwords are hashed with bcrypt
  (bcryptjs) and stored only in `mannyo.db`.
- Set a long random `JWT_SECRET` on every deployment — if it changes, everyone must
  log in again.
- This is a small-business dispatch tool, not legal advice. Keep the 1099 checks in
  the Drivers tab up to date (licence, insurance, registration, background check,
  W-9, signed agreement) and pay drivers per stop / per mile / per route as agreed,
  not by the hour.
