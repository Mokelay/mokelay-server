import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, toNodeListener, type EventHandler } from 'h3'

const r2EnvKeys = [
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_ENDPOINT',
  'MOKELAY_APIS_R2_BUCKET',
  'MOKELAY_APIS_R2_PREFIX',
]
const originalR2Env = new Map(r2EnvKeys.map((key) => [key, process.env[key]]))

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
}

function restoreR2Env() {
  for (const key of r2EnvKeys) {
    const value = originalR2Env.get(key)

    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function clearR2Env() {
  for (const key of r2EnvKeys) {
    delete process.env[key]
  }
}

async function startServer(handler: EventHandler): Promise<TestServer> {
  const app = createApp()
  const router = createRouter()

  router.use('/api/mokelay/:apiJsonUuid', handler)
  app.use(router)

  const server = createServer(toNodeListener(app))

  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen)
  })

  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
  }
}

async function closeServer(server: Server) {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()))
  })
}

async function readJson<T>(response: Response) {
  return await response.json() as T
}

async function readApiJsonAsset(apiJsonUuid: string) {
  return JSON.parse(await readFile(resolve(process.cwd(), `server/assets/mokelay-apis/${apiJsonUuid}.json`), 'utf8')) as unknown
}

function configureR2Env() {
  process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'account-id'
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'access-key-id'
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-access-key'
  process.env.MOKELAY_APIS_R2_BUCKET = 'mokelay-json'
}

describe('loadApiJson', () => {
  afterEach(() => {
    vi.doUnmock('nitropack/runtime')
    vi.doUnmock('@aws-sdk/client-s3')
    vi.resetModules()
    restoreR2Env()
  })

  it('uses parsed objects returned by Nitro server assets', async () => {
    const apiJson = {
      uuid: 'from_nitro_assets',
      method: 'POST',
      blocks: [],
      response: null,
    }

    vi.doMock('nitropack/runtime', () => ({
      useStorage: (base: string) => ({
        getItem: async (key: string) => {
          expect(base).toBe('assets:server')
          expect(key).toBe('mokelay-apis/from_nitro_assets.json')

          return apiJson
        },
      }),
    }))

    const { loadApiJson } = await import('../../server/utils/orchestration')

    await expect(loadApiJson('from_nitro_assets')).resolves.toEqual(apiJson)
  })

  it('falls back to local files when R2 is not configured and Nitro assets are unavailable', async () => {
    vi.doMock('nitropack/runtime', () => ({
      useStorage: () => ({
        getItem: async () => undefined,
      }),
    }))

    const { loadApiJson } = await import('../../server/utils/orchestration')

    await expect(loadApiJson('login')).resolves.toMatchObject({
      uuid: 'login',
      method: 'POST',
    })
  })

  it('loads API JSON from Cloudflare R2 before Nitro assets', async () => {
    const apiJson = {
      uuid: 'login',
      method: 'POST',
      blocks: [],
      response: null,
    }
    const sentCommands: Array<{ input: unknown }> = []

    process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'account-id'
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'access-key-id'
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-access-key'
    process.env.MOKELAY_APIS_R2_BUCKET = 'mokelay-api-json'

    vi.doMock('@aws-sdk/client-s3', () => ({
      GetObjectCommand: class {
        input: unknown

        constructor(input: unknown) {
          this.input = input
        }
      },
      PutObjectCommand: class {
        constructor(readonly input: unknown) {}
      },
      S3Client: class {
        send = async (command: { input: unknown }) => {
          sentCommands.push(command)

          return {
            Body: {
              transformToString: async () => JSON.stringify(apiJson),
            },
          }
        }
      },
    }))
    vi.doMock('nitropack/runtime', () => ({
      useStorage: () => ({
        getItem: async () => {
          throw new Error('Nitro assets should not be read')
        },
      }),
    }))

    const { loadApiJson } = await import('../../server/utils/orchestration')

    await expect(loadApiJson('login')).resolves.toEqual(apiJson)
    expect(sentCommands).toHaveLength(1)
    expect(sentCommands[0]?.input).toMatchObject({
      Bucket: 'mokelay-api-json',
      Key: 'mokelay-apis/login.json',
    })
  })

  it('falls back to Nitro assets when Cloudflare R2 read fails', async () => {
    const apiJson = {
      uuid: 'from_nitro_assets',
      method: 'GET',
      blocks: [],
      response: null,
    }

    process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'account-id'
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'access-key-id'
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-access-key'
    process.env.MOKELAY_APIS_R2_BUCKET = 'mokelay-api-json'

    vi.doMock('@aws-sdk/client-s3', () => ({
      GetObjectCommand: class {
        constructor(readonly input: unknown) {}
      },
      PutObjectCommand: class {
        constructor(readonly input: unknown) {}
      },
      S3Client: class {
        send = async () => {
          throw new Error('NoSuchKey')
        }
      },
    }))
    vi.doMock('nitropack/runtime', () => ({
      useStorage: () => ({
        getItem: async () => apiJson,
      }),
    }))

    const { loadApiJson } = await import('../../server/utils/orchestration')

    await expect(loadApiJson('from_nitro_assets')).resolves.toEqual(apiJson)
  })

  it('rejects invalid JSON returned by Cloudflare R2', async () => {
    process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'account-id'
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'access-key-id'
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-access-key'
    process.env.MOKELAY_APIS_R2_BUCKET = 'mokelay-api-json'

    vi.doMock('@aws-sdk/client-s3', () => ({
      GetObjectCommand: class {
        constructor(readonly input: unknown) {}
      },
      PutObjectCommand: class {
        constructor(readonly input: unknown) {}
      },
      S3Client: class {
        send = async () => ({
          Body: {
            transformToString: async () => '{not-json',
          },
        })
      },
    }))

    const { loadApiJson } = await import('../../server/utils/orchestration')

    try {
      await loadApiJson('login')
      throw new Error('Expected loadApiJson to reject')
    } catch (error) {
      expect(error).toMatchObject({
        data: {
          code: 'API_JSON_INVALID_JSON',
        },
      })
    }
  })
})

