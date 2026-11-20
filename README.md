# Mokelay Server

Mokelay public API service. It owns Mokelay orchestration execution and the PostgreSQL/Drizzle schema that used to live in `mokelay-website`.

## Built-in App Assets

Built-in app resources live under `server/assets/{app}/pages`, `apis`, and `layouts`.
The existing Mokelay resources are in `server/assets/mokelay`; built-in API fragments
live in `{app}/apis/fragment`. `server/assets/mokelay-schema` remains a temporary
exception for shared AI DSL schemas. The route `/api/{app}/{uuid}` selects the matching application directory.
Built-in Fragments stay in that application; only `mokelay` retains the existing
R2/database fallback and `mokelay-apis` R2 prefix. Pages are discovered across applications
and retain globally unique UUIDs. Asset list/read responses include `assetApp`.

The server requires the matching `mokelay-server-core` loader for these paths. In the
workspace, run `npm run sync:server-core` before verification. Deployments must use a
core release containing this loader change together with the reorganized assets.

## API

- `GET|POST /api/{app}/{API_JSON_UUID}` (platform: `mokelay`, reimbursement: `lark`)
- `GET /api/database/schema`
- `POST /api/mokelay/analyze-data-source`
- `POST /api/mokelay/ai-generate-dsl`
- `POST /api/mokelay/ai-translate`

Auth-like flows such as register, login, current user, and logout are exposed through Mokelay orchestration JSON definitions under `server/assets/mokelay/apis` and use the internal signed `mokelay_orchestration_session` HTTP-only cookie. Runtime loading checks local server assets first, then Cloudflare R2, then published records in the `apis` table. See `docs/auth-json-apis.md` for the generated interface documentation. In production, set `COOKIE_DOMAIN=.mokelay.com` so `www.mokelay.com` can call `api.mokelay.com` with credentials.

OAuth login and signup also use Mokelay orchestration JSON definitions. The public entrypoints are `GET /api/mokelay/oauth_google_start`, `GET /api/mokelay/oauth_google_callback`, `GET /api/mokelay/oauth_github_start`, and `GET /api/mokelay/oauth_github_callback`. Set `OAUTH_CALLBACK_BASE_URL` to the public API origin, for example `https://api.mokelay.com`.

Pages and API Builder outputs are exposed through Mokelay orchestration JSON definitions under `server/assets/mokelay/apis`, Cloudflare R2 object keys under `mokelay-apis/*.json`, or published `apis` table records. See `docs/api-json-schema.md` for the full API JSON schema and `docs/orchestration-blocks.md` for block configuration. Database blocks read connections from `${datasource}_DATABASE_URL`, based on each block's `inputs.datasource`.

Read public database table metadata with `GET /api/database/schema`. The response is `{ "tables": [{ "name": "users", "columns": [{ "name": "id", "type": "uuid", "dataType": "uuid" }] }] }`.

`POST /api/mokelay/analyze-data-source` recognizes data sources from an image or text through the generic OpenAI JSON block. Send image files as multipart data in the `image` field as JPEG, PNG, or WebP up to 10MB:

```bash
curl -X POST http://127.0.0.1:8787/api/mokelay/analyze-data-source \
  -F "image=@./source.png"
```

Send text as JSON with a non-empty `userInput` field:

```bash
curl -X POST http://127.0.0.1:8787/api/mokelay/analyze-data-source \
  -H "Content-Type: application/json" \
  -d '{ "userInput": "GET https://api.mokelay.com/api/mokelay/me?debug=true" }'
```

When the input contains JSON data, `data` is `{ "type": "JSON", "rawData": ... }`. When it contains API information, `data` is `{ "type": "API", "domain": "...", "path": "...", "method": "...", "headerData": [], "bodyData": [], "queryData": [] }`. Unrecognized input returns `{ "type": "UNKNOWN" }`.

`POST /api/mokelay/ai-generate-dsl` generates Mokelay page DSL, API DSL, and capability upgrade specifications from a requirement document. See `docs/ai-dsl-generation.md` for the response contract.

```bash
curl -X POST http://127.0.0.1:8787/api/mokelay/ai-generate-dsl \
  -H "Content-Type: application/json" \
  -d '{ "requirementDocument": "客户管理：需要客户列表、创建客户、删除客户，删除前需要确认。" }'
```

`POST /api/mokelay/ai-translate` translates an ordered string array:

```bash
curl -X POST http://127.0.0.1:8787/api/mokelay/ai-translate \
  -H "Content-Type: application/json" \
  -d '{ "texts": ["Hello", "Welcome, {{name}}"], "sourceLanguage": "English", "targetLanguage": "中文" }'
```

