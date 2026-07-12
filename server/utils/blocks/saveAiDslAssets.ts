import { sql } from 'drizzle-orm'
import type { DatabaseType } from 'mokelay-server-core/utils/db'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import type { BlockExecutor, SqlExecutor } from 'mokelay-server-core/utils/orchestration-schema'

const apiUuidPattern = /^[A-Za-z0-9_-]{1,128}$/
const pageUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const apiMethodPattern = /^[A-Z]+$/
const strategyName = 'create_or_update_known'

type SaveMode = 'create' | 'update'
type ApiStatus = 'draft' | 'published'
type AssetType = 'page' | 'api'
type SummaryStatus = 'complete' | 'partial' | 'error'

export type SaveAiDslAssetItem = {
  type: AssetType
  title: string
  sourceUuid: string
  savedUuid?: string
  href?: string
  status: 'success' | 'error'
  error?: string
}

export type SaveAiDslAssetsSummary = {
  status: SummaryStatus
  pages: SaveAiDslAssetItem[]
  apis: SaveAiDslAssetItem[]
  savedCount: number
  failedCount: number
  knownPageUuids: string[]
  knownApiUuids: string[]
}

type NormalizedPage = {
  uuid: string
  name: string
  blocks: unknown[]
}

type NormalizedApi = {
  uuid: string
  name: string
  method: string
  status: ApiStatus
  apiJson: Record<string, unknown>
  layout: Record<string, unknown>
}

export type AiDslAssetStore = {
  pageExists: (uuid: string) => Promise<boolean>
  savePage: (page: NormalizedPage, mode: SaveMode) => Promise<void>
  apiExists: (uuid: string) => Promise<boolean>
  saveApi: (api: NormalizedApi, mode: SaveMode) => Promise<void>
  createApiSnapshot: (api: NormalizedApi) => Promise<void>
}

class AiDslAssetItemError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'AiDslAssetItemError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === 'string' ? value[key].trim() : ''
}

function itemError(code: string, message: string): never {
  throw new AiDslAssetItemError(code, message)
}

function invalidResult(message: string): never {
  throw mokelayError(
    'BLOCK_AI_INPUT_INVALID',
    `AI_DSL_ASSETS_INVALID_RESULT: ${message}`,
    400,
  )
}

function cloneJson<T>(value: T, label: string): T {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      itemError('AI_DSL_ASSET_SAVE_FAILED', `${label} 不是可序列化 JSON。`)
    }
    return JSON.parse(serialized) as T
  } catch (error) {
    if (error instanceof AiDslAssetItemError) {
      throw error
    }
    itemError('AI_DSL_ASSET_SAVE_FAILED', `${label} 不是可序列化 JSON。`)
  }
}

function normalizeKnownUuids(value: unknown, pattern: RegExp) {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const uuid = item.trim()
    if (pattern.test(uuid)) seen.add(uuid)
  }
  return [...seen]
}

function normalizePage(value: unknown): NormalizedPage {
  if (!isRecord(value)) {
    itemError('AI_DSL_ASSET_SAVE_FAILED', 'page 必须是 object。')
  }

  const uuid = readString(value, 'uuid')
  if (!pageUuidPattern.test(uuid)) {
    itemError('AI_DSL_PAGE_UUID_INVALID', '页面 uuid 必须是合法 RFC UUID。')
  }

  const name = readString(value, 'name')
  if (!name || name.length > 120) {
    itemError('AI_DSL_ASSET_SAVE_FAILED', '页面 name 必须是 1 到 120 个字符。')
  }
  if (!Array.isArray(value.blocks)) {
    itemError('AI_DSL_ASSET_SAVE_FAILED', '页面 blocks 必须是数组。')
  }

  return {
    uuid,
    name,
    blocks: cloneJson(value.blocks, '页面 blocks'),
  }
}