function mockR2Put(sentInputs: Array<Record<string, unknown>>, response: Record<string, unknown> = { ETag: '"unit-etag"' }) {
  vi.doMock('@aws-sdk/client-s3', () => ({
    GetObjectCommand: class {
      constructor(readonly input: unknown) {}
    },
    PutObjectCommand: class {
      constructor(readonly input: unknown) {}
    },
    S3Client: class {
      send = async (command: { input: Record<string, unknown> }) => {
        sentInputs.push(command.input)

        return response
      }
    },
  }))
}

function mockR2PutFailure() {
  vi.doMock('@aws-sdk/client-s3', () => ({
    GetObjectCommand: class {
      constructor(readonly input: unknown) {}
    },
    PutObjectCommand: class {
      constructor(readonly input: unknown) {}
    },
    S3Client: class {
      send = async () => {
        throw new Error('R2 unavailable')
      }
    },
  }))
}

describe('saveJsonToR2 block', () => {
  afterEach(() => {
    vi.doUnmock('@aws-sdk/client-s3')
    vi.resetModules()
    restoreR2Env()
  })

  it('saves JSON data from the DSL to Cloudflare R2 with the requested file name', async () => {
    const sentInputs: Array<Record<string, unknown>> = []

    configureR2Env()
    mockR2Put(sentInputs)

    const { createMokelayOrchestrationHandler } = await import('../../server/utils/orchestration')
    const server = await startServer(createMokelayOrchestrationHandler({
      loadApiJson: readApiJsonAsset,
    }))

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/save_json_to_r2`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          directory: '/user-json/forms/',
          fileName: 'payload.json',
          data: { name: 'Mokelay', enabled: true },
        }),
      })
      const body = await readJson<{
        ok: true
        data: {
          key: string
          directory: string
          fileName: string
          bucket: string
          size: number
          etag: string
        }
      }>(response)

      expect(body.ok).toBe(true)
      expect(body.data.directory).toBe('user-json/forms')
      expect(body.data.fileName).toBe('payload.json')
      expect(body.data.key).toBe('user-json/forms/payload.json')
      expect(body.data.bucket).toBe('mokelay-json')
      expect(body.data.etag).toBe('"unit-etag"')
      expect(sentInputs).toEqual([{
        Bucket: 'mokelay-json',
        Key: body.data.key,
        Body: '{\n  "name": "Mokelay",\n  "enabled": true\n}\n',
        ContentType: 'application/json; charset=utf-8',
      }])
      expect(body.data.size).toBe(Buffer.byteLength(sentInputs[0]?.Body as string, 'utf8'))
    } finally {
      await server.close()
    }
  })

  it('parses JSON strings before saving them to R2', async () => {
    const sentInputs: Array<Record<string, unknown>> = []

    configureR2Env()
    mockR2Put(sentInputs, { ETag: undefined })

    const { createMokelayOrchestrationHandler } = await import('../../server/utils/orchestration')
    const server = await startServer(createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'save_json_string',
        method: 'POST',
        request: { body: ['data'] },
        blocks: [{
          uuid: 'save',
          functionName: 'saveJsonToR2',
          inputs: {
            directory: 'snapshots',
            fileName: 'payload.json',
            data: { template: '{{request.body.data}}' },
          },
          outputs: ['key', 'etag'],
        }],
        response: {
          key: { template: "{{blocks['save'].outputs.key}}" },
          etag: { template: "{{blocks['save'].outputs.etag}}" },
        },
      }),
    }))

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/save_json_string`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: '{"hello":"world"}',
        }),
      })
      const body = await readJson<{
        ok: true
        data: {
          key: string
          etag: null
        }
      }>(response)

      expect(body.ok).toBe(true)
      expect(body.data).toEqual({
        key: 'snapshots/payload.json',
        etag: null,
      })
      expect(sentInputs[0]).toMatchObject({
        Bucket: 'mokelay-json',
        Key: 'snapshots/payload.json',
        Body: '{\n  "hello": "world"\n}\n',
        ContentType: 'application/json; charset=utf-8',
      })
    } finally {
      await server.close()
    }
  })

  it('returns block errors for invalid JSON strings and missing R2 config', async () => {
    clearR2Env()

    const { createMokelayOrchestrationHandler } = await import('../../server/utils/orchestration')
    const server = await startServer(createMokelayOrchestrationHandler({
      loadApiJson: readApiJsonAsset,
    }))

    try {
      const invalidJsonResponse = await fetch(`${server.baseUrl}/api/mokelay/save_json_to_r2`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          directory: 'user-json/forms',
          fileName: 'invalid-json.json',
          data: '{not-json',
        }),
      })
      const invalidJsonBody = await readJson<{
        ok: false
        error: { code: string, message: string }
      }>(invalidJsonResponse)

      expect(invalidJsonBody).toMatchObject({
        ok: false,
        error: {
          code: 'BLOCK_R2_JSON_INVALID',
          message: 'data 不是合法 JSON 字符串。',
        },
      })

      const missingConfigResponse = await fetch(`${server.baseUrl}/api/mokelay/save_json_to_r2`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          directory: 'user-json/forms',
          fileName: 'missing-config.json',
          data: { ok: true },
        }),
      })
      const missingConfigBody = await readJson<{
        ok: false
        error: { code: string, message: string }
      }>(missingConfigResponse)

      expect(missingConfigBody).toMatchObject({
        ok: false,
        error: {
          code: 'BLOCK_R2_CONFIG_MISSING',
          message: 'Cloudflare R2 配置缺失。',
        },
      })
    } finally {
      await server.close()
    }
  })

  it('rejects invalid R2 directories and file names', async () => {
    const { createMokelayOrchestrationHandler } = await import('../../server/utils/orchestration')
    const missingFileNameServer = await startServer(createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'missing_r2_file_name',
        method: 'POST',
        blocks: [{
          uuid: 'save',
          functionName: 'saveJsonToR2',
          inputs: {
            directory: 'user-json/forms',
            data: { ok: true },
          },
        }],
        response: { ok: true },
      }),
    }))

    try {
      const response = await fetch(`${missingFileNameServer.baseUrl}/api/mokelay/missing_r2_file_name`, { method: 'POST' })
      const body = await readJson<{
        ok: false
        error: { code: string, message: string }
      }>(response)

      expect(body).toMatchObject({
        ok: false,
        error: {
          code: 'BLOCK_R2_FILE_NAME_INVALID',
          message: 'fileName 必须是非空字符串。',
        },
      })
    } finally {
      await missingFileNameServer.close()
    }

    const invalidDirectoryServer = await startServer(createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'invalid_r2_directory',
        method: 'POST',
        blocks: [{
          uuid: 'save',
          functionName: 'saveJsonToR2',
          inputs: {
            directory: 'user-json//forms',
            fileName: 'payload.json',
            data: { ok: true },
          },
        }],
        response: { ok: true },
      }),
    }))

    try {
      const response = await fetch(`${invalidDirectoryServer.baseUrl}/api/mokelay/invalid_r2_directory`, { method: 'POST' })
      const body = await readJson<{
        ok: false
        error: { code: string, message: string }
      }>(response)

      expect(body).toMatchObject({
        ok: false,
        error: {
          code: 'BLOCK_R2_DIRECTORY_INVALID',
          message: 'directory 不是合法 R2 目录。',
        },
      })
    } finally {
      await invalidDirectoryServer.close()
    }

    const invalidFileNameServer = await startServer(createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'invalid_r2_file_name',
        method: 'POST',
        blocks: [{
          uuid: 'save',
          functionName: 'saveJsonToR2',
          inputs: {
            directory: 'user-json/forms',
            fileName: 'nested/payload.json',
            data: { ok: true },
          },
        }],
        response: { ok: true },
      }),
    }))

    try {
      const response = await fetch(`${invalidFileNameServer.baseUrl}/api/mokelay/invalid_r2_file_name`, { method: 'POST' })
      const body = await readJson<{
        ok: false
        error: { code: string, message: string }
      }>(response)

      expect(body).toMatchObject({
        ok: false,
        error: {
          code: 'BLOCK_R2_FILE_NAME_INVALID',
          message: 'fileName 不是合法 R2 文件名。',
        },
      })
    } finally {
      await invalidFileNameServer.close()
    }
  })

  it('wraps R2 upload failures in a block error', async () => {
    configureR2Env()
    mockR2PutFailure()

    const { createMokelayOrchestrationHandler } = await import('../../server/utils/orchestration')
    const server = await startServer(createMokelayOrchestrationHandler({
      loadApiJson: readApiJsonAsset,
    }))

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/save_json_to_r2`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          directory: 'user-json/forms',
          fileName: 'upload-failure.json',
          data: { ok: true },
        }),
      })
      const body = await readJson<{
        ok: false
        error: { code: string, message: string }
      }>(response)

      expect(body).toMatchObject({
        ok: false,
        error: {
          code: 'BLOCK_R2_SAVE_FAILED',
          message: '保存 JSON 到 Cloudflare R2 失败。',
        },
      })
    } finally {
      await server.close()
    }
  })
})
