import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { createApp, createRouter, toNodeListener, type EventHandler } from 'h3'
import { createMokelayOrchestrationHandler } from 'mokelay-server-core/utils/orchestration'
import type { DatabaseType, SqlExecutionResult } from 'mokelay-server-core/utils/db'

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
}

type RecordedQuery = {
  sql: string
  params: unknown[]
  datasource: string
  databaseType: DatabaseType
}

type SettingsResponse = {
  affected: number
  doc: null | {
    uuid: string
    editor_enabled: boolean
    toolbox_visible: boolean
    sort_order: number
  }
}

const apiPath = resolve(process.cwd(), 'server/assets/mokelay-apis/update_client_block_doc_settings.json')
const pgDialect = new PgDialect()
const originalEnv = { ...process.env }

async function startServer(handler: EventHandler): Promise<TestServer> {
  const app = createApp()
  const router = createRouter()
  router.use('/api/mokelay/:apiJsonUuid', handler)
  app.use(router)

  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose())
    }),
  }
}

describe('POST /api/mokelay/update_client_block_doc_settings', () => {
  let testServer: TestServer | undefined
  let queries: RecordedQuery[]
  let affected = 1

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      Mokelay_DATABASE_URL: 'postgres://client-block-doc-settings-test',
    }
    queries = []
    affected = 1
    const apiJson = JSON.parse(await readFile(apiPath, 'utf8')) as unknown
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async (uuid) => {
        if (uuid !== 'update_client_block_doc_settings') {
          throw new Error(`Unexpected API ${uuid}`)
        }
        return apiJson
      },
      executeSql: async <T extends Record<string, unknown> = Record<string, unknown>>(
        query: SQL,
        datasource: string,
        databaseType: DatabaseType,
      ): Promise<SqlExecutionResult<T>> => {
        const built = pgDialect.sqlToQuery(query)
        const sql = built.sql.replace(/\s+/g, ' ').trim()
        queries.push({ sql, params: [...built.params], datasource, databaseType })

        if (sql.startsWith('UPDATE')) {
          return {
            databaseType,
            rows: (affected ? [{ affected_marker: 1 }] : []) as unknown as T[],
          }
        }

        return {
          databaseType,
          rows: (affected ? [{
            uuid: 'mokelay-editor-MButton',
            editor_enabled: false,
            toolbox_visible: true,
            sort_order: 30,
          }] : []) as unknown as T[],
        }
      },
    })
    testServer = await startServer(handler)
  })

  afterEach(async () => {
    await testServer?.close()
    testServer = undefined
    process.env = { ...originalEnv }
  })

  it('updates all three runtime settings and returns the updated document', async () => {
    const response = await fetch(`${testServer?.baseUrl}/api/mokelay/update_client_block_doc_settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uuid: 'mokelay-editor-MButton',
        editor_enabled: false,
        toolbox_visible: true,
        sort_order: '30',
      }),
    })
    const body = await response.json() as { ok: boolean, data: SettingsResponse }

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      data: {
        affected: 1,
        doc: {
          uuid: 'mokelay-editor-MButton',
          editor_enabled: false,
          toolbox_visible: true,
          sort_order: 30,
        },
      },
    })
    expect(queries).toHaveLength(2)
    expect(queries[0]).toMatchObject({ datasource: 'Mokelay', databaseType: 'postgres' })
    expect(queries[0]?.sql).toContain('UPDATE "docs_client_block" SET')
    expect(queries[0]?.params).toEqual(expect.arrayContaining([false, true, '30', 'mokelay-editor-MButton']))
  })

  it('rejects an invalid sort order before executing database SQL', async () => {
    const response = await fetch(`${testServer?.baseUrl}/api/mokelay/update_client_block_doc_settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uuid: 'mokelay-editor-MButton',
        editor_enabled: true,
        toolbox_visible: true,
        sort_order: '-1',
      }),
    })
    const body = await response.json() as { ok: boolean, error: { code: string } }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('PROCESSOR_VALIDATION_FAILED')
    expect(queries).toEqual([])
  })

  it('returns an empty update result for an unknown document uuid', async () => {
    affected = 0
    const response = await fetch(`${testServer?.baseUrl}/api/mokelay/update_client_block_doc_settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uuid: 'missing-client-block',
        editor_enabled: true,
        toolbox_visible: false,
        sort_order: '1',
      }),
    })
    const body = await response.json() as { ok: boolean, data: SettingsResponse }

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      data: {
        affected: 0,
        doc: null,
      },
    })
  })
})
