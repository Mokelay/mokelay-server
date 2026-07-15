import { readdir, readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMokelayOrchestrationHandler } from 'mokelay-server-core/utils/orchestration'
import { serverBlockDefinitions } from '../../server/utils/blocks'

const apiJsonDir = resolve(process.cwd(), 'server/assets/mokelay-apis')
const fragmentJsonDir = resolve(apiJsonDir, 'fragment')
const pageJsonDir = resolve(process.cwd(), 'server/assets/mokelay-pages')
const layoutJsonDir = resolve(process.cwd(), 'server/assets/mokelay-layouts')

vi.mock('nitropack/runtime', () => ({
  useStorage: () => ({
    getKeys: async (base?: string) => {
      const dir = base === 'mokelay-pages'
        ? pageJsonDir
        : base === 'mokelay-layouts'
          ? layoutJsonDir
          : base === 'mokelay-apis/fragment'
            ? fragmentJsonDir
            : apiJsonDir
      const keyBase = base === 'mokelay-pages'
        ? 'mokelay-pages'
        : base === 'mokelay-layouts'
          ? 'mokelay-layouts'
          : base === 'mokelay-apis/fragment'
            ? 'mokelay-apis:fragment'
            : 'mokelay-apis'
      return (await readdir(dir))
        .filter((fileName) => fileName.endsWith('.json'))
        .map((fileName) => `${keyBase}:${fileName}`)
    },
    getItem: async (key: string) => {
      if (key.startsWith('mokelay-pages')) {
        const fileName = key.replace(/^mokelay-pages[:/]/, '')
        return await readFile(resolve(pageJsonDir, fileName), 'utf8')
      }

      if (key.startsWith('mokelay-layouts')) {
        const fileName = key.replace(/^mokelay-layouts[:/]/, '')
        return await readFile(resolve(layoutJsonDir, fileName), 'utf8')
      }

      const fileName = key.replaceAll(':', '/').replace(/^mokelay-apis\//, '')
      return await readFile(resolve(apiJsonDir, fileName), 'utf8')
    },
  }),
}))

let server: Server
let baseUrl: string
const originalDatabaseUrl = process.env.Mokelay_DATABASE_URL

beforeAll(async () => {
  const app = createApp()
  const router = createRouter()

  process.env.Mokelay_DATABASE_URL = 'postgres://unit-test'
  const handler = createMokelayOrchestrationHandler({
    blockDefinitions: serverBlockDefinitions,
    executeSql: async () => ({ databaseType: 'postgres', rows: [] }),
  })
  router.use('/api/mokelay/:apiJsonUuid', handler)
  app.use(router)

  server = createServer(toNodeListener(app))
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))

  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()))
  })
  if (originalDatabaseUrl === undefined) delete process.env.Mokelay_DATABASE_URL
  else process.env.Mokelay_DATABASE_URL = originalDatabaseUrl
})

describe('GET /api/mokelay/list_mokelay_api_jsons', () => {
  it('returns every built-in API DSL including itself in file-name order', async () => {
    const expectedFileNames = (await readdir(apiJsonDir))
      .filter((fileName) => fileName.endsWith('.json'))
      .sort()
    const response = await fetch(`${baseUrl}/api/mokelay/list_mokelay_api_jsons`)
    const body = await response.json() as {
      ok: boolean
      data: {
        apis: Array<{ uuid: string }>
        count: number
      }
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.count).toBe(expectedFileNames.length)
    expect(body.data.apis.map((api) => `${api.uuid}.json`)).toEqual(expectedFileNames)
    expect(body.data.apis.some((api) => api.uuid === 'list_mokelay_api_jsons')).toBe(true)
  })

  it('returns only nested built-in Fragments when fragment=true', async () => {
    const expectedFileNames = (await readdir(fragmentJsonDir))
      .filter((fileName) => fileName.endsWith('.json'))
      .sort()
    const response = await fetch(`${baseUrl}/api/mokelay/list_mokelay_api_jsons?fragment=true`)
    const body = await response.json() as {
      ok: boolean
      data: {
        apis: Array<{ uuid: string, fragment: boolean }>
        count: number
      }
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.count).toBe(expectedFileNames.length)
    expect(body.data.apis.map(api => `${api.uuid}.json`)).toEqual(expectedFileNames)
    expect(body.data.apis.every(api => api.fragment === true)).toBe(true)
  })
})

