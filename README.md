# Mokelay Server

Mokelay public API service. It owns website auth, user storage, billing webhook placeholders, and the PostgreSQL/Drizzle schema that used to live in `mokelay-website`.

## API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `POST /api/billing/webhook`

Auth uses a signed `mokelay_session` HTTP-only cookie. In production, set `COOKIE_DOMAIN=.mokelay.com` so `www.mokelay.com` can call `api.mokelay.com` with credentials.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

The dev server listens on `http://127.0.0.1:8787`. If `DATABASE_URL` is not set, auth uses an in-memory user store for local preview and tests.

## Database

```bash
npm run db:generate
npm run db:migrate
```

Production should use the existing Mokelay database URL so user records and migrations are preserved.

## Deployment

Deploy to Vercel and bind `api.mokelay.com`.

Required environment variables:

```env
NODE_ENV=production
DATABASE_URL=your-production-postgres-url
SESSION_SECRET=use-a-strong-random-string-at-least-32-chars
COOKIE_DOMAIN=.mokelay.com
CORS_ORIGINS=https://www.mokelay.com,https://mokelay.com,http://localhost:5173
STRIPE_WEBHOOK_SECRET=
```

Before production signups, run migrations against the production database:

```bash
DATABASE_URL="your-production-postgres-url" npm run db:migrate
```

## Verification

```bash
npm run typecheck
npm run test
npm run build
```
