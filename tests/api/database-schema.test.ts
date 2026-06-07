import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { PgDialect } from 'drizzle-orm/pg-core'
import { createApp, createRouter, toNodeListener, type EventHandler } from 'h3'
import { createMokelayOrchestrationHandler } from 'mokelay-server-core/utils/orchestration'
import type { DatabaseType, SqlExecutionResult } from 'mokelay-server-core/utils/db'

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
}

type RecordedQuery = {
  datasource: string
  databaseType: DatabaseType
  sql: string
}

type SchemaResponse = {
  ok: true
  data: {
    tables: Array<{
      name: string
      columns: Array<{
        name: string
        type: string
        dataType: string
      }>
    }>
  }
}

const pgDialect = new PgDialect()
const mysqlDialect = new MySqlDialect()

async function startServer(handler: EventHandler): Promise<TestServer> {
  const app = createApp()
  const router = createRouter()

  router.use('/api/mokelay/:apiJsonUuid', handler)
  app.use(router)

  const server = createServer(toNodeListener(app))

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
  }
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function readJson<T>(response: Response) {
  return await response.json() as T
}

describe('database schema JSON API', () => {
  const originalEnv = { ...process.env }
  let testServer: TestServer | undefined

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
    }
  })

  afterEach(async () => {
    await testServer?.close()
    testServer = undefined
    process.env = { ...originalEnv }
  })

  it('returns Postgres database tables with their columns from the datasource query parameter', async () => {
    process.env.Mokelay_DATABASE_URL = 'postgres://schema-unit-test'
    const queries: RecordedQuery[] = []
    const handler = createMokelayOrchestrationHandler({
      executeSql: async <T extends Record<string, unknown> = Record<string, unknown>>(
        query: SQL,
        datasource: string,
        databaseType: DatabaseType,
      ): Promise<SqlExecutionResult<T>> => {
        const builtQuery = pgDialect.sqlToQuery(query)
        const queryText = builtQuery.sql.replace(/\s+/g, ' ').trim()

        queries.push({
          datasource,
          databaseType,
          sql: queryText,
        })

        return {
          databaseType,
          rows: [
            { tableName: 'apis', columnName: 'uuid', columnType: 'character varying(128)' },
            { tableName: 'apis', columnName: 'api_json', columnType: 'jsonb' },
            { tableName: 'pages', columnName: 'uuid', columnType: 'uuid' },
            { tableName: 'pages', columnName: 'blocks', columnType: 'jsonb' },
          ] as unknown as T[],
        }
      },
    })
    testServer = await startServer(handler)

    const response = await fetch(`${testServer.baseUrl}/api/mokelay/schema?datasource=Mokelay`)
    const body = await readJson<SchemaResponse>(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      data: {
        tables: [
          {
            name: 'apis',
            columns: [
              { name: 'uuid', type: 'character varying(128)', dataType: 'character varying(128)' },
              { name: 'api_json', type: 'jsonb', dataType: 'jsonb' },
            ],
          },
          {
            name: 'pages',
            columns: [
              { name: 'uuid', type: 'uuid', dataType: 'uuid' },
              { name: 'blocks', type: 'jsonb', dataType: 'jsonb' },
            ],
          },
        ],
      },
    })
    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatchObject({
      datasource: 'Mokelay',
      databaseType: 'postgres',
    })
    expect(queries[0]?.sql).toContain('FROM pg_catalog.pg_class cls')
    expect(queries[0]?.sql).toContain("WHERE ns.nspname = 'public' AND cls.relkind = 'r'")
  })

  it('generates MySQL-compatible schema SQL for MySQL datasources', async () => {
    process.env.BingX_DATABASE_URL = 'mysql://schema-unit-test'
    const queries: RecordedQuery[] = []
    const handler = createMokelayOrchestrationHandler({
      executeSql: async <T extends Record<string, unknown> = Record<string, unknown>>(
        query: SQL,
        datasource: string,
        databaseType: DatabaseType,
      ): Promise<SqlExecutionResult<T>> => {
        const builtQuery = mysqlDialect.sqlToQuery(query)
        const queryText = builtQuery.sql.replace(/\s+/g, ' ').trim()

        queries.push({
          datasource,
          databaseType,
          sql: queryText,
        })

        return {
          databaseType,
          rows: [
            { tableName: 'smart_contracts', columnName: 'id', columnType: 'int' },
            { tableName: 'smart_contracts', columnName: 'abi_json', columnType: 'json' },
          ] as unknown as T[],
        }
      },
    })
    testServer = await startServer(handler)

    const response = await fetch(`${testServer.baseUrl}/api/mokelay/schema?datasource=BingX`)
    const body = await readJson<SchemaResponse>(response)

    expect(response.status).toBe(200)
    expect(body.data.tables).toEqual([
      {
        name: 'smart_contracts',
        columns: [
          { name: 'id', type: 'int', dataType: 'int' },
          { name: 'abi_json', type: 'json', dataType: 'json' },
        ],
      },
    ])
    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatchObject({
      datasource: 'BingX',
      databaseType: 'mysql',
    })
    expect(queries[0]?.sql).toContain('FROM information_schema.tables tbl')
    expect(queries[0]?.sql).toContain('tbl.TABLE_SCHEMA = DATABASE()')
    expect(queries[0]?.sql).not.toContain('pg_catalog')
  })
})
