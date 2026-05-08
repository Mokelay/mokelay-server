import { createError } from 'h3'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../database/schema'
import { mokelayError } from './mokelay-error'

type Database = ReturnType<typeof drizzle<typeof schema>>

type DatabaseConnection = {
  client: postgres.Sql
  db: Database
}

const globalForDb = globalThis as typeof globalThis & {
  __mokelayPostgresClient?: postgres.Sql
  __mokelayDb?: Database
  __mokelayDatasourceDbs?: Map<string, DatabaseConnection>
}

const datasourceNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/

function createPostgresClient(databaseUrl: string) {
  return postgres(databaseUrl, {
    max: 5,
    prepare: false,
  })
}

function createDatabaseConnection(databaseUrl: string): DatabaseConnection {
  const client = createPostgresClient(databaseUrl)

  return {
    client,
    db: drizzle(client, { schema }),
  }
}

function datasourceConnections() {
  if (!globalForDb.__mokelayDatasourceDbs) {
    globalForDb.__mokelayDatasourceDbs = new Map()
  }

  return globalForDb.__mokelayDatasourceDbs
}

export function normalizeDatasourceName(datasource: unknown) {
  if (typeof datasource !== 'string' || !datasource.trim()) {
    throw mokelayError('BLOCK_INVALID_DATASOURCE', 'datasource 必须是非空字符串。', 400)
  }

  const name = datasource.trim()

  if (!datasourceNamePattern.test(name)) {
    throw mokelayError('BLOCK_INVALID_DATASOURCE', 'datasource 只能包含字母、数字、下划线，且不能以数字开头。', 400)
  }

  return name
}

export function datasourceDatabaseUrlEnvName(datasource: unknown) {
  return `${normalizeDatasourceName(datasource)}_DATABASE_URL`
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
    globalForDb.__mokelayPostgresClient = createPostgresClient(databaseUrl)
  }

  if (!globalForDb.__mokelayDb) {
    globalForDb.__mokelayDb = drizzle(globalForDb.__mokelayPostgresClient, { schema })
  }

  return globalForDb.__mokelayDb
}

export function useDatasourceDb(datasource: string) {
  const envName = datasourceDatabaseUrlEnvName(datasource)
  const databaseUrl = process.env[envName]

  if (!databaseUrl) {
    throw mokelayError('BLOCK_DATASOURCE_URL_MISSING', `${envName} is not configured.`, 500)
  }

  const cacheKey = `${envName}:${databaseUrl}`
  const connections = datasourceConnections()
  let connection = connections.get(cacheKey)

  if (!connection) {
    connection = createDatabaseConnection(databaseUrl)
    connections.set(cacheKey, connection)
  }

  return connection.db
}
