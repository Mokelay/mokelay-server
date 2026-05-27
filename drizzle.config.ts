import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.Mokelay_DATABASE_URL

if (!databaseUrl) {
  throw new Error('Mokelay_DATABASE_URL is not configured.')
}

export default defineConfig({
  schema: './node_modules/mokelay-server-core/dist/database/schema.js',
  out: './server/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
})
