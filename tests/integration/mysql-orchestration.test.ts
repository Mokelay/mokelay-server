import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, createRouter, toNodeListener, type EventHandler } from 'h3'
import { createPool, type Pool } from 'mysql2/promise'
import { createMokelayOrchestrationHandler } from '../../server/utils/orchestration'

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
}

type MokelaySuccessBody<T> = {
  ok: true
  data: T
}

type MokelayBody<T> = MokelaySuccessBody<T> | {
  ok: false
  error: {
    code: string
    message: string
  }
}

const databaseUrl = process.env.BingX_DATABASE_URL
const mysqlIt = databaseUrl ? it : it.skip

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

async function readMokelayData<T>(response: Response) {
  const body = await response.json() as MokelayBody<T>

  if (!body.ok) {
    throw new Error(JSON.stringify(body.error))
  }

  expect(body.ok).toBe(true)

  return body.data
}

describe('MySQL orchestration integration', () => {
  let pool: Pool | undefined

  afterEach(async () => {
    await pool?.end()
    pool = undefined
  })

  mysqlIt('executes all database blocks against BingX MySQL', async () => {
    const mysqlDatabaseUrl = databaseUrl as string
    const slug = `codex_test_${Date.now()}_${Math.floor(Math.random() * 100000)}`
    const chainId = 900000000 + Math.floor(Math.random() * 10000000)
    pool = createPool({ uri: mysqlDatabaseUrl, connectionLimit: 1 })

    const cleanup = async () => {
      await pool?.execute('DELETE FROM chains WHERE slug = ?', [slug])
    }

    await cleanup()

    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'mysql_bingx_blocks',
        method: 'POST',
        blocks: [
          {
            uuid: 'create_chain',
            functionName: 'create',
            inputs: {
              datasource: 'BingX',
              table: 'chains',
              idField: 'id',
              fields: {
                chain_id: chainId,
                name: 'Codex Test Chain',
                slug,
                native_symbol: 'TST',
              },
            },
            outputs: ['uuid'],
          },
          {
            uuid: 'update_chain',
            functionName: 'update',
            inputs: {
              datasource: 'BingX',
              table: 'chains',
              fields: {
                name: 'Codex Test Chain Updated',
                native_symbol: 'TST2',
              },
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'id',
                fieldValue: { template: "{{blocks['create_chain'].outputs.uuid}}" },
              }],
            },
            outputs: ['affected'],
          },
          {
            uuid: 'read_chain',
            functionName: 'read',
            inputs: {
              datasource: 'BingX',
              table: 'chains',
              fields: ['id', 'chain_id', 'name', 'slug', 'native_symbol'],
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'id',
                fieldValue: { template: "{{blocks['create_chain'].outputs.uuid}}" },
              }],
            },
            outputs: ['data'],
          },
          {
            uuid: 'list_chains',
            functionName: 'list',
            inputs: {
              datasource: 'BingX',
              table: 'chains',
              fields: ['id', 'slug'],
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'slug',
                fieldValue: slug,
              }],
            },
            outputs: ['datas'],
          },
          {
            uuid: 'count_chains',
            functionName: 'count',
            inputs: {
              datasource: 'BingX',
              table: 'chains',
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'slug',
                fieldValue: slug,
              }],
            },
            outputs: ['total'],
          },
          {
            uuid: 'page_chains',
            functionName: 'page',
            inputs: {
              datasource: 'BingX',
              table: 'chains',
              fields: ['id', 'slug'],
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'slug',
                fieldValue: slug,
              }],
              page: 1,
              pageSize: 1,
            },
            outputs: ['datas', 'total', 'page', 'pageSize', 'hasNextPage'],
          },
          {
            uuid: 'delete_chain',
            functionName: 'delete',
            inputs: {
              datasource: 'BingX',
              table: 'chains',
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'id',
                fieldValue: { template: "{{blocks['create_chain'].outputs.uuid}}" },
              }],
            },
            outputs: ['affected'],
          },
          {
            uuid: 'final_count',
            functionName: 'count',
            inputs: {
              datasource: 'BingX',
              table: 'chains',
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'slug',
                fieldValue: slug,
              }],
            },
            outputs: ['total'],
          },
        ],
        response: {
          id: { template: "{{blocks['create_chain'].outputs.uuid}}" },
          read: { template: "{{blocks['read_chain'].outputs.data}}" },
          listed: { template: "{{blocks['list_chains'].outputs.datas}}" },
          total: { template: "{{blocks['count_chains'].outputs.total}}" },
          pageTotal: { template: "{{blocks['page_chains'].outputs.total}}" },
          updateAffected: { template: "{{blocks['update_chain'].outputs.affected}}" },
          deleteAffected: { template: "{{blocks['delete_chain'].outputs.affected}}" },
          finalTotal: { template: "{{blocks['final_count'].outputs.total}}" },
        },
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/mysql_bingx_blocks`, { method: 'POST' })
      const body = await readMokelayData<Record<string, unknown>>(response)

      expect(response.status).toBe(200)
      expect(body).toMatchObject({
        total: 1,
        pageTotal: 1,
        updateAffected: 1,
        deleteAffected: 1,
        finalTotal: 0,
      })
      expect(body.read).toMatchObject({
        chain_id: chainId,
        name: 'Codex Test Chain Updated',
        slug,
        native_symbol: 'TST2',
      })
      expect(body.listed).toEqual([expect.objectContaining({ slug })])
    } finally {
      await server.close()
      await cleanup()
    }
  })
})
