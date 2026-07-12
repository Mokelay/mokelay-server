import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { DatabaseType } from 'mokelay-server-core/utils/db'
import type { SqlExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { describe, expect, it, vi } from 'vitest'
import {
  executeSaveAiDslAssetsBlock,
  saveAiDslAssets,
  type AiDslAssetStore,
} from '../../server/utils/blocks/saveAiDslAssets'

const pageOneUuid = '11111111-1111-4111-8111-111111111111'
const pageTwoUuid = '22222222-2222-4222-8222-222222222222'

function generatedPage(uuid = pageOneUuid, name = '客户列表') {
  return {
    uuid,
    name,
    blocks: [{ id: 'heading', type: 'MHeading', data: { text: name } }],
  }
}

function generatedApi(uuid = 'api_list_customers', alias = '获取客户列表') {
  return {
    uuid,
    alias,
    method: 'get',
    request: { query: [], body: [], header: [] },
    blocks: [],
    response: null,
  }
}

function fakeStore(options: {
  pages?: string[]
  apis?: string[]
  failPageUuid?: string
  failApiUuid?: string
} = {}) {
  const pages = new Set(options.pages ?? [])
  const apis = new Set(options.apis ?? [])
  const calls = {
    pages: [] as Array<{ uuid: string, mode: 'create' | 'update' }>,
    apis: [] as Array<{ uuid: string, mode: 'create' | 'update', status: string }>,
    snapshots: [] as string[],
  }

  const store: AiDslAssetStore = {
    pageExists: async uuid => pages.has(uuid),
    async savePage(page, mode) {
      calls.pages.push({ uuid: page.uuid, mode })
      if (page.uuid === options.failPageUuid) throw new Error('database page failure')
      pages.add(page.uuid)
    },
    apiExists: async uuid => apis.has(uuid),
    async saveApi(api, mode) {
      calls.apis.push({ uuid: api.uuid, mode, status: api.status })
      if (api.uuid === options.failApiUuid) throw new Error('database api failure')
      apis.add(api.uuid)
    },
    async createApiSnapshot(api) {
      calls.snapshots.push(api.uuid)
    },
  }

  return { store, calls, pages, apis }
}

describe('saveAiDslAssets', () => {
  it('returns a complete empty summary when the generation has no assets', async () => {
    const { store } = fakeStore()

    await expect(saveAiDslAssets({
      generationResult: {},
      knownPageUuids: [pageOneUuid, pageOneUuid, 'invalid'],
      knownApiUuids: ['known_api', 'known_api', '../invalid'],
    }, store)).resolves.toEqual({
      status: 'complete',
      pages: [],
      apis: [],
      savedCount: 0,
      failedCount: 0,
      knownPageUuids: [pageOneUuid],
      knownApiUuids: ['known_api'],
    })
  })

  it('creates new APIs and pages and records an API snapshot', async () => {
    const { store, calls } = fakeStore()
    const summary = await saveAiDslAssets({
      generationResult: {
        apis: [generatedApi()],
        pages: [generatedPage()],
      },
      apiStatus: 'draft',
    }, store)

    expect(summary).toMatchObject({
      status: 'complete',
      savedCount: 2,
      failedCount: 0,
      knownPageUuids: [pageOneUuid],
      knownApiUuids: ['api_list_customers'],
      pages: [{
        type: 'page',
        sourceUuid: pageOneUuid,
        savedUuid: pageOneUuid,
        href: `#/pages/${pageOneUuid}`,
        status: 'success',
      }],
      apis: [{
        type: 'api',
        sourceUuid: 'api_list_customers',
        savedUuid: 'api_list_customers',
        href: '#/apis/api_list_customers',
        status: 'success',
      }],
    })
    expect(calls.pages).toEqual([{ uuid: pageOneUuid, mode: 'create' }])
    expect(calls.apis).toEqual([{ uuid: 'api_list_customers', mode: 'create', status: 'draft' }])
    expect(calls.snapshots).toEqual(['api_list_customers'])
  })

  it('returns partial when an unknown existing UUID conflicts and continues other assets', async () => {
    const { store, calls } = fakeStore({ apis: ['api_list_customers'] })
    const summary = await saveAiDslAssets({
      generationResult: {
        apis: [generatedApi()],
        pages: [generatedPage()],
      },
    }, store)

    expect(summary.status).toBe('partial')
    expect(summary.savedCount).toBe(1)
    expect(summary.failedCount).toBe(1)
    expect(summary.apis[0]).toMatchObject({
      status: 'error',
      error: expect.stringContaining('AI_DSL_ASSET_UUID_EXISTS'),
    })
    expect(summary.pages[0]?.status).toBe('success')
    expect(calls.apis).toEqual([])
    expect(calls.snapshots).toEqual([])
    expect(calls.pages).toEqual([{ uuid: pageOneUuid, mode: 'create' }])
  })

  it('updates existing assets only when their UUIDs are known', async () => {
    const { store, calls } = fakeStore({
      pages: [pageOneUuid],
      apis: ['api_list_customers'],
    })
    const summary = await saveAiDslAssets({
      generationResult: {
        apis: [generatedApi()],
        pages: [generatedPage()],
      },
      knownPageUuids: [pageOneUuid],
      knownApiUuids: ['api_list_customers'],
      apiStatus: 'published',
    }, store)

    expect(summary.status).toBe('complete')
    expect(calls.pages).toEqual([{ uuid: pageOneUuid, mode: 'update' }])
    expect(calls.apis).toEqual([{ uuid: 'api_list_customers', mode: 'update', status: 'published' }])
    expect(calls.snapshots).toEqual(['api_list_customers'])
  })

  it('keeps validation and database failures item-scoped', async () => {
    const { store, calls } = fakeStore({ failApiUuid: 'api_fails' })
    const summary = await saveAiDslAssets({
      generationResult: {
        apis: [generatedApi('api_fails', '失败 API')],
        pages: [
          generatedPage('not-a-page-uuid', '非法页面'),
          generatedPage(pageTwoUuid, '有效页面'),
        ],
      },
    }, store)

    expect(summary.status).toBe('partial')
    expect(summary.savedCount).toBe(1)
    expect(summary.failedCount).toBe(2)
    expect(summary.apis[0]?.error).toBe('AI_DSL_ASSET_SAVE_FAILED: API保存失败。')
    expect(summary.pages[0]?.error).toContain('AI_DSL_PAGE_UUID_INVALID')
    expect(summary.pages[1]?.status).toBe('success')
    expect(calls.snapshots).toEqual([])
    expect(calls.pages).toEqual([{ uuid: pageTwoUuid, mode: 'create' }])
  })

  it('returns an item error when an API UUID is missing', async () => {
    const { store } = fakeStore()
    const summary = await saveAiDslAssets({
      generationResult: {
        apis: [{ alias: 'Missing UUID', method: 'GET', blocks: [] }],
      },
    }, store)

    expect(summary).toMatchObject({
      status: 'error',
      savedCount: 0,
      failedCount: 1,
      apis: [{
        sourceUuid: '',
        status: 'error',
        error: expect.stringContaining('AI_DSL_API_UUID_INVALID'),
      }],
    })
  })

  it('rejects only invalid overall inputs', async () => {
    const { store } = fakeStore()

    await expect(saveAiDslAssets({
      generationResult: null,
    }, store)).rejects.toMatchObject({
      statusCode: 400,
      data: { code: 'BLOCK_AI_INPUT_INVALID' },
      message: expect.stringContaining('AI_DSL_ASSETS_INVALID_RESULT'),
    })
    await expect(saveAiDslAssets({
      generationResult: {},
      strategy: 'overwrite_all',
    }, store)).rejects.toMatchObject({
      data: { code: 'BLOCK_AI_INPUT_INVALID' },
    })
  })

  it.each([
    ['postgres', new PgDialect()],
    ['mysql', new MySqlDialect()],
  ] as const)('uses fixed SQL tables and inserts API snapshots with %s', async (databaseType, dialect) => {
    const statements: string[] = []
    const executeSql = vi.fn(async (query: SQL) => {
      statements.push(dialect.sqlToQuery(query).sql.toLowerCase())
      return {
        databaseType: databaseType as DatabaseType,
        rows: [],
      }
    }) as unknown as SqlExecutor

    await expect(executeSaveAiDslAssetsBlock({
      event: undefined as never,
      block: undefined as never,
      inputs: {
        datasource: 'Mokelay',
        generationResult: {
          apis: [generatedApi()],
          pages: [generatedPage()],
        },
      },
      executeSql,
      databaseType,
    })).resolves.toMatchObject({
      saveSummary: {
        status: 'complete',
        savedCount: 2,
      },
    })

    const normalizedSql = statements.join('\n').replaceAll('`', '"')
    expect(normalizedSql).toContain('select uuid from "apis"')
    expect(normalizedSql).toContain('insert into "apis"')
    expect(normalizedSql).toContain('insert into "apis_snapshot"')
    expect(normalizedSql).toContain('select uuid from "pages"')
    expect(normalizedSql).toContain('insert into "pages"')
  })
})
