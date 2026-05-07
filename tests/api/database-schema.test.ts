import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import databaseSchemaHandler from '../../server/routes/api/database/schema.get'
import { listDatabaseSchema } from '../../server/utils/database-schema'

vi.mock('../../server/utils/database-schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/database-schema')>()

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
        name: 'users',
        columns: [
          { name: 'id', type: 'uuid' },
          { name: 'email', type: 'character varying(255)' },
        ],
      },
      {
        name: 'pages',
        columns: [
          { name: 'uuid', type: 'uuid' },
          { name: 'blocks', type: 'jsonb' },
        ],
      },
    ])

    const response = await fetch(`${testServer.baseUrl}/api/database/schema`)
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'uuid' },
            { name: 'email', type: 'character varying(255)' },
          ],
        },
        {
          name: 'pages',
          columns: [
            { name: 'uuid', type: 'uuid' },
            { name: 'blocks', type: 'jsonb' },
          ],
        },
      ],
    })
    expect(mockedListDatabaseSchema).toHaveBeenCalledTimes(1)
  })
})
