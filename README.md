# Ekta Motors — Full-Stack Render Deployment

This is the latest Ekta Motors website exported from Google AI Studio, prepared for deployment as a full-stack Express + Vite application on Render with Supabase.

## Local setup

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Fill in your Supabase values and admin password.
4. Run `npm install`.
5. Run `npm run dev`.

## Production

```bash
npm install
npm run build
npm start
```

The production server uses `process.env.PORT`, listens on `0.0.0.0`, and exposes `/healthz` for Render health checks.

## Render

Create a **Web Service** from this GitHub repository.

- Runtime: Node
- Branch: `main`
- Root Directory: blank
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Plan: Free
- Health check: `/healthz`

Set these environment variables in Render:

- `NODE_ENV=production`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_PASSWORD`

Never commit `.env` or server-side Supabase secrets.

## Supabase

The site uses Supabase for live dealership data such as vehicles, reviews, bookings, and vehicle images. Run `supabase-schema.sql` in the Supabase SQL Editor if the required tables/policies have not already been created.

Render's free filesystem is ephemeral, so production dealership data should remain in Supabase rather than relying on local JSON files for persistence.
