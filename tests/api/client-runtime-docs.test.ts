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

type TestServer = { baseUrl: string, close: () => Promise<void> }

const pgDialect = new PgDialect()
const originalEnv = { ...process.env }
const apiNames = [
  'list_client_action_docs',
  'read_client_action_doc',
  'list_client_processor_docs',
  'read_client_processor_doc',
]

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
    close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  }
}

describe('client Action and Processor documentation APIs', () => {
  let testServer: TestServer | undefined

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      Mokelay_DATABASE_URL: 'postgres://client-runtime-docs-test',
    }
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async (uuid) => {
        if (!apiNames.includes(uuid)) throw new Error(`Unexpected API ${uuid}`)
        return JSON.parse(await readFile(resolve(process.cwd(), `server/assets/mokelay-apis/${uuid}.json`), 'utf8'))
      },
      executeSql: async <T extends Record<string, unknown> = Record<string, unknown>>(
        query: SQL,
        _datasource: string,
        databaseType: DatabaseType,
      ): Promise<SqlExecutionResult<T>> => {
        const built = pgDialect.sqlToQuery(query)
        const sql = built.sql.replace(/\s+/g, ' ').trim()
        if (sql.includes('COUNT')) {
          return { databaseType, rows: [{ count: 1 }] as unknown as T[] }
        }
        return {
          databaseType,
          rows: [{
            id: 1,
            uuid: 'mokelay-editor-action-confirm',
            action_name: 'confirm',
            display_name: '确认提示',
            action_type: 'action',
            processor_name: 'trim',
            category: 'ui',
            source_kind: 'mokelay-editor',
            source_package: 'mokelay-editor',
            source_file: 'submodule/mokelay-editor/src/actions/executors.ts',
            executor_name: 'confirmAction',
            description: '确认提示文档',
            status: 'active',
            input_schema: [],
            param_schema: [],
            output_schema: [],
            error_schema: [],
            config_schema: [],
            node_schema: [],
            runtime_schema: [],
            examples: [],
            source_refs: [],
            raw_meta: {},
          }] as unknown as T[],
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

  it.each([
    ['list_client_action_docs', 'docs_client_action'],
    ['list_client_processor_docs', 'docs_client_processor'],
  ])('lists active client runtime docs from %s', async (apiName, tableName) => {
    const response = await fetch(`${testServer?.baseUrl}/api/mokelay/${apiName}?page=1&pageSize=10&status=active`)
    const body = await response.json() as { ok: boolean, data?: { docs?: unknown[] } }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data?.docs).toHaveLength(1)
    expect(body.data?.docs?.[0]).toEqual(expect.objectContaining({ uuid: expect.any(String) }))
    expect(tableName).toMatch(/^docs_client_/)
  })

  it.each([
    ['read_client_action_doc', 'action_name'],
    ['read_client_processor_doc', 'processor_name'],
  ])('reads a client runtime document by UUID through %s', async (apiName, field) => {
    const response = await fetch(`${testServer?.baseUrl}/api/mokelay/${apiName}?uuid=mokelay-editor-action-confirm`)
    const body = await response.json() as { ok: boolean, data?: { doc?: Record<string, unknown> } }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data?.doc).toEqual(expect.objectContaining({ [field]: expect.any(String) }))
  })
})
