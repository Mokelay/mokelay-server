import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, createRouter, toNodeListener } from 'h3'
import corsMiddleware from '../../server/middleware/cors'
import createPageHandler from '../../server/routes/api/pages/index.post'
import readPageHandler from '../../server/routes/api/pages/[uuid].get'
import updatePageHandler from '../../server/routes/api/pages/[uuid].patch'
import { clearMemoryPages } from '../../server/utils/page-store'

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
}

type PageResponse = {
  page: {
    uuid: string
    name: string
    blocks: unknown[]
    createdAt: string
    updatedAt: string
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const missingPageUuid = '00000000-0000-4000-8000-000000000000'

async function startServer(): Promise<TestServer> {
  const app = createApp()
  const router = createRouter()

  router.post('/api/pages', createPageHandler)
  router.get('/api/pages/:uuid', readPageHandler)
  router.patch('/api/pages/:uuid', updatePageHandler)

  app.use(corsMiddleware)
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

async function readPageResponse(response: Response) {
  return await response.json() as PageResponse
}

async function createPage(baseUrl: string, body: Record<string, unknown>) {
  return await fetch(`${baseUrl}/api/pages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('pages API', () => {
  let testServer: TestServer
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: '',
      NODE_ENV: 'test',
    }
    clearMemoryPages()
    testServer = await startServer()
  })

  afterEach(async () => {
    await testServer.close()
    clearMemoryPages()
    process.env = { ...originalEnv }
  })

  it('creates a page with blocks and returns page metadata', async () => {
    const response = await createPage(testServer.baseUrl, {
      name: 'Home Page',
      blocks: [{ type: 'hero', title: 'Welcome' }],
    })
    const body = await readPageResponse(response)

    expect(response.status).toBe(201)
    expect(body.page.uuid).toMatch(uuidPattern)
    expect(body.page).toMatchObject({
      name: 'Home Page',
      blocks: [{ type: 'hero', title: 'Welcome' }],
    })
    expect(Date.parse(body.page.createdAt)).not.toBeNaN()
    expect(Date.parse(body.page.updatedAt)).not.toBeNaN()
  })

  it('defaults missing blocks to an empty array when creating a page', async () => {
    const response = await createPage(testServer.baseUrl, {
      name: 'Blank Page',
    })
    const body = await readPageResponse(response)

    expect(response.status).toBe(201)
    expect(body.page.blocks).toEqual([])
  })

  it('reads a page by UUID', async () => {
    const createResponse = await createPage(testServer.baseUrl, {
      name: 'Readable Page',
      blocks: [{ type: 'text', value: 'Hello' }],
    })
    const created = await readPageResponse(createResponse)

    const readResponse = await fetch(`${testServer.baseUrl}/api/pages/${created.page.uuid}`)
    const read = await readPageResponse(readResponse)

    expect(readResponse.status).toBe(200)
    expect(read.page).toEqual(created.page)
  })

  it('updates page blocks by UUID and preserves the page name', async () => {
    const createResponse = await createPage(testServer.baseUrl, {
      name: 'Editable Page',
      blocks: [{ type: 'hero' }],
    })
    const created = await readPageResponse(createResponse)

    const updateResponse = await fetch(`${testServer.baseUrl}/api/pages/${created.page.uuid}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        blocks: [{ type: 'text', value: 'Updated' }],
      }),
    })
    const updated = await readPageResponse(updateResponse)

    expect(updateResponse.status).toBe(200)
    expect(updated.page.uuid).toBe(created.page.uuid)
    expect(updated.page.name).toBe('Editable Page')
    expect(updated.page.blocks).toEqual([{ type: 'text', value: 'Updated' }])
    expect(Date.parse(updated.page.updatedAt)).toBeGreaterThan(Date.parse(created.page.updatedAt))

    const readResponse = await fetch(`${testServer.baseUrl}/api/pages/${created.page.uuid}`)
    const read = await readPageResponse(readResponse)

    expect(read.page).toEqual(updated.page)
  })

  it('rejects invalid page creation payloads', async () => {
    expect((await createPage(testServer.baseUrl, {
      name: '',
      blocks: [],
    })).status).toBe(400)

    expect((await createPage(testServer.baseUrl, {
      name: 'Invalid Blocks',
      blocks: { type: 'hero' },
    })).status).toBe(400)
  })

  it('rejects invalid UUIDs when reading or updating pages', async () => {
    expect((await fetch(`${testServer.baseUrl}/api/pages/not-a-uuid`)).status).toBe(400)

    expect((await fetch(`${testServer.baseUrl}/api/pages/not-a-uuid`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blocks: [] }),
    })).status).toBe(400)
  })

  it('returns 404 when reading or updating a missing page', async () => {
    expect((await fetch(`${testServer.baseUrl}/api/pages/${missingPageUuid}`)).status).toBe(404)

    expect((await fetch(`${testServer.baseUrl}/api/pages/${missingPageUuid}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blocks: [] }),
    })).status).toBe(404)
  })

  it('allows CORS preflight requests from the production editor', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/pages/${missingPageUuid}`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://editor.mokelay.com',
        'access-control-request-method': 'PATCH',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://editor.mokelay.com')
    expect(response.headers.get('access-control-allow-methods')).toContain('PATCH')
  })
})
