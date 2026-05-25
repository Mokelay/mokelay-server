import { afterEach, describe, expect, it, vi } from 'vitest'

const r2EnvKeys = [
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_ENDPOINT',
  'MOKELAY_APIS_R2_BUCKET',
  'MOKELAY_APIS_R2_PREFIX',
]
const originalR2Env = new Map(r2EnvKeys.map((key) => [key, process.env[key]]))

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
