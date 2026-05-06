import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, createRouter, toNodeListener } from 'h3'
import corsMiddleware from '../../server/middleware/cors'
import listPageHandler from '../../server/routes/api/pages/index.get'
import createPageHandler from '../../server/routes/api/pages/index.post'
import readPageHandler from '../../server/routes/api/pages/[uuid].get'
import updatePageHandler from '../../server/routes/api/pages/[uuid].patch'
import { clearMemoryPages } from '../../server/utils/page-store'

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
}

type PublicPage = {
  uuid: string
  name: string
  blocks: unknown[]
  createdAt: string
  updatedAt: string
}

type PageResponse = {
  page: PublicPage
}

type PageListResponse = {
  pages: PublicPage[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasPreviousPage: boolean
    hasNextPage: boolean
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const missingPageUuid = '00000000-0000-4000-8000-000000000000'

async function startServer(): Promise<TestServer> {
  const app = createApp()
  const router = createRouter()

  router.post('/api/pages', createPageHandler)
  router.get('/api/pages', listPageHandler)
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

async function readPageListResponse(response: Response) {
  return await response.json() as PageListResponse
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

  it('lists pages with default pagination and full page payloads', async () => {
    const firstResponse = await createPage(testServer.baseUrl, {
      name: 'First Page',
      blocks: [{ type: 'text', value: 'First' }],
    })
    const first = await readPageResponse(firstResponse)

    const secondResponse = await createPage(testServer.baseUrl, {
      name: 'Second Page',
      blocks: [{ type: 'hero', title: 'Second' }],
    })
    const second = await readPageResponse(secondResponse)

    const response = await fetch(`${testServer.baseUrl}/api/pages`)
    const body = await readPageListResponse(response)

    expect(response.status).toBe(200)
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    })
    expect(body.pages).toHaveLength(2)
    expect(body.pages).toEqual(expect.arrayContaining([first.page, second.page]))
  })

  it('lists pages by updated time descending', async () => {
    const firstResponse = await createPage(testServer.baseUrl, {
      name: 'Older Page',
      blocks: [{ type: 'text', value: 'Older' }],
    })
    const first = await readPageResponse(firstResponse)

    const secondResponse = await createPage(testServer.baseUrl, {
      name: 'Newer Page',
      blocks: [{ type: 'text', value: 'Newer' }],
    })
    const second = await readPageResponse(secondResponse)

    await fetch(`${testServer.baseUrl}/api/pages/${first.page.uuid}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        blocks: [{ type: 'text', value: 'Updated first' }],
      }),
    })

    const response = await fetch(`${testServer.baseUrl}/api/pages`)
    const body = await readPageListResponse(response)

    expect(response.status).toBe(200)
    expect(body.pages.map((page) => page.uuid)).toEqual([first.page.uuid, second.page.uuid])
  })

  it('lists the requested page with pagination metadata', async () => {
    await createPage(testServer.baseUrl, { name: 'Page One', blocks: [] })
    await createPage(testServer.baseUrl, { name: 'Page Two', blocks: [] })
    await createPage(testServer.baseUrl, { name: 'Page Three', blocks: [] })

    const response = await fetch(`${testServer.baseUrl}/api/pages?page=2&pageSize=2`)
    const body = await readPageListResponse(response)

    expect(response.status).toBe(200)
    expect(body.pages).toHaveLength(1)
    expect(body.pages[0]?.uuid).toMatch(uuidPattern)
    expect(body.pagination).toEqual({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false,
    })
  })

  it('returns an empty page list when the requested page is beyond the last page', async () => {
    await createPage(testServer.baseUrl, { name: 'Page One', blocks: [] })
    await createPage(testServer.baseUrl, { name: 'Page Two', blocks: [] })

    const response = await fetch(`${testServer.baseUrl}/api/pages?page=3&pageSize=1`)
    const body = await readPageListResponse(response)

    expect(response.status).toBe(200)
    expect(body.pages).toEqual([])
    expect(body.pagination).toEqual({
      page: 3,
      pageSize: 1,
      total: 2,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false,
    })
  })

  it('rejects invalid page list pagination query parameters', async () => {
    const invalidQueries = [
      'page=0',
      'page=abc',
      'page=1.5',
      'pageSize=0',
      'pageSize=abc',
      'pageSize=101',
    ]

    for (const query of invalidQueries) {
      const response = await fetch(`${testServer.baseUrl}/api/pages?${query}`)

      expect(response.status).toBe(400)
    }
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
