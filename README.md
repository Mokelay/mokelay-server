# Mokelay Server

Mokelay public API service. It owns Mokelay orchestration execution and the PostgreSQL/Drizzle schema that used to live in `mokelay-website`.

## API

- `GET|POST /api/mokelay/{API_JSON_UUID}`
- `GET /api/database/schema`
- `POST /api/ai/analyze-data-source`

Auth-like flows such as register, login, current user, and logout are exposed through Mokelay orchestration JSON definitions under `server/assets/mokelay-apis` and use the internal signed `mokelay_orchestration_session` HTTP-only cookie. See `docs/auth-json-apis.md` for the generated interface documentation. In production, set `COOKIE_DOMAIN=.mokelay.com` so `www.mokelay.com` can call `api.mokelay.com` with credentials.

Pages are exposed through Mokelay orchestration JSON definitions under `server/assets/mokelay-apis`. See `docs/api-json-schema.md` for the full API JSON schema and `docs/orchestration-blocks.md` for block configuration. Database blocks read connections from `${datasource}_DATABASE_URL`, based on each block's `inputs.datasource`.

Read public database table metadata with `GET /api/database/schema`. The response is `{ "tables": [{ "name": "users", "columns": [{ "name": "id", "type": "uuid", "dataType": "uuid" }] }] }`.

`POST /api/ai/analyze-data-source` is a public endpoint for recognizing data sources from an image or text. Send image files as multipart data in the `image` field as JPEG, PNG, or WebP up to 10MB:

```bash
curl -X POST http://127.0.0.1:8787/api/ai/analyze-data-source \
  -F "image=@./source.png"
```

Send text as JSON with a non-empty `text` field up to 100KB:

```bash
curl -X POST http://127.0.0.1:8787/api/ai/analyze-data-source \
  -H "Content-Type: application/json" \
  -d '{ "text": "GET https://api.mokelay.com/api/mokelay/me?debug=true" }'
```

When the input contains JSON data, the response is `{ "type": "JSON", "rawData": ... }`. When it contains API information, the response is `{ "type": "API", "domain": "...", "path": "...", "method": "...", "headerData": [], "bodyData": [], "queryData": [] }`. Unrecognized input returns `422`.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

The dev server listens on `http://127.0.0.1:8787`. Mokelay orchestration JSON examples use `Mokelay_DATABASE_URL`.

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
Mokelay_DATABASE_URL=your-production-postgres-url
SESSION_SECRET=use-a-strong-random-string-at-least-32-chars
COOKIE_DOMAIN=.mokelay.com
CORS_ORIGINS=https://www.mokelay.com,https://mokelay.com,https://editor.mokelay.com,http://localhost:5173
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
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