The response data is `{ "translations": ["你好", "欢迎，{{name}}"] }` and preserves the input order.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

The dev server listens on `http://127.0.0.1:8787`. Mokelay orchestration JSON examples use `Mokelay_DATABASE_URL`.

## Mokelay API JSON on R2

Runtime loading checks `server/assets/mokelay/apis` and Nitro server assets first, then Cloudflare R2 when all R2 environment variables are configured, then published rows in the `apis` table. R2 object keys use `mokelay-apis/{API_JSON_UUID}.json` by default.

Required R2 environment variables:

```env
CLOUDFLARE_R2_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_R2_ACCESS_KEY_ID=your-r2-access-key-id
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
MOKELAY_APIS_R2_BUCKET=your-r2-bucket
MOKELAY_APIS_R2_PREFIX=mokelay-apis
```

`CLOUDFLARE_R2_ENDPOINT` is optional. When omitted, the server uses `https://<CLOUDFLARE_R2_ACCOUNT_ID>.r2.cloudflarestorage.com`.

Sync the repo JSON files to R2 after editing them:

```bash
npm run sync:mokelay-apis:r2
```

The sync command automatically loads `.env` from the `mokelay-server` directory.

The runtime token needs Cloudflare R2 Object Read permission for fallback loading and Object Write permission when API builder users publish APIs. The sync command also needs Object Read & Write permission.

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
Mokelay_DATABASE_URL=your-production-postgres-url
SESSION_SECRET=use-a-strong-random-string-at-least-32-chars
COOKIE_DOMAIN=.mokelay.com
CORS_ORIGINS=https://www.mokelay.com,https://mokelay.com,https://editor.mokelay.com,http://localhost:5173
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
OAUTH_CALLBACK_BASE_URL=https://api.mokelay.com
OAUTH_APP_BASE_URL=https://www.mokelay.com
OAUTH_GOOGLE_CLIENT_ID=your-google-oauth-client-id
OAUTH_GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
OAUTH_GITHUB_CLIENT_ID=your-github-oauth-client-id
OAUTH_GITHUB_CLIENT_SECRET=your-github-oauth-client-secret
CLOUDFLARE_R2_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_R2_ACCESS_KEY_ID=your-r2-access-key-id
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
MOKELAY_APIS_R2_BUCKET=your-r2-bucket
MOKELAY_APIS_R2_PREFIX=mokelay-apis
```

Before production signups, run migrations against the production database:

```bash
Mokelay_DATABASE_URL="your-production-postgres-url" npm run db:migrate
```

## Verification

```bash
npm run typecheck
npm run test
npm run build
```

## Local Lark database

Configure `Lark_DATABASE_URL` with a separate `lark` database on your local MySQL or PostgreSQL instance. Keep `Mokelay_DATABASE_URL` for platform accounts and tenants. The database user needs permission to create/use the target database; a local administrator can create it and grant privileges on `lark.*` first.

From the server directory:

```sh
npm run db:lark:init -- --copy-existing
```

The command creates the business tables, copies the existing reimbursement categories/applications from the platform database, verifies every copied field including the generated settlement, then adds missing default categories. Conflicting rows abort the data transaction without overwriting. Source tables are retained. Repeating the command verifies existing rows without duplicating them. For a fresh installation without legacy reimbursement tables, omit `--copy-existing`. Use the same database engine for copying; stop old reimbursement writes during migration.

Lark schema and initialization SQL live in `server/database/lark`. The write Fragment uses `Lark` throughout its transaction. Employee membership is checked in `Mokelay` before that transaction; `reimbursement_write_locks` serializes concurrent writes per tenant/applicant through the generic `upsert` Block. No cross-database foreign keys or transactions are required.

The page remains available as `#/pages/reimbursement/preview?source=system` in the editor. Its MForm DSL sets `draft.apiApp: "lark"`; the visual draft panel exposes this application setting. Existing drafts without `apiApp` continue using `mokelay`. System API/Fragment detail links carry `assetApp=lark`.

To run the split-database integration suite, set `REIMBURSEMENT_TEST_MYSQL_URL` (platform) and `LARK_TEST_MYSQL_URL` (business), or the corresponding `REIMBURSEMENT_TEST_POSTGRES_URL` and `LARK_TEST_POSTGRES_URL`, then run `npx vitest run tests/integration/reimbursement.test.ts`. Fixtures clean up only their own records.
