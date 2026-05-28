# Beardo Mega Auction

A timed-auction website with pre-registered members, an admin-controlled bidding timer, a product catalog with base prices, and separate Terms & Conditions and FAQ sections. Built with Node.js, Express, Socket.IO (live updates), and PostgreSQL on Render (file store fallback for local dev).

## Production site (source of truth)

> **https://beardoauction.onrender.com** — this is the **live, canonical** site, with the real lots, bidders and bids. Render's Postgres is the production database.

Use this URL for the actual auction. Anyone with the URL can browse; only pre-registered users can log in to bid. Admin sign-in: `admin@auction.local` / `admin123` (please change to your own admin after the event).

**Do NOT** set the `SEED_RESET_TOKEN` environment variable on the Render service — it enables an endpoint that wipes the production database and re-seeds defaults. Only set it if you explicitly want to nuke production back to demo state.

## Local server (development sandbox only)

The local server at `http://localhost:3000` is a **separate environment** with its own JSON-file store. It exists for code development and is **not** synced with Render. Restarting/resetting it has no effect on the live site.

## Run it

Double-click **`start.bat`**, or from a terminal:

```
npm install     (first time only)
npm start
```

Then open **http://localhost:3000**.

Other devices on your network can reach it at `http://<your-pc-ip>:3000`.

## Seed accounts

| Role   | Email                  | Password   |
|--------|------------------------|------------|
| Admin  | admin@auction.local    | admin123   |
| Bidder | bidder@auction.local   | bidder123  |

> Change these after first login (create new users in the Admin panel and remove the samples).

## How it works

- **Pre-registration only** — there is no public sign-up. The admin creates accounts (email + password, bcrypt-hashed) in the **Admin → Registered Users** section, one at a time or in bulk (below).
- **Bulk user upload (Excel)** — in the Admin panel, upload an `.xlsx`/`.csv` with a header row of **Name** and **Email** (optional **Role** = `bidder`/`admin`). The server creates each new user and **auto-generates a temporary password**, then shows a results table with those passwords to copy and distribute. Duplicates, blanks, and already-registered emails are skipped with a reason. Use the **Download a template** link to get the expected columns.
- **Catalog & base price** — every lot has a base price that acts as the floor for the first bid. The next bid must always exceed the current highest bid. When adding a lot, the admin can **upload a product image** (JPEG/PNG/WebP/GIF, up to 5 MB) or paste an image URL. Uploaded images are stored separately from the auction state — in a Postgres `images` table when `DATABASE_URL` is set, otherwise under `data/images/` — and served via `/api/images/:id`.
- **Admin-controlled timer** — the admin opens a lot by setting a duration in seconds (**Start**), and can **Pause**, **±seconds** (extend/shorten), **Resume**, or **Close now**. The countdown is enforced on the server: when it hits zero the lot closes automatically and further bids are rejected.
- **Terms & Conditions and FAQ** — kept on separate pages (`/clauses.html`, `/faq.html`) and editable by the admin in the Admin panel.
- **Live updates** — bids and timer changes broadcast to all connected browsers via Socket.IO; no refresh needed.

## Access over the web

The server binds to all interfaces, so on the **same network** other devices reach it at `http://<your-pc-ip>:3000` (your IP is printed in the console at startup).

For a **public internet** link with the fixed name **beardoauction**, run **`beardoauction-web.bat`** (or, with the server running, in a second terminal):

```
lt --port 3000 --subdomain beardoauction
```

This publishes the site at **https://beardoauction.loca.lt** (localtunnel). Notes:

- The name `beardoauction` is **reusable** — you get the same URL every time you start the tunnel, as long as that subdomain is free at that moment. This is as close to "permanent" as you get without a paid domain.
- First-time visitors in a browser see a localtunnel **reminder page**; they click **Click to Continue** (it may ask for the tunnel password, which is this PC's public IPv4 — shown at https://loca.lt/mytunnelpassword). After that the site loads normally.
- Keep the Node server running; the tunnel just forwards to it. The URL stops working when you close the tunnel window.
- For a guaranteed-uptime, truly permanent custom domain, use a named **Cloudflare tunnel** (free Cloudflare account + a domain) or deploy to a host. A `cloudflared` quick tunnel (random `*.trycloudflare.com` URL) is also installed if you prefer: `cloudflared tunnel --url http://localhost:3000`.

## Permanent hosting on Render

This repo is ready to deploy to [Render](https://render.com) as an always-on public site at **https://beardoauction.onrender.com** (no PC required). A `render.yaml` blueprint is included (service name `beardoauction`, free plan, auto-generated session secret).

**Steps:**

1. Push this folder to a **GitHub** repo (see "Initial git push" below).
2. In Render: **New → Blueprint**, connect the GitHub repo. Render reads `render.yaml` and creates the `beardoauction` web service.
3. Click **Apply**. First build takes a few minutes; then your site is live at `https://beardoauction.onrender.com`.
   - If the name `beardoauction` is already taken on Render globally, it appends a suffix — rename the service in `render.yaml` if you want a different name.

**Initial git push:**

```
git remote add origin https://github.com/<you>/beardoauction.git
git branch -M main
git push -u origin main
```

**Data persistence:** the blueprint also provisions a **free Render PostgreSQL** database (`beardoauction-db`) and injects its connection string as `DATABASE_URL`. The app stores all state there, so **uploaded users, lots, and bids survive deploys and restarts**. (If `DATABASE_URL` is not set — e.g. local dev — it transparently falls back to the `data/db.json` file.)

**Free-tier notes:**

- Free web services **spin down after ~15 min idle**; the next visit takes ~50s to wake. The URL stays the same and your data is intact.
- Render's **free Postgres has a limited lifetime** (Render may expire free databases after a period). For indefinitely-free persistence, create a free database on **[Neon](https://neon.tech)** or **Supabase** and paste its connection string into the `DATABASE_URL` env var on the Render service instead — no code change needed.

## Storage configuration

| `DATABASE_URL` | Backend used |
|----------------|--------------|
| set            | PostgreSQL (persistent) — any Postgres: Render, Neon, Supabase, local |
| not set        | `data/db.json` file (local dev / demo) |

The whole app state is stored as a single JSON document (a `jsonb` row in the `app_state` table), written with a short debounce so rapid bids don't hammer the database.

## Branding & logo

The header, login page, and page titles read **Beardo Mega Auction**, on a black theme with white/red text (see the CSS variables at the top of `public/css/styles.css`).

The official Beardo logo is at `public/img/beardo-logo.jpg`, shown in the header and login page on a small white chip (the artwork is black-on-white, so the chip keeps it crisp against the black theme). To replace it, overwrite that file (keep the name) or update the one `src` in `public/js/common.js` (topbar `<img>`) and the `<img>` on `public/login.html`.

## Data & reset

All data lives in `data/db.json`. Delete that file and restart to return to the seeded demo state.

## Notes

- Sessions use an in-memory store, so restarting the server logs everyone out.
- This is a single-server local app; for public/production use, move secrets to env vars, use HTTPS, and swap the JSON store for a real database.
