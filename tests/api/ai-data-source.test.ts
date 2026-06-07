import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, toNodeListener } from 'h3'
import orchestrationHandler from '../../server/routes/api/mokelay/[apiJsonUuid]'
import {
  AiDataSourceConfigError,
  AiDataSourceModelOutputError,
  AiDataSourceProviderError,
  AiDataSourceUnrecognizedError,
  analyzeDataSource,
  maxImageBytes,
  maxTextBytes,
} from 'mokelay-server-core/utils/ai-data-source'

vi.mock('mokelay-server-core/utils/ai-data-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mokelay-server-core/utils/ai-data-source')>()

  return {
    ...actual,
    analyzeDataSource: vi.fn(),
  }
})

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
}

type MokelaySuccessBody<T> = {
  ok: true
  data: T
}

type MokelayErrorBody = {
  ok: false
  error: {
    code: string
    message: string
  }
}

const mockedAnalyzeDataSource = vi.mocked(analyzeDataSource)

async function startServer(): Promise<TestServer> {
  const app = createApp()
  const router = createRouter()

  router.use('/api/mokelay/:apiJsonUuid', orchestrationHandler)
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

async function readJson<T>(response: Response) {
  return await response.json() as T
}

async function readMokelayData<T>(response: Response) {
  const body = await readJson<MokelaySuccessBody<T>>(response)

  expect(response.status).toBe(200)
  expect(body.ok).toBe(true)

  return body.data
}

async function expectMokelayError(response: Response, code: string) {
  const body = await readJson<MokelayErrorBody>(response)

  expect(response.status).toBe(200)
  expect(body.ok).toBe(false)
  expect(body.error.code).toBe(code)

  return body
}

function createImageFormData(mimeType = 'image/png', bytes = new Uint8Array([1, 2, 3])) {
  const formData = new FormData()

  formData.set('image', new Blob([bytes], { type: mimeType }), 'source.png')

  return formData
}

function analyzeDataSourceUrl(baseUrl: string, query = '') {
  return `${baseUrl}/api/mokelay/analyze-data-source${query}`
}

describe('AI data source orchestration API', () => {
  let testServer: TestServer

  beforeEach(async () => {
    mockedAnalyzeDataSource.mockReset()
    testServer = await startServer()
  })

  afterEach(async () => {
    await testServer.close()
  })

  it('returns JSON data source analysis for an uploaded image', async () => {
    mockedAnalyzeDataSource.mockResolvedValueOnce({
      type: 'JSON',
      rawData: { ok: true },
    })

    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      body: createImageFormData(),
    })
    const body = await readMokelayData(response)

    expect(body).toEqual({
      type: 'JSON',
      rawData: { ok: true },
    })
    expect(mockedAnalyzeDataSource).toHaveBeenCalledWith({
      prompt: undefined,
      userInput: undefined,
      image: expect.objectContaining({
        data: expect.any(Buffer),
        mimeType: 'image/png',
        fileName: 'source.png',
        size: 3,
      }),
    })
  })

  it('returns API data source analysis for an uploaded image with prompt', async () => {
    mockedAnalyzeDataSource.mockResolvedValueOnce({
      type: 'API',
      domain: 'https://api.mokelay.com',
      path: '/api/mokelay/me',
      method: 'GET',
      headerData: [{ key: 'H1', mock: '' }],
      bodyData: [{ key: 'b1', dataType: 'string', mock: '' }],
      queryData: [{ key: 'q1', mock: '' }],
    })

    const formData = createImageFormData('image/webp')

    formData.set('prompt', '优先识别截图中的请求参数')

    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      body: formData,
    })
    const body = await readMokelayData(response)

    expect(body).toEqual({
      type: 'API',
      domain: 'https://api.mokelay.com',
      path: '/api/mokelay/me',
      method: 'GET',
      headerData: [{ key: 'H1', mock: '' }],
      bodyData: [{ key: 'b1', dataType: 'string', mock: '' }],
      queryData: [{ key: 'q1', mock: '' }],
    })
    expect(mockedAnalyzeDataSource).toHaveBeenCalledWith({
      prompt: '优先识别截图中的请求参数',
      userInput: undefined,
      image: expect.objectContaining({
        data: expect.any(Buffer),
        mimeType: 'image/webp',
      }),
    })
  })

  it('passes uploaded image and user input into the analyze block together', async () => {
    mockedAnalyzeDataSource.mockResolvedValueOnce({
      type: 'JSON',
      rawData: { merged: true },
    })

    const formData = createImageFormData()

    formData.set('userInput', '截图里是接口返回值，请按 JSON 数据识别')

    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      body: formData,
    })

    expect(await readMokelayData(response)).toEqual({
      type: 'JSON',
      rawData: { merged: true },
    })
    expect(mockedAnalyzeDataSource).toHaveBeenCalledWith({
      prompt: undefined,
      userInput: '截图里是接口返回值，请按 JSON 数据识别',
      image: expect.objectContaining({
        data: expect.any(Buffer),
        mimeType: 'image/png',
      }),
    })
  })

  it('returns JSON data source analysis for userInput', async () => {
    mockedAnalyzeDataSource.mockResolvedValueOnce({
      type: 'JSON',
      rawData: { ok: true },
    })

    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userInput: '{"ok":true}' }),
    })

    expect(await readMokelayData(response)).toEqual({
      type: 'JSON',
      rawData: { ok: true },
    })
    expect(mockedAnalyzeDataSource).toHaveBeenCalledWith({
      prompt: undefined,
      userInput: '{"ok":true}',
      image: undefined,
    })
  })

  it('does not accept text as a user input alias', async () => {
    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'GET https://api.mokelay.com/api/mokelay/me?debug=true' }),
    })

    await expectMokelayError(response, 'BLOCK_AI_INPUT_INVALID')
    expect(mockedAnalyzeDataSource).not.toHaveBeenCalled()
  })

  it('rejects requests without usable input', async () => {
    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    await expectMokelayError(response, 'BLOCK_AI_INPUT_INVALID')
    expect(mockedAnalyzeDataSource).not.toHaveBeenCalled()
  })

  it('rejects JSON image data URLs', async () => {
    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: 'data:image/png;base64,aW1hZ2U=' }),
    })

    await expectMokelayError(response, 'BLOCK_AI_INPUT_INVALID')
    expect(mockedAnalyzeDataSource).not.toHaveBeenCalled()
  })

  it('rejects empty userInput requests', async () => {
    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userInput: '   ' }),
    })

    await expectMokelayError(response, 'BLOCK_AI_INPUT_INVALID')
    expect(mockedAnalyzeDataSource).not.toHaveBeenCalled()
  })

  it('rejects userInput larger than 100KB', async () => {
    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userInput: 'x'.repeat(maxTextBytes + 1) }),
    })

    await expectMokelayError(response, 'BLOCK_AI_INPUT_INVALID')
    expect(mockedAnalyzeDataSource).not.toHaveBeenCalled()
  })

  it('rejects unsupported content types without usable input', async () => {
    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'GET /api/mokelay/me',
    })

    await expectMokelayError(response, 'BLOCK_AI_INPUT_INVALID')
    expect(mockedAnalyzeDataSource).not.toHaveBeenCalled()
  })

  it('rejects unsupported image content types', async () => {
    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      body: createImageFormData('text/plain'),
    })

    await expectMokelayError(response, 'BLOCK_AI_INPUT_INVALID')
    expect(mockedAnalyzeDataSource).not.toHaveBeenCalled()
  })

  it('rejects images larger than 10MB', async () => {
    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      body: createImageFormData('image/png', new Uint8Array(maxImageBytes + 1)),
    })

    await expectMokelayError(response, 'BLOCK_AI_INPUT_INVALID')
    expect(mockedAnalyzeDataSource).not.toHaveBeenCalled()
  })

  it('maps AI unrecognized errors to block errors', async () => {
    mockedAnalyzeDataSource.mockRejectedValueOnce(
      new AiDataSourceUnrecognizedError('无法从图片中识别出 JSON 数据或 API 信息。'),
    )

    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
      method: 'POST',
      body: createImageFormData(),
    })

    await expectMokelayError(response, 'BLOCK_AI_UNRECOGNIZED')
  })

  it('maps AI provider/config/model errors to block errors', async () => {
    const cases = [
      {
        error: new AiDataSourceConfigError('缺少 OPENAI_API_KEY 配置。'),
        code: 'BLOCK_AI_CONFIG_MISSING',
      },
      {
        error: new AiDataSourceProviderError('AI 数据源分析服务调用失败。'),
        code: 'BLOCK_AI_PROVIDER_FAILED',
      },
      {
        error: new AiDataSourceModelOutputError('AI 返回的数据源结构无效。'),
        code: 'BLOCK_AI_OUTPUT_INVALID',
      },
    ]

    for (const item of cases) {
      mockedAnalyzeDataSource.mockRejectedValueOnce(item.error)

      const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userInput: 'GET /api/mokelay/me' }),
      })

      await expectMokelayError(response, item.code)
    }
  })

  it('does not register the removed /api/ai/analyze-data-source route', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/ai/analyze-data-source`, {
      method: 'POST',
      body: createImageFormData(),
    })

    expect(response.status).toBe(404)
    expect(mockedAnalyzeDataSource).not.toHaveBeenCalled()
  })

  it('does not expose raw image bytes in debug traces', async () => {
    mockedAnalyzeDataSource.mockResolvedValueOnce({
      type: 'JSON',
      rawData: { ok: true },
    })

    const response = await fetch(analyzeDataSourceUrl(testServer.baseUrl, '?__debug=1'), {
      method: 'POST',
      body: createImageFormData(),
    })
    const body = await readJson<MokelaySuccessBody<unknown> & {
      debug?: {
        nextBlock?: {
          inputs?: Record<string, unknown>
        } | null
      }
    }>(response)

    expect(body.ok).toBe(true)
    expect(body.debug?.nextBlock?.inputs?.image).toEqual({
      data: {
        type: 'Buffer',
        byteLength: 3,
      },
      mimeType: 'image/png',
      fileName: 'source.png',
      size: 3,
    })
  })
})
