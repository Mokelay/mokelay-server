import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import aiAnalyzeHandler from '../../server/routes/api/ai/analyze-data-source.post'
import {
  AiDataSourceUnrecognizedError,
  analyzeDataSourceImage,
  analyzeDataSourceText,
  maxImageBytes,
  maxTextBytes,
} from '../../server/utils/ai-data-source'

vi.mock('../../server/utils/ai-data-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/ai-data-source')>()

  return {
    ...actual,
    analyzeDataSourceImage: vi.fn(),
    analyzeDataSourceText: vi.fn(),
  }
})

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
}

const mockedAnalyzeDataSourceImage = vi.mocked(analyzeDataSourceImage)
const mockedAnalyzeDataSourceText = vi.mocked(analyzeDataSourceText)

async function startServer(): Promise<TestServer> {
  const app = createApp()

  app.use('/api/ai/analyze-data-source', aiAnalyzeHandler)

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

function createImageFormData(mimeType = 'image/png', bytes = new Uint8Array([1, 2, 3])) {
  const formData = new FormData()

  formData.set('image', new Blob([bytes], { type: mimeType }), 'source.png')

  return formData
}

describe('AI data source API', () => {
  let testServer: TestServer

  beforeEach(async () => {
    mockedAnalyzeDataSourceImage.mockReset()
    mockedAnalyzeDataSourceText.mockReset()
    testServer = await startServer()
  })

  afterEach(async () => {
    await testServer.close()
  })

  it('returns JSON data source analysis for an uploaded image', async () => {
    mockedAnalyzeDataSourceImage.mockResolvedValueOnce({
      type: 'JSON',
      rawData: { ok: true },
    })

    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      body: createImageFormData(),
    })
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({
      type: 'JSON',
      rawData: { ok: true },
    })
    expect(mockedAnalyzeDataSourceImage).toHaveBeenCalledWith({
      data: expect.any(Buffer),
      mimeType: 'image/png',
    })
  })

  it('returns API data source analysis for an uploaded image', async () => {
    mockedAnalyzeDataSourceImage.mockResolvedValueOnce({
      type: 'API',
      domain: 'https://api.mokelay.com',
      path: '/api/me',
      method: 'GET',
      headerData: [{ key: 'H1', mock: '' }],
      bodyData: [{ key: 'b1', dataType: 'string', mock: '' }],
      queryData: [{ key: 'q1', mock: '' }],
    })

    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      body: createImageFormData('image/webp'),
    })
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({
      type: 'API',
      domain: 'https://api.mokelay.com',
      path: '/api/me',
      method: 'GET',
      headerData: [{ key: 'H1', mock: '' }],
      bodyData: [{ key: 'b1', dataType: 'string', mock: '' }],
      queryData: [{ key: 'q1', mock: '' }],
    })
    expect(mockedAnalyzeDataSourceImage).toHaveBeenCalledWith({
      data: expect.any(Buffer),
      mimeType: 'image/webp',
    })
  })

  it('returns JSON data source analysis for text input', async () => {
    mockedAnalyzeDataSourceText.mockResolvedValueOnce({
      type: 'JSON',
      rawData: { ok: true },
    })

    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '{"ok":true}' }),
    })
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({
      type: 'JSON',
      rawData: { ok: true },
    })
    expect(mockedAnalyzeDataSourceText).toHaveBeenCalledWith('{"ok":true}')
    expect(mockedAnalyzeDataSourceImage).not.toHaveBeenCalled()
  })

  it('returns API data source analysis for text input', async () => {
    mockedAnalyzeDataSourceText.mockResolvedValueOnce({
      type: 'API',
      domain: 'https://api.mokelay.com',
      path: '/api/me',
      method: 'GET',
      headerData: [],
      bodyData: [],
      queryData: [{ key: 'debug', mock: '' }],
    })

    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'GET https://api.mokelay.com/api/me?debug=true' }),
    })
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({
      type: 'API',
      domain: 'https://api.mokelay.com',
      path: '/api/me',
      method: 'GET',
      headerData: [],
      bodyData: [],
      queryData: [{ key: 'debug', mock: '' }],
    })
    expect(mockedAnalyzeDataSourceText).toHaveBeenCalledWith('GET https://api.mokelay.com/api/me?debug=true')
    expect(mockedAnalyzeDataSourceImage).not.toHaveBeenCalled()
  })

  it('rejects multipart requests without an image file', async () => {
    const formData = new FormData()

    formData.set('name', 'source')

    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      body: formData,
    })

    expect(response.status).toBe(400)
    expect(mockedAnalyzeDataSourceImage).not.toHaveBeenCalled()
  })

  it('rejects JSON requests without text', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: 'data:image/png;base64,aW1hZ2U=' }),
    })

    expect(response.status).toBe(400)
    expect(mockedAnalyzeDataSourceImage).not.toHaveBeenCalled()
    expect(mockedAnalyzeDataSourceText).not.toHaveBeenCalled()
  })

  it('rejects empty text requests', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    })

    expect(response.status).toBe(400)
    expect(mockedAnalyzeDataSourceText).not.toHaveBeenCalled()
  })

  it('rejects text larger than 100KB', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(maxTextBytes + 1) }),
    })

    expect(response.status).toBe(400)
    expect(mockedAnalyzeDataSourceText).not.toHaveBeenCalled()
  })

  it('rejects JSON requests that include both text and image', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'GET /api/me',
        image: 'data:image/png;base64,aW1hZ2U=',
      }),
    })

    expect(response.status).toBe(400)
    expect(mockedAnalyzeDataSourceText).not.toHaveBeenCalled()
  })

  it('rejects multipart requests that include both image and text', async () => {
    const formData = createImageFormData()

    formData.set('text', 'GET /api/me')

    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      body: formData,
    })

    expect(response.status).toBe(400)
    expect(mockedAnalyzeDataSourceImage).not.toHaveBeenCalled()
    expect(mockedAnalyzeDataSourceText).not.toHaveBeenCalled()
  })

  it('rejects unsupported content types', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'GET /api/me',
    })

    expect(response.status).toBe(400)
    expect(mockedAnalyzeDataSourceImage).not.toHaveBeenCalled()
    expect(mockedAnalyzeDataSourceText).not.toHaveBeenCalled()
  })

  it('rejects unsupported image content types', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      body: createImageFormData('text/plain'),
    })

    expect(response.status).toBe(400)
    expect(mockedAnalyzeDataSourceImage).not.toHaveBeenCalled()
  })

  it('rejects images larger than 10MB', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      body: createImageFormData('image/png', new Uint8Array(maxImageBytes + 1)),
    })

    expect(response.status).toBe(400)
    expect(mockedAnalyzeDataSourceImage).not.toHaveBeenCalled()
  })

  it('maps unrecognized images to 422', async () => {
    mockedAnalyzeDataSourceImage.mockRejectedValueOnce(
      new AiDataSourceUnrecognizedError('无法从图片中识别出 JSON 数据或 API 信息。'),
    )

    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      body: createImageFormData(),
    })

    expect(response.status).toBe(422)
  })

  it('maps unrecognized text to 422', async () => {
    mockedAnalyzeDataSourceText.mockRejectedValueOnce(
      new AiDataSourceUnrecognizedError('无法从图片中识别出 JSON 数据或 API 信息。'),
    )

    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello world' }),
    })

    expect(response.status).toBe(422)
  })
})