function normalizeApi(value: unknown, status: ApiStatus): NormalizedApi {
  if (!isRecord(value)) {
    itemError('AI_DSL_ASSET_SAVE_FAILED', 'api 必须是 object。')
  }

  const uuid = readString(value, 'uuid')
  if (!apiUuidPattern.test(uuid)) {
    itemError('AI_DSL_API_UUID_INVALID', 'API uuid 不能为空且只能包含字母、数字、下划线或连字符。')
  }

  const method = readString(value, 'method').toUpperCase()
  if (!method || method.length > 16 || !apiMethodPattern.test(method)) {
    itemError('AI_DSL_ASSET_SAVE_FAILED', 'API method 必须是 1 到 16 个英文字母。')
  }

  const name = readString(value, 'alias') || readString(value, 'name') || uuid
  if (name.length > 120) {
    itemError('AI_DSL_ASSET_SAVE_FAILED', 'API 名称不能超过 120 个字符。')
  }

  const apiJson = cloneJson({
    ...value,
    uuid,
    method,
  }, 'API JSON')
  const layout = cloneJson(isRecord(value.layout) ? value.layout : {}, 'API layout')

  return {
    uuid,
    name,
    method,
    status,
    apiJson,
    layout,
  }
}

function fallbackTitle(type: AssetType, value: unknown, index: number) {
  if (type === 'page') {
    return readString(value, 'name') || readString(value, 'uuid') || `页面 ${index + 1}`
  }

  const method = readString(value, 'method').toUpperCase()
  const name = readString(value, 'alias') || readString(value, 'name') || readString(value, 'uuid') || `API ${index + 1}`
  return [method, name].filter(Boolean).join(' ')
}

function sourceUuid(value: unknown) {
  return readString(value, 'uuid')
}

function summaryError(error: unknown, type: AssetType) {
  if (error instanceof AiDslAssetItemError) {
    return `${error.code}: ${error.message}`
  }

  return `AI_DSL_ASSET_SAVE_FAILED: ${type === 'api' ? 'API' : '页面'}保存失败。`
}

async function savePageItem(
  value: unknown,
  index: number,
  knownUuids: Set<string>,
  store: AiDslAssetStore,
): Promise<SaveAiDslAssetItem> {
  const fallback = {
    type: 'page' as const,
    title: fallbackTitle('page', value, index),
    sourceUuid: sourceUuid(value),
  }

  try {
    const page = normalizePage(value)
    const exists = await store.pageExists(page.uuid)
    if (exists && !knownUuids.has(page.uuid)) {
      itemError('AI_DSL_ASSET_UUID_EXISTS', '页面 uuid 已存在且不属于当前会话。')
    }

    await store.savePage(page, exists ? 'update' : 'create')
    knownUuids.add(page.uuid)

    return {
      ...fallback,
      title: page.name,
      sourceUuid: page.uuid,
      savedUuid: page.uuid,
      href: `#/pages/${encodeURIComponent(page.uuid)}`,
      status: 'success',
    }
  } catch (error) {
    return {
      ...fallback,
      status: 'error',
      error: summaryError(error, 'page'),
    }
  }
}

async function saveApiItem(
  value: unknown,
  index: number,
  status: ApiStatus,
  knownUuids: Set<string>,
  store: AiDslAssetStore,
): Promise<SaveAiDslAssetItem> {
  const fallback = {
    type: 'api' as const,
    title: fallbackTitle('api', value, index),
    sourceUuid: sourceUuid(value),
  }

  try {
    const api = normalizeApi(value, status)
    const exists = await store.apiExists(api.uuid)
    if (exists && !knownUuids.has(api.uuid)) {
      itemError('AI_DSL_ASSET_UUID_EXISTS', 'API uuid 已存在且不属于当前会话。')
    }

    await store.saveApi(api, exists ? 'update' : 'create')
    await store.createApiSnapshot(api)
    knownUuids.add(api.uuid)

    return {
      ...fallback,
      title: api.name,
      sourceUuid: api.uuid,
      savedUuid: api.uuid,
      href: `#/apis/${encodeURIComponent(api.uuid)}`,
      status: 'success',
    }
  } catch (error) {
    return {
      ...fallback,
      status: 'error',
      error: summaryError(error, 'api'),
    }
  }
}

function summaryStatus(savedCount: number, failedCount: number): SummaryStatus {
  if (failedCount === 0) return 'complete'
  return savedCount === 0 ? 'error' : 'partial'
}

