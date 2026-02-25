# NDDSU Web-Based AR Navigation (Checkpoint Graph)

This project implements a checkpoint-based AR-style navigation system for the NDDSU campus.  
Instead of pointing straight to the final room coordinates, the arrow **always points only to the next checkpoint** on a shortest path over a graph stored in Supabase.

## Supabase setup

1. Create a new Supabase project.
2. In the SQL editor:
   - Paste and run `supabase_schema.sql`.
   - Paste and run `supabase_seed.sql`.
3. In the project settings, copy:
   - Project URL
   - Public anon key
4. Open `navigation_app.js` and replace:

```js
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

with your real values.

## Running locally

The project is just static HTML + JavaScript:

1. Serve the `nddusiena` folder with your existing XAMPP setup.
2. Open `index.html` in a mobile browser (HTTPS + GPS + compass recommended).
3. Select a destination (Finance, Registrar, Clinic) and tap **Start navigation**.

The app will:

- Detect your GPS location.
- Find the nearest checkpoint.
- Use Dijkstra’s algorithm over the `checkpoints` and `edges` tables.
- Navigate checkpoint-by-checkpoint until you reach the destination checkpoint.

# Notre Dame Siena College – AR Indoor Navigation

Mobile-first AR indoor navigation for campus (Finance, Guidance, Registrar). Uses browser camera, GPS, and device orientation.

## Tech

- **Frontend:** HTML, CSS, JavaScript (no build step)
- **Backend / DB:** Supabase (PostgreSQL), anon read-only
- **Deploy:** Vercel (static + serverless if using API routes)

## Run locally

1. Serve the folder with any static server (e.g. XAMPP, `npx serve .`, or Vercel CLI).
2. Ensure `.env` has:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. Open `index.html` (or the root URL). For camera/GPS use HTTPS or localhost.

## Deploy on Vercel

1. Push this repo to GitHub: `https://github.com/mrvnzxc/nddusiena`
2. In [Vercel](https://vercel.com): **Add New Project** → **Import** the repo.
3. **Environment Variables** (Settings → Environment Variables):
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_ANON_KEY` = your Supabase anon key
4. Deploy. Vercel will serve the static files; ensure your app reads the API from the same origin or configure CORS if you use a separate API.

## Database

Schema and setup are in `campus_navigation.sql`. Production data lives in Supabase; see project docs for Supabase setup and RLS (anon read-only).

---

© Notre Dame Siena College of General Santos City
