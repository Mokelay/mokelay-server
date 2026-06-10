import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.Mokelay_DATABASE_URL

if (!databaseUrl) {
  throw new Error('Mokelay_DATABASE_URL is not configured.')
}

let databaseProtocol: string

try {
  databaseProtocol = new URL(databaseUrl).protocol
} catch {
  throw new Error('Mokelay_DATABASE_URL must be a valid PostgreSQL URL.')
}

if (databaseProtocol !== 'postgres:' && databaseProtocol !== 'postgresql:') {
  throw new Error(
    `Mokelay_DATABASE_URL must use the postgres:// or postgresql:// protocol, received ${databaseProtocol}`,
  )
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