describe('GET /api/mokelay/read_mokelay_api_json', () => {
  it('returns one built-in API DSL by UUID', async () => {
    const response = await fetch(`${baseUrl}/api/mokelay/read_mokelay_api_json?uuid=list_apis`)
    const body = await response.json() as {
      ok: boolean
      data: {
        api: { uuid: string, alias: string, method: string }
      }
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.api).toMatchObject({
      uuid: 'list_apis',
      alias: 'API 列表接口',
      method: 'GET',
    })
  })

  it('returns one nested built-in Fragment only with the fragment selector', async () => {
    const response = await fetch(`${baseUrl}/api/mokelay/read_mokelay_api_json?uuid=provision_new_user&fragment=true`)
    const body = await response.json() as {
      ok: boolean
      data: {
        api: { uuid: string, fragment: boolean, params: string[] }
      }
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.api).toMatchObject({
      uuid: 'provision_new_user',
      fragment: true,
      params: ['enterprise_name', 'name', 'email', 'password_hash'],
    })
  })

  it('returns not found for an unknown built-in API UUID', async () => {
    const response = await fetch(`${baseUrl}/api/mokelay/read_mokelay_api_json?uuid=missing_api`)
    const body = await response.json() as {
      ok: boolean
      error: { code: string }
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('API_JSON_NOT_FOUND')
  })
})

describe('GET /api/mokelay/list_mokelay_page_jsons', () => {
  it('returns every built-in page DSL in file-name order', async () => {
    const expectedFileNames = (await readdir(pageJsonDir))
      .filter((fileName) => fileName.endsWith('.json'))
      .sort()
    const response = await fetch(`${baseUrl}/api/mokelay/list_mokelay_page_jsons`)
    const body = await response.json() as {
      ok: boolean
      data: {
        pages: Array<{ uuid: string }>
        count: number
      }
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.count).toBe(expectedFileNames.length)
    expect(body.data.pages.map((page) => `${page.uuid}.json`)).toEqual(expectedFileNames)
  })
})

describe('GET /api/mokelay/read_mokelay_page_json', () => {
  it('returns one built-in page DSL by UUID', async () => {
    const response = await fetch(`${baseUrl}/api/mokelay/read_mokelay_page_json?uuid=mokelay_list_page`)
    const body = await response.json() as {
      ok: boolean
      data: {
        page: { uuid: string, name: string, blocks: unknown[] }
      }
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.page).toMatchObject({
      uuid: 'mokelay_list_page',
      name: '页面列表',
    })
    expect(body.data.page.blocks.length).toBeGreaterThan(0)
  })

  it('returns the built-in create page DSL by UUID', async () => {
    const response = await fetch(`${baseUrl}/api/mokelay/read_mokelay_page_json?uuid=mokelay_create_page`)
    const body = await response.json() as {
      ok: boolean
      data: {
        page: { uuid: string, name: string, blocks: Array<{ type: string }> }
      }
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.page).toMatchObject({
      uuid: 'mokelay_create_page',
      name: '创建页面',
    })
    expect(body.data.page.blocks.map((block) => block.type)).toEqual(['MForm', 'MButton'])
  })

  it('returns not found for an unknown built-in page UUID', async () => {
    const response = await fetch(`${baseUrl}/api/mokelay/read_mokelay_page_json?uuid=missing_page`)
    const body = await response.json() as {
      ok: boolean
      error: { code: string }
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('API_JSON_NOT_FOUND')
  })
})

describe('GET /api/mokelay/list_mokelay_layout_jsons', () => {
  it('returns every built-in layout DSL in file-name order', async () => {
    const expectedFileNames = (await readdir(layoutJsonDir))
      .filter((fileName) => fileName.endsWith('.json'))
      .sort()
    const response = await fetch(`${baseUrl}/api/mokelay/list_mokelay_layout_jsons`)
    const body = await response.json() as {
      ok: boolean
      data: {
        layouts: Array<{ uuid: string, layoutJson: { uuid: string } }>
        count: number
      }
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.count).toBe(expectedFileNames.length)
    expect(body.data.layouts.map((layout) => `${layout.uuid}.json`)).toEqual(expectedFileNames)
    expect(body.data.layouts.every((layout) => layout.layoutJson.uuid === layout.uuid)).toBe(true)
  })
})

describe('GET /api/mokelay/read_mokelay_layout_json', () => {
  it('returns one built-in layout DSL by UUID', async () => {
    const response = await fetch(`${baseUrl}/api/mokelay/read_mokelay_layout_json?uuid=mokelay_layout`)
    const body = await response.json() as {
      ok: boolean
      data: {
        layout: { uuid: string, name: string, layoutJson: { blocks: unknown[] } }
      }
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.layout).toMatchObject({
      uuid: 'mokelay_layout',
      name: 'Mokelay编辑器布局',
    })
    expect(body.data.layout.layoutJson.blocks.length).toBeGreaterThan(0)
  })

  it('returns not found for an unknown built-in layout UUID', async () => {
    const response = await fetch(`${baseUrl}/api/mokelay/read_mokelay_layout_json?uuid=missing_layout`)
    const body = await response.json() as {
      ok: boolean
      error: { code: string }
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('API_JSON_NOT_FOUND')
  })
})
