import { createError } from 'h3'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../database/schema'

type Database = ReturnType<typeof drizzle<typeof schema>>

const globalForDb = globalThis as typeof globalThis & {
  __mokelayPostgresClient?: postgres.Sql
  __mokelayDb?: Database
}

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL)
}

export function useDb() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw createError({
      statusCode: 500,
      message: 'DATABASE_URL is not configured.',
    })
  }

  if (!globalForDb.__mokelayPostgresClient) {
    globalForDb.__mokelayPostgresClient = postgres(databaseUrl, {
      max: 5,
      prepare: false,
    })
  }

  if (!globalForDb.__mokelayDb) {
    globalForDb.__mokelayDb = drizzle(globalForDb.__mokelayPostgresClient, { schema })
  }

  return globalForDb.__mokelayDb
}
