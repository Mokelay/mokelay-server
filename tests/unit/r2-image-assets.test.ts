import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, toNodeListener, type EventHandler } from 'h3'

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
}

const managedEnvKeys = [
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_ENDPOINT',
  'MOKELAY_IMAGES_R2_BUCKET',
  'MOKELAY_IMAGES_R2_PREFIX',
  'MOKELAY_IMAGES_PUBLIC_BASE_URL',
  'MOKELAY_APIS_R2_BUCKET',
]
const originalEnv = new Map(managedEnvKeys.map((key) => [key, process.env[key]]))

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

function restoreEnv() {
  for (const key of managedEnvKeys) {
    const value = originalEnv.get(key)

    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function configureImageR2Env() {
  process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'account-id'
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'access-key-id'
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-access-key'
  process.env.MOKELAY_IMAGES_R2_BUCKET = 'mokelay-images'
}

async function readJson<T>(response: Response) {
  return await response.json() as T
}

describe('R2 image asset APIs', () => {
  afterEach(() => {
    vi.doUnmock('@aws-sdk/client-s3')
    vi.resetModules()
    restoreEnv()
  })

  it('uploads an image to mocked R2 and reads it back as JSON', async () => {
    configureImageR2Env()
    const objects = new Map<string, { body: Buffer, contentType: string, etag: string }>()

    vi.doMock('@aws-sdk/client-s3', () => ({
      GetObjectCommand: class {
        constructor(readonly input: Record<string, unknown>) {}
      },
      PutObjectCommand: class {
        constructor(readonly input: Record<string, unknown>) {}
      },
      S3Client: class {
        send = async (command: { input: Record<string, unknown> }) => {
          if ('Body' in command.input) {
            const key = String(command.input.Key)
            objects.set(key, {
              body: Buffer.from(command.input.Body as Buffer),
              contentType: String(command.input.ContentType),
              etag: '"image-etag"',
            })
            return { ETag: '"image-etag"' }
          }

          const key = String(command.input.Key)
          const object = objects.get(key)
          if (!object) throw new Error(`Missing R2 object: ${key}`)

          return {
            Body: {
              transformToByteArray: async () => new Uint8Array(object.body),
            },
            ContentType: object.contentType,
            ETag: object.etag,
          }
        }
      },
    }))

    const { createMokelayOrchestrationHandler } = await import('mokelay-server-core/utils/orchestration')
    const { serverBlockDefinitions } = await import('../../server/utils/blocks')
    const server = await startServer(createMokelayOrchestrationHandler({
      blockDefinitions: serverBlockDefinitions,
    }))

    try {
      const formData = new FormData()
      formData.set('image', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'source.png')

      const uploadResponse = await fetch(`${server.baseUrl}/api/mokelay/upload_image_to_r2`, {
        method: 'POST',
        body: formData,
      })
      const uploadBody = await readJson<{
        ok: true
        data: {
          url: string
          image: {
            key: string
            fileName: string
            mimeType: string
            size: number
            url: string
            dataUrl: string
          }
        }
      }>(uploadResponse)

      expect(uploadBody.ok).toBe(true)
      expect(uploadBody.data.image.key).toMatch(/^mokelay-images\/uploads\/source-/)
      expect(uploadBody.data.image.fileName).toMatch(/^source-.*\.png$/)
      expect(uploadBody.data.image.mimeType).toBe('image/png')
      expect(uploadBody.data.image.size).toBe(4)
      expect(uploadBody.data.url).toBe(uploadBody.data.image.dataUrl)
      expect(uploadBody.data.url).toMatch(/^data:image\/png;base64,/)

      const readResponse = await fetch(`${server.baseUrl}/api/mokelay/read_image_from_r2?key=${encodeURIComponent(uploadBody.data.image.key)}`)
      const readBody = await readJson<{
        ok: true
        data: {
          url: string
          image: {
            key: string
            fileName: string
            mimeType: string
            size: number
            dataUrl: string
          }
        }
      }>(readResponse)

      expect(readBody.ok).toBe(true)
      expect(readBody.data.image.key).toBe(uploadBody.data.image.key)
      expect(readBody.data.image.fileName).toBe(uploadBody.data.image.fileName)
      expect(readBody.data.image.mimeType).toBe('image/png')
      expect(readBody.data.image.size).toBe(4)
      expect(readBody.data.url).toBe(readBody.data.image.dataUrl)
      expect(readBody.data.url).toBe(uploadBody.data.url)
    } finally {
      await server.close()
    }
  })
})