export async function saveAiDslAssets(
  inputs: Record<string, unknown>,
  store: AiDslAssetStore,
): Promise<SaveAiDslAssetsSummary> {
  if (!isRecord(inputs.generationResult)) {
    invalidResult('generationResult 必须是 object。')
  }

  const strategy = inputs.strategy === undefined ? strategyName : inputs.strategy
  if (strategy !== strategyName) {
    invalidResult(`strategy 仅支持 ${strategyName}。`)
  }

  const apiStatus = inputs.apiStatus === undefined ? 'draft' : inputs.apiStatus
  if (apiStatus !== 'draft' && apiStatus !== 'published') {
    invalidResult('apiStatus 仅支持 draft 或 published。')
  }

  const pages = Array.isArray(inputs.generationResult.pages) ? inputs.generationResult.pages : []
  const apis = Array.isArray(inputs.generationResult.apis) ? inputs.generationResult.apis : []
  const knownPageUuids = new Set(normalizeKnownUuids(inputs.knownPageUuids, pageUuidPattern))
  const knownApiUuids = new Set(normalizeKnownUuids(inputs.knownApiUuids, apiUuidPattern))
  const apiItems: SaveAiDslAssetItem[] = []
  const pageItems: SaveAiDslAssetItem[] = []

  for (let index = 0; index < apis.length; index += 1) {
    apiItems.push(await saveApiItem(apis[index], index, apiStatus, knownApiUuids, store))
  }
  for (let index = 0; index < pages.length; index += 1) {
    pageItems.push(await savePageItem(pages[index], index, knownPageUuids, store))
  }

  const items = [...apiItems, ...pageItems]
  const savedCount = items.filter(item => item.status === 'success').length
  const failedCount = items.length - savedCount

  return {
    status: summaryStatus(savedCount, failedCount),
    pages: pageItems,
    apis: apiItems,
    savedCount,
    failedCount,
    knownPageUuids: [...knownPageUuids],
    knownApiUuids: [...knownApiUuids],
  }
}

function jsonFieldSql(value: unknown, databaseType: DatabaseType) {
  const serialized = JSON.stringify(value)
  return databaseType === 'postgres'
    ? sql`${serialized}::jsonb`
    : sql`${serialized}`
}

export function createAiDslAssetSqlStore(
  executeSql: SqlExecutor,
  databaseType: DatabaseType,
): AiDslAssetStore {
  const pagesTable = sql.identifier('pages')
  const apisTable = sql.identifier('apis')
  const snapshotsTable = sql.identifier('apis_snapshot')

  return {
    async pageExists(uuid) {
      const result = await executeSql(sql`SELECT uuid FROM ${pagesTable} WHERE uuid = ${uuid} LIMIT 1`)
      return Boolean(result.rows[0])
    },
    async savePage(page, mode) {
      const blocks = jsonFieldSql(page.blocks, databaseType)
      if (mode === 'update') {
        await executeSql(sql`UPDATE ${pagesTable} SET name = ${page.name}, blocks = ${blocks}, updated_at = CURRENT_TIMESTAMP WHERE uuid = ${page.uuid}`)
        return
      }
      await executeSql(sql`INSERT INTO ${pagesTable} (uuid, name, blocks) VALUES (${page.uuid}, ${page.name}, ${blocks})`)
    },
    async apiExists(uuid) {
      const result = await executeSql(sql`SELECT uuid FROM ${apisTable} WHERE uuid = ${uuid} LIMIT 1`)
      return Boolean(result.rows[0])
    },
    async saveApi(api, mode) {
      const apiJson = jsonFieldSql(api.apiJson, databaseType)
      const layout = jsonFieldSql(api.layout, databaseType)
      if (mode === 'update') {
        await executeSql(sql`UPDATE ${apisTable} SET name = ${api.name}, method = ${api.method}, status = ${api.status}, api_json = ${apiJson}, layout = ${layout}, updated_at = CURRENT_TIMESTAMP WHERE uuid = ${api.uuid}`)
        return
      }
      await executeSql(sql`INSERT INTO ${apisTable} (uuid, name, method, status, api_json, layout) VALUES (${api.uuid}, ${api.name}, ${api.method}, ${api.status}, ${apiJson}, ${layout})`)
    },
    async createApiSnapshot(api) {
      const apiJson = jsonFieldSql(api.apiJson, databaseType)
      await executeSql(sql`INSERT INTO ${snapshotsTable} (api_uuid, name, method, status, api_json) VALUES (${api.uuid}, ${api.name}, ${api.method}, ${api.status}, ${apiJson})`)
    },
  }
}

