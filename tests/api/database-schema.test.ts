import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import databaseSchemaHandler from '../../server/routes/api/database/schema.get'
import { listDatabaseSchema } from 'mokelay-server-core/utils/database-schema'

vi.mock('mokelay-server-core/utils/database-schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mokelay-server-core/utils/database-schema')>()

  return {
    ...actual,
    listDatabaseSchema: vi.fn(),
  }
})

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
}

const mockedListDatabaseSchema = vi.mocked(listDatabaseSchema)

async function startServer(): Promise<TestServer> {
  const app = createApp()

  app.use('/api/database/schema', databaseSchemaHandler)

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

async function readJson(response: Response) {
  return await response.json() as Record<string, unknown>
}

describe('database schema API', () => {
  let testServer: TestServer

  beforeEach(async () => {
    mockedListDatabaseSchema.mockReset()
    testServer = await startServer()
  })

  afterEach(async () => {
    await testServer.close()
  })

  it('returns database tables with their columns', async () => {
    mockedListDatabaseSchema.mockResolvedValueOnce([
      {
        name: 'apis',
        columns: [
          { name: 'uuid', type: 'character varying(128)', dataType: 'character varying(128)' },
          { name: 'api_json', type: 'jsonb', dataType: 'jsonb' },
          { name: 'layout', type: 'jsonb', dataType: 'jsonb' },
        ],
      },
      {
        name: 'apis_snapshot',
        columns: [
          { name: 'id', type: 'uuid', dataType: 'uuid' },
          { name: 'api_uuid', type: 'character varying(128)', dataType: 'character varying(128)' },
          { name: 'api_json', type: 'jsonb', dataType: 'jsonb' },
        ],
      },
      {
        name: 'users',
        columns: [
          { name: 'id', type: 'uuid', dataType: 'uuid' },
          { name: 'email', type: 'character varying(255)', dataType: 'character varying(255)' },
        ],
      },
      {
        name: 'pages',
        columns: [
          { name: 'uuid', type: 'uuid', dataType: 'uuid' },
          { name: 'blocks', type: 'jsonb', dataType: 'jsonb' },
        ],
      },
    ])

    const response = await fetch(`${testServer.baseUrl}/api/database/schema`)
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({
      tables: [
        {
          name: 'apis',
          columns: [
            { name: 'uuid', type: 'character varying(128)', dataType: 'character varying(128)' },
            { name: 'api_json', type: 'jsonb', dataType: 'jsonb' },
            { name: 'layout', type: 'jsonb', dataType: 'jsonb' },
          ],
        },
        {
          name: 'apis_snapshot',
          columns: [
            { name: 'id', type: 'uuid', dataType: 'uuid' },
            { name: 'api_uuid', type: 'character varying(128)', dataType: 'character varying(128)' },
            { name: 'api_json', type: 'jsonb', dataType: 'jsonb' },
          ],
        },
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'uuid', dataType: 'uuid' },
            { name: 'email', type: 'character varying(255)', dataType: 'character varying(255)' },
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
    })
    expect(mockedListDatabaseSchema).toHaveBeenCalledTimes(1)
  })
})
