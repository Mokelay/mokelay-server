import { readdir, readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import orchestrationHandler from '../../server/routes/api/mokelay/[apiJsonUuid]'

const apiJsonDir = resolve(process.cwd(), 'server/assets/mokelay-apis')

vi.mock('nitropack/runtime', () => ({
  useStorage: () => ({
    getKeys: async () => (await readdir(apiJsonDir))
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => `mokelay-apis:${fileName}`),
    getItem: async (key: string) => {
      const fileName = key.replace(/^mokelay-apis[:/]/, '')
      return await readFile(resolve(apiJsonDir, fileName), 'utf8')
    },
  }),
}))

let server: Server
let baseUrl: string

beforeAll(async () => {
  const app = createApp()
  const router = createRouter()

  router.use('/api/mokelay/:apiJsonUuid', orchestrationHandler)
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
})
