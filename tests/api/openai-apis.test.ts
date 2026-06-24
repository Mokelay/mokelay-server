import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, toNodeListener } from 'h3'
import { maxOpenAIImageBytes } from 'mokelay-server-core/utils/blocks/openAI'
import orchestrationHandler from '../../server/routes/api/mokelay/[apiJsonUuid]'

const originalOpenAiApiKey = process.env.OPENAI_API_KEY
const originalOpenAiModel = process.env.OPENAI_MODEL

const openAiMocks = vi.hoisted(() => {
  const responsesCreate = vi.fn()
  const OpenAI = vi.fn(function () {
    return {
      responses: {
        create: responsesCreate,
      },
    }
  })

  return { OpenAI, responsesCreate }
})

vi.mock('openai', () => ({
  default: openAiMocks.OpenAI,
}))

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
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    }),
  }
}

function completedResponse(value: unknown) {
  const outputText = JSON.stringify(value)

  return {
    status: 'completed',
    output_text: outputText,
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: outputText }],
      },
    ],
  }
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

function apiUrl(baseUrl: string, uuid: string, query = '') {
  return `${baseUrl}/api/mokelay/${uuid}${query}`
}

function createImageFormData(mimeType = 'image/png', bytes = new Uint8Array([1, 2, 3])) {
  const formData = new FormData()

  formData.set('image', new Blob([bytes], { type: mimeType }), 'source.png')

  return formData
}

