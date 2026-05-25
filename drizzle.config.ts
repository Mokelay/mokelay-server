import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.Mokelay_DATABASE_URL

if (!databaseUrl) {
  throw new Error('Mokelay_DATABASE_URL is not configured.')
}

export default defineConfig({
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
})