function requireDatabaseType(value: DatabaseType | undefined): DatabaseType {
  if (value !== 'postgres' && value !== 'mysql') {
    throw mokelayError('BLOCK_DATASOURCE_UNSUPPORTED_DATABASE', 'saveAiDslAssets 未获得数据库类型。', 500)
  }
  return value
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "saveAiDslAssets",
 *   "displayName": "保存 AI DSL 生成资产",
 *   "category": "ai",
 *   "description": "按 create_or_update_known 策略保存 AI 生成的 APIs 和 Pages，为 API 创建快照，并返回逐项 partial-aware 摘要。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，通常为 Mokelay。" },
 *     { "key": "generationResult", "type": "object", "required": true, "description": "AI DSL 生成响应，读取 pages 和 apis 数组。" },
 *     { "key": "knownPageUuids", "type": "string[]", "required": false, "defaultValue": [], "description": "当前会话已保存的页面 uuid。" },
 *     { "key": "knownApiUuids", "type": "string[]", "required": false, "defaultValue": [], "description": "当前会话已保存的 API uuid。" },
 *     { "key": "apiStatus", "type": "draft|published", "required": false, "defaultValue": "draft", "description": "写入 apis 和快照的状态；不会发布到 R2。" },
 *     { "key": "strategy", "type": "create_or_update_known", "required": false, "defaultValue": "create_or_update_known", "description": "新 uuid 创建、已知 uuid 更新、未知冲突逐项失败。" }
 *   ],
 *   "outputs": [
 *     { "key": "saveSummary", "type": "SaveAiDslAssetsSummary", "description": "逐项结果、汇总状态、成功/失败计数及更新后的 known uuid。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_AI_INPUT_INVALID", "description": "generationResult、strategy 或 apiStatus 整体输入非法；消息包含 AI_DSL_ASSETS_INVALID_RESULT。" },
 *     { "code": "AI_DSL_PAGE_UUID_INVALID", "description": "单个页面 uuid 非法，写入 item.error。" },
 *     { "code": "AI_DSL_API_UUID_INVALID", "description": "单个 API uuid 非法，写入 item.error。" },
 *     { "code": "AI_DSL_ASSET_UUID_EXISTS", "description": "uuid 已存在但不在 known 列表，写入 item.error。" },
 *     { "code": "AI_DSL_ASSET_SAVE_FAILED", "description": "单项结构或数据库写入失败，写入 item.error。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，仅访问固定 pages、apis、apis_snapshot 表。" },
 *     { "key": "partialSuccess", "type": "boolean", "value": true, "description": "单项失败不会中断同批其他资产。" },
 *     { "key": "globalTransaction", "type": "boolean", "value": false, "description": "v1 不使用跨资产全局事务。" }
 *   ],
 *   "examples": [
 *     { "title": "保存 AI 生成资产", "block": { "uuid": "save_ai_dsl_assets_block", "functionName": "saveAiDslAssets", "inputs": { "datasource": "Mokelay", "generationResult": { "template": "{{request.body.generationResult}}" }, "knownPageUuids": { "template": "{{request.body.knownPageUuids}}" }, "knownApiUuids": { "template": "{{request.body.knownApiUuids}}" }, "apiStatus": "draft", "strategy": "create_or_update_known" }, "outputs": ["saveSummary"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeSaveAiDslAssetsBlock: BlockExecutor = async ({
  inputs,
  executeSql,
  databaseType,
}) => {
  const store = createAiDslAssetSqlStore(executeSql, requireDatabaseType(databaseType))
  return {
    saveSummary: await saveAiDslAssets(inputs, store),
  }
}