describe('OpenAI orchestration APIs', () => {
  let testServer: TestServer

  beforeEach(async () => {
    openAiMocks.OpenAI.mockClear()
    openAiMocks.responsesCreate.mockReset()
    process.env.OPENAI_API_KEY = 'test-api-key'
    delete process.env.OPENAI_MODEL
    testServer = await startServer()
  })

  afterEach(async () => {
    await testServer.close()
  })

  afterAll(() => {
    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey
    }

    if (originalOpenAiModel === undefined) {
      delete process.env.OPENAI_MODEL
    } else {
      process.env.OPENAI_MODEL = originalOpenAiModel
    }
  })

  it('returns JSON data source output from text input', async () => {
    openAiMocks.responsesCreate.mockResolvedValueOnce(completedResponse({
      type: 'JSON',
      rawData: { ok: true },
    }))

    const response = await fetch(apiUrl(testServer.baseUrl, 'analyze-data-source'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '优先识别返回数据',
        userInput: '{"ok":true}',
      }),
    })

    expect(await readMokelayData(response)).toEqual({
      type: 'JSON',
      rawData: { ok: true },
    })
    expect(openAiMocks.responsesCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: [
        {
          role: 'developer',
          content: expect.stringContaining('补充要求：优先识别返回数据'),
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: '{"ok":true}' }],
        },
      ],
    }))
  })

  it('returns API and UNKNOWN data source outputs unchanged', async () => {
    const apiResult = {
      type: 'API',
      domain: 'https://api.mokelay.com',
      path: '/api/mokelay/me',
      method: 'GET',
      headerData: [],
      bodyData: [],
      queryData: [],
    }

    openAiMocks.responsesCreate
      .mockResolvedValueOnce(completedResponse(apiResult))
      .mockResolvedValueOnce(completedResponse({ type: 'UNKNOWN' }))

    const apiResponse = await fetch(apiUrl(testServer.baseUrl, 'analyze-data-source'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userInput: 'GET https://api.mokelay.com/api/mokelay/me' }),
    })
    const unknownResponse = await fetch(apiUrl(testServer.baseUrl, 'analyze-data-source'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userInput: '随便聊聊' }),
    })

    expect(await readMokelayData(apiResponse)).toEqual(apiResult)
    expect(await readMokelayData(unknownResponse)).toEqual({ type: 'UNKNOWN' })
  })

  it('passes uploaded images and optional text to OpenAI', async () => {
    openAiMocks.responsesCreate.mockResolvedValueOnce(completedResponse({ type: 'JSON', rawData: {} }))

    const formData = createImageFormData('image/webp')
    formData.set('userInput', '请识别截图内容')

    const response = await fetch(apiUrl(testServer.baseUrl, 'analyze-data-source'), {
      method: 'POST',
      body: formData,
    })

    expect(await readMokelayData(response)).toEqual({ type: 'JSON', rawData: {} })
    expect(openAiMocks.responsesCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: [
        { role: 'developer', content: expect.any(String) },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: '请识别截图内容' },
            {
              type: 'input_image',
              image_url: 'data:image/webp;base64,AQID',
              detail: 'high',
            },
          ],
        },
      ],
    }))
  })

  it('validates data source input and image constraints', async () => {
    const emptyResponse = await fetch(apiUrl(testServer.baseUrl, 'analyze-data-source'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const dataUrlResponse = await fetch(apiUrl(testServer.baseUrl, 'analyze-data-source'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: 'data:image/png;base64,aW1hZ2U=' }),
    })
    const typeResponse = await fetch(apiUrl(testServer.baseUrl, 'analyze-data-source'), {
      method: 'POST',
      body: createImageFormData('image/gif'),
    })
    const sizeResponse = await fetch(apiUrl(testServer.baseUrl, 'analyze-data-source'), {
      method: 'POST',
      body: createImageFormData('image/png', new Uint8Array(maxOpenAIImageBytes + 1)),
    })

    for (const response of [emptyResponse, dataUrlResponse, typeResponse, sizeResponse]) {
      await expectMokelayError(response, 'BLOCK_AI_INPUT_INVALID')
    }

    expect(openAiMocks.responsesCreate).not.toHaveBeenCalled()
  })

  it('translates string arrays into an object keyed by the original text', async () => {
    openAiMocks.responsesCreate.mockResolvedValueOnce(completedResponse({
      translations: {
        Hello: '你好',
        'Welcome, {{name}}': '欢迎，{{name}}',
      },
    }))

    const response = await fetch(apiUrl(testServer.baseUrl, 'ai-translate'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        texts: ['Hello', 'Welcome, {{name}}'],
        sourceLanguage: ' English ',
        targetLanguage: ' 中文 ',
      }),
    })

    expect(await readMokelayData(response)).toEqual({
      translations: {
        Hello: '你好',
        'Welcome, {{name}}': '欢迎，{{name}}',
      },
    })
    expect(openAiMocks.responsesCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: [
        {
          role: 'developer',
          content: expect.stringMatching(/\{"translations":\{"原文":"译文"\}\}/),
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: '["Hello","Welcome, {{name}}"]' }],
        },
      ],
    }))
  })

  it('validates translation request fields and array limits', async () => {
    const cases = [
      {},
      { texts: 'Hello', sourceLanguage: 'English', targetLanguage: '中文' },
      { texts: [], sourceLanguage: 'English', targetLanguage: '中文' },
      { texts: [1], sourceLanguage: 'English', targetLanguage: '中文' },
      { texts: Array.from({ length: 101 }, (_, index) => String(index)), sourceLanguage: 'English', targetLanguage: '中文' },
      { texts: ['Hello'], sourceLanguage: ' ', targetLanguage: '中文' },
      { texts: ['Hello'], sourceLanguage: 'English', targetLanguage: ' ' },
    ]

    for (const body of cases) {
      const response = await fetch(apiUrl(testServer.baseUrl, 'ai-translate'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

      await expectMokelayError(response, 'PROCESSOR_VALIDATION_FAILED')
    }

    expect(openAiMocks.responsesCreate).not.toHaveBeenCalled()
  })

  it('generates page and API DSL from a requirement document', async () => {
    const generatedDsl = {
      version: 1,
      status: 'partial',
      summary: '生成客户列表页和删除接口，批量导出需要新增 Action。',
      pages: [
        {
          uuid: 'customer_list_page',
          name: '客户列表',
          blocks: [
            {
              id: 'customer-list-title',
              type: 'MHeading',
              data: { text: '客户列表', level: '1', align: 'left' },
            },
          ],
          apiDependencies: ['list_customers', 'delete_customer'],
          notes: [],
        },
      ],
      apis: [
        {
          uuid: 'list_customers',
          alias: '客户列表接口',
          method: 'GET',
          request: { header: [], query: ['page', 'pageSize'], body: [] },
          blocks: [
            { uuid: 'starter', nextBlock: 'page_customers' },
            {
              uuid: 'page_customers',
              functionName: 'page',
              inputs: { datasource: 'Mokelay', table: 'customers' },
              outputs: ['datas', 'total'],
              nextBlock: null,
            },
          ],
          response: {
            datas: { template: "{{blocks['page_customers'].outputs.datas}}" },
            total: { template: "{{blocks['page_customers'].outputs.total}}" },
          },
        },
      ],
      upgradePlan: {
        processors: [],
        blocks: [],
        actions: [
          {
            action: 'export_file',
            reason: '需求要求从列表导出文件，现有 Action 没有文件下载语义。',
            inputsSchema: { dsConfig: 'object', fileName: 'string' },
            outputs: ['fileUrl'],
            behavior: '执行数据源并触发文件下载。',
            dslExample: { uuid: 'export_customers', action: 'export_file', inputs: {} },
          },
        ],
        controls: [],
        components: [],
      },
      traceability: [
        {
          requirement: '客户列表',
          status: 'generated',
          pageUuids: ['customer_list_page'],
          apiUuids: ['list_customers'],
          upgradeRefs: [],
        },
        {
          requirement: '导出客户',
          status: 'requires_upgrade',
          pageUuids: [],
          apiUuids: [],
          upgradeRefs: ['actions.export_file'],
        },
      ],
      assumptions: [],
      warnings: [],
    }
    openAiMocks.responsesCreate.mockResolvedValueOnce(completedResponse(generatedDsl))

    const response = await fetch(apiUrl(testServer.baseUrl, 'ai-generate-dsl'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requirementDocument: '  需要生成客户列表页，支持分页查询、删除客户和导出客户。  ',
        projectContext: { app: 'crm' },
        dslContext: { blocks: ['MAdvanceTable'], actions: ['execute_ds'] },
        generationPreferences: { language: 'zh-CN' },
      }),
    })

    expect(await readMokelayData(response)).toEqual(generatedDsl)
    expect(openAiMocks.responsesCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: [
        {
          role: 'developer',
          content: expect.stringContaining('不能生成任何定制化前端代码'),
        },
        {
          role: 'user',
          content: [{
            type: 'input_text',
            text: JSON.stringify({
              requirementDocument: '需要生成客户列表页，支持分页查询、删除客户和导出客户。',
              projectContext: { app: 'crm' },
              dslContext: { blocks: ['MAdvanceTable'], actions: ['execute_ds'] },
              generationPreferences: { language: 'zh-CN' },
            }),
          }],
        },
      ],
    }))
    const prompt = openAiMocks.responsesCreate.mock.calls[0]?.[0]?.input[0]?.content
    expect(prompt).toContain('"upgradePlan"')
    expect(prompt).toContain('status 必须为 partial')
  })

  it('validates DSL generation requirement documents before calling OpenAI', async () => {
    const cases = [
      {},
      { requirementDocument: '   ' },
      { requirementDocument: '太短' },
    ]

    for (const body of cases) {
      const response = await fetch(apiUrl(testServer.baseUrl, 'ai-generate-dsl'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

      await expectMokelayError(response, 'PROCESSOR_VALIDATION_FAILED')
    }

    expect(openAiMocks.responsesCreate).not.toHaveBeenCalled()
  })

  it('returns output errors for invalid model JSON and missing generated fields', async () => {
    openAiMocks.responsesCreate
      .mockResolvedValueOnce({ status: 'completed', output_text: 'not-json', output: [] })
      .mockResolvedValueOnce(completedResponse({ wrong: [] }))
      .mockResolvedValueOnce(completedResponse({ version: 1 }))

    const invalidJsonResponse = await fetch(apiUrl(testServer.baseUrl, 'analyze-data-source'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userInput: 'hello' }),
    })
    const missingFieldResponse = await fetch(apiUrl(testServer.baseUrl, 'ai-translate'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: ['Hello'], sourceLanguage: 'English', targetLanguage: '中文' }),
    })
    const incompleteDslResponse = await fetch(apiUrl(testServer.baseUrl, 'ai-generate-dsl'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requirementDocument: '需要生成客户列表页，支持分页查询和删除客户。' }),
    })

    await expectMokelayError(invalidJsonResponse, 'BLOCK_AI_OUTPUT_INVALID')
    await expectMokelayError(missingFieldResponse, 'TEMPLATE_VARIABLE_NOT_FOUND')
    await expectMokelayError(incompleteDslResponse, 'TEMPLATE_VARIABLE_NOT_FOUND')
  })

  it('does not expose uploaded image bytes in debug traces', async () => {
    openAiMocks.responsesCreate.mockResolvedValueOnce(completedResponse({ type: 'JSON', rawData: {} }))

    const response = await fetch(apiUrl(testServer.baseUrl, 'analyze-data-source', '?__debug=1'), {
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
      data: { type: 'Buffer', byteLength: 3 },
      mimeType: 'image/png',
      fileName: 'source.png',
      size: 3,
    })
  })
})
