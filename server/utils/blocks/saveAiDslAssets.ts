import { sql } from 'drizzle-orm'
import type { DatabaseType } from 'mokelay-server-core/utils/db'
import type { TransactionRunner } from 'mokelay-server-core/utils/db'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import { parseApiJson, type BlockExecutor, type SqlExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { loadSystemPageNodes, savePageBatchWithRelations } from '../pageRelationStore'
import { normalizeUserPageUuid } from '../pageReferenceGraph'
import { validateApiDefinition } from './apiDefinitions'
import { getMokelayApiAssetStorage } from './listMokelayApiJsons'

const apiUuidPattern = /^[A-Za-z0-9_-]{1,128}$/
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
  subPage: boolean
  quotes: string[]
  dependencies: string[]
}

type NormalizedApi = {
  uuid: string
  name: string
  method: string
  fragment: boolean
  status: ApiStatus
  apiJson: Record<string, unknown>
  layout: Record<string, unknown>
}

export type AiDslAssetStore = {
  pageExists: (uuid: string) => Promise<boolean>
  savePage: (page: NormalizedPage, mode: SaveMode) => Promise<void>
  savePageBatch?: (pages: Array<{ page: NormalizedPage; mode: SaveMode }>) => Promise<void>
  apiExists: (uuid: string) => Promise<boolean>
  validateApi?: (api: NormalizedApi) => Promise<void>
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

function normalizeKnownUuids(value: unknown, normalize: (value: string) => string | undefined) {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const uuid = normalize(item)
    if (uuid) seen.add(uuid)
  }
  return [...seen]
}

function normalizePageRelationArray(value: unknown, field: 'quotes' | 'dependencies') {
  if (!Array.isArray(value)) {
    itemError('AI_DSL_ASSET_SAVE_FAILED', `页面 ${field} 必须是数组。`)
  }
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      itemError('AI_DSL_ASSET_SAVE_FAILED', `页面 ${field} 只能包含非空字符串。`)
    }
    const uuid = normalizeUserPageUuid(item)
    if (!uuid) {
      itemError(
        'AI_DSL_ASSET_SAVE_FAILED',
        `页面 ${field} 只能包含 1 到 128 位小写 Slug。`,
      )
    }
    if (seen.has(uuid)) {
      itemError('AI_DSL_ASSET_SAVE_FAILED', `页面 ${field} 不能包含重复 UUID。`)
    }
    seen.add(uuid)
    normalized.push(uuid)
  }
  return normalized
}

function normalizePage(value: unknown): NormalizedPage {
  if (!isRecord(value)) {
    itemError('AI_DSL_ASSET_SAVE_FAILED', 'page 必须是 object。')
  }

  const rawUuid = readString(value, 'uuid')
  const uuid = normalizeUserPageUuid(rawUuid)
  if (!uuid) {
    itemError(
      'AI_DSL_PAGE_UUID_INVALID',
      '页面 uuid 必须是 1 到 128 位小写 Slug，只能包含字母、数字、下划线或连字符。',
    )
  }

  const name = readString(value, 'name')
  if (!name || name.length > 120) {
    itemError('AI_DSL_ASSET_SAVE_FAILED', '页面 name 必须是 1 到 120 个字符。')
  }
  if (!Array.isArray(value.blocks)) {
    itemError('AI_DSL_ASSET_SAVE_FAILED', '页面 blocks 必须是数组。')
  }
  if (typeof value.subPage !== 'boolean') {
    itemError('AI_DSL_ASSET_SAVE_FAILED', '页面 subPage 必须是 boolean。')
  }
  const quotes = normalizePageRelationArray(value.quotes, 'quotes')
  const dependencies = normalizePageRelationArray(value.dependencies, 'dependencies')

  return {
    uuid,
    name,
    blocks: cloneJson(value.blocks, '页面 blocks'),
    subPage: value.subPage,
    quotes,
    dependencies,
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

  if ('fragment' in value && typeof value.fragment !== 'boolean') {
    itemError('AI_DSL_ASSET_SAVE_FAILED', 'API fragment 必须是 boolean。')
  }
  const fragment = value.fragment === true
  const inputMethod = readString(value, 'method').toUpperCase()
  const method = fragment ? 'FRAGMENT' : inputMethod
  if ((!fragment && (!method || method.length > 16 || !apiMethodPattern.test(method)))
    || (fragment && inputMethod && inputMethod !== 'FRAGMENT')) {
    itemError('AI_DSL_ASSET_SAVE_FAILED', '普通 API method 必须是 1 到 16 个英文字母；Fragment 不允许配置 method。')
  }

  const name = readString(value, 'alias') || readString(value, 'name') || uuid
  if (name.length > 120) {
    itemError('AI_DSL_ASSET_SAVE_FAILED', 'API 名称不能超过 120 个字符。')
  }

  const { layout: _layout, name: _name, method: _method, ...dslValue } = value
  const apiJsonCandidate = cloneJson({
    ...dslValue,
    uuid,
    ...(fragment ? { fragment: true } : { method }),
  }, 'API JSON')
  const apiJson = cloneJson(
    status === 'published' ? parseApiJson(uuid, apiJsonCandidate) : apiJsonCandidate,
    'API JSON',
  ) as Record<string, unknown>
  const layout = cloneJson(isRecord(value.layout) ? value.layout : {}, 'API layout')

  return {
    uuid,
    name,
    method,
    fragment,
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
  if (isRecord(error) && isRecord(error.data) && typeof error.data.code === 'string') {
    const message = typeof error.message === 'string' ? error.message : `${type === 'api' ? 'API' : '页面'}保存失败。`
    return `${error.data.code}: ${message}`
  }

  return `AI_DSL_ASSET_SAVE_FAILED: ${type === 'api' ? 'API' : '页面'}保存失败。`
}

async function savePageItemsBatch(
  values: unknown[],
  knownUuids: Set<string>,
  store: AiDslAssetStore,
): Promise<SaveAiDslAssetItem[]> {
  const items: SaveAiDslAssetItem[] = new Array(values.length)
  const candidates: Array<{ index: number; page: NormalizedPage; mode: SaveMode }> = []
  let invalid = false

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
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
      candidates.push({ index, page, mode: exists ? 'update' : 'create' })
    } catch (error) {
      invalid = true
      items[index] = { ...fallback, status: 'error', error: summaryError(error, 'page') }
    }
  }

  if (invalid) {
    for (const candidate of candidates) {
      items[candidate.index] = {
        type: 'page',
        title: candidate.page.name,
        sourceUuid: candidate.page.uuid,
        status: 'error',
        error: 'AI_DSL_ASSET_BATCH_ABORTED: 页面批次包含无效项目，未写入任何页面。',
      }
    }
    return items
  }

  try {
    if (store.savePageBatch) {
      await store.savePageBatch(candidates.map(({ page, mode }) => ({ page, mode })))
    }
    else {
      // Compatibility for pure/in-memory adapters: validation still completes
      // for the entire batch before the first write. Production injects the
      // graph-transaction batch implementation.
      for (const candidate of candidates) await store.savePage(candidate.page, candidate.mode)
    }
    for (const candidate of candidates) {
      knownUuids.add(candidate.page.uuid)
      items[candidate.index] = {
        type: 'page',
        title: candidate.page.name,
        sourceUuid: candidate.page.uuid,
        savedUuid: candidate.page.uuid,
        href: `#/pages/${encodeURIComponent(candidate.page.uuid)}`,
        status: 'success',
      }
    }
  } catch (error) {
    for (const candidate of candidates) {
      items[candidate.index] = {
        type: 'page',
        title: candidate.page.name,
        sourceUuid: candidate.page.uuid,
        status: 'error',
        error: summaryError(error, 'page'),
      }
    }
  }
  return items
}

async function saveApiItem(
  value: unknown,
  index: number,
  status: ApiStatus,
  knownUuids: Set<string>,
  systemApiUuids: ReadonlySet<string>,
  store: AiDslAssetStore,
): Promise<SaveAiDslAssetItem> {
  const fallback = {
    type: 'api' as const,
    title: fallbackTitle('api', value, index),
    sourceUuid: sourceUuid(value),
  }

  try {
    const api = normalizeApi(value, status)
    if (systemApiUuids.has(api.uuid)) {
      itemError('AI_DSL_ASSET_UUID_EXISTS', 'API uuid 与系统 API 资产冲突。')
    }
    const exists = await store.apiExists(api.uuid)
    if (exists && !knownUuids.has(api.uuid)) {
      itemError('AI_DSL_ASSET_UUID_EXISTS', 'API uuid 已存在且不属于当前会话。')
    }

    await store.validateApi?.(api)
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
  systemApiUuids: ReadonlySet<string> = new Set(),
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
  const knownPageUuids = new Set(normalizeKnownUuids(inputs.knownPageUuids, normalizeUserPageUuid))
  const knownApiUuids = new Set(normalizeKnownUuids(inputs.knownApiUuids, (value) => {
    const uuid = value.trim()
    return apiUuidPattern.test(uuid) ? uuid : undefined
  }))
  const initialKnownApiUuids = [...knownApiUuids]
  const apiItems: SaveAiDslAssetItem[] = new Array(apis.length)
  const pageItems: SaveAiDslAssetItem[] = []

  // Fragment definitions must be persisted before callers from the same AI
  // batch are validated, including drafts whose targets must already exist in
  // the database. Fragment DSL cannot invoke another Fragment, so a stable
  // two-phase order is sufficient and keeps results aligned with input order.
  const apiIndexes = apis.map((_value, index) => index)
  apiIndexes.sort((left, right) => {
    const leftIsFragment = isRecord(apis[left]) && apis[left].fragment === true
    const rightIsFragment = isRecord(apis[right]) && apis[right].fragment === true
    return Number(rightIsFragment) - Number(leftIsFragment)
  })
  for (const index of apiIndexes) {
    apiItems[index] = await saveApiItem(apis[index], index, apiStatus, knownApiUuids, systemApiUuids, store)
  }
  pageItems.push(...await savePageItemsBatch(pages, knownPageUuids, store))

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
    knownApiUuids: [...new Set([
      ...initialKnownApiUuids,
      ...apiItems.flatMap(item => item.status === 'success' && item.savedUuid ? [item.savedUuid] : []),
    ])],
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
  savePageOverride?: AiDslAssetStore['savePage'],
  savePageBatchOverride?: AiDslAssetStore['savePageBatch'],
): AiDslAssetStore {
  const pagesTable = sql.identifier('pages')
  const apisTable = sql.identifier('apis')
  const snapshotsTable = sql.identifier('apis_snapshot')

  return {
    ...(savePageBatchOverride ? { savePageBatch: savePageBatchOverride } : {}),
    async pageExists(uuid) {
      const result = await executeSql(sql`SELECT uuid FROM ${pagesTable} WHERE uuid = ${uuid} LIMIT 1`)
      return Boolean(result.rows[0])
    },
    async savePage(page, mode) {
      if (savePageOverride) {
        await savePageOverride(page, mode)
        return
      }
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
    async validateApi(api) {
      await validateApiDefinition({
        datasource: 'Mokelay',
        uuid: api.uuid,
        originalUuid: api.uuid,
        method: api.method,
        fragment: api.fragment,
        status: api.status,
        apiJson: api.apiJson,
      }, executeSql)
    },
    async saveApi(api, mode) {
      const apiJson = jsonFieldSql(api.apiJson, databaseType)
      const layout = jsonFieldSql(api.layout, databaseType)
      if (mode === 'update') {
        await executeSql(sql`UPDATE ${apisTable} SET name = ${api.name}, method = ${api.method}, fragment = ${api.fragment}, status = ${api.status}, api_json = ${apiJson}, layout = ${layout}, updated_at = CURRENT_TIMESTAMP WHERE uuid = ${api.uuid}`)
        return
      }
      await executeSql(sql`INSERT INTO ${apisTable} (uuid, name, method, fragment, status, api_json, layout) VALUES (${api.uuid}, ${api.name}, ${api.method}, ${api.fragment}, ${api.status}, ${apiJson}, ${layout})`)
    },
    async createApiSnapshot(api) {
      const apiJson = jsonFieldSql(api.apiJson, databaseType)
      await executeSql(sql`INSERT INTO ${snapshotsTable} (api_uuid, name, method, fragment, status, api_json) VALUES (${api.uuid}, ${api.name}, ${api.method}, ${api.fragment}, ${api.status}, ${apiJson})`)
    },
  }
}

function requireDatabaseType(value: DatabaseType | undefined): DatabaseType {
  if (value !== 'postgres' && value !== 'mysql') {
    throw mokelayError('BLOCK_DATASOURCE_UNSUPPORTED_DATABASE', 'saveAiDslAssets 未获得数据库类型。', 500)
  }
  return value
}

function requireTransactionRunner(value: TransactionRunner | undefined): TransactionRunner {
  if (!value) {
    throw mokelayError('BLOCK_SQL_UNSUPPORTED', 'saveAiDslAssets 未获得事务执行器。', 500)
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
 *   "description": "把 AI 生成响应中的 APIs 和 Pages 保存到 Mokelay 数据库。API 逐项保存并创建快照；draft 与 published 批次都会先保存 Fragment 再校验 caller，同时结果保持输入顺序。所有合法 Page 候选先组成最终引用图，再在单一事务中批量保存，支持批内前向引用，任一 Page 非法、图校验或 SQL 失败都会中止整批 Page。固定策略 create_or_update_known 会创建新 uuid、更新当前会话 known 列表中的既有 uuid，并拒绝覆盖会话外同名资产。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "数据源名称，通常为 Mokelay；Block 注册为 requiresDatasource=true。" },
 *     {
 *       "key": "generationResult",
 *       "type": "object",
 *       "required": true,
 *       "description": "AI DSL 生成响应。缺失或非 object 属于顶层输入错误；pages/apis 缺失或非数组时分别按空数组处理。",
 *       "fields": [
 *         { "key": "pages", "type": "unknown[]", "required": false, "defaultValue": [], "description": "页面项必须包含 1 到 128 位小写 Slug、1 到 120 字符的 name、blocks 数组、boolean subPage，以及由唯一小写 Slug 组成的 quotes/dependencies 数组；三个关系字段作为服务端完整图计算结果的一致性断言。" },
 *         { "key": "apis", "type": "unknown[]", "required": false, "defaultValue": [], "description": "API 项至少需要安全 uuid、1 到 16 位字母 method；alias/name 可选，layout 非 object 时按 {}。" }
 *       ]
 *     },
 *     { "key": "knownPageUuids", "type": "string[]", "required": false, "defaultValue": [], "description": "当前会话允许更新的页面 uuid；非法值和重复值被忽略，成功创建/更新后追加到输出。" },
 *     { "key": "knownApiUuids", "type": "string[]", "required": false, "defaultValue": [], "description": "当前会话允许更新的 API uuid；非法值和重复值被忽略，成功创建/更新后追加到输出。" },
 *     { "key": "apiStatus", "type": "draft|published", "required": false, "defaultValue": "draft", "description": "写入 apis 与 apis_snapshot 的数据库状态。即使为 published，本 Block 也不会调用 R2 发布。" },
 *     { "key": "strategy", "type": "create_or_update_known", "required": false, "defaultValue": "create_or_update_known", "description": "v1 唯一策略：不存在则创建，存在且位于 known 列表则更新，存在但未知则记录单项冲突。" }
 *   ],
 *   "outputs": [
 *     {
 *       "key": "saveSummary",
 *       "type": "SaveAiDslAssetsSummary",
 *       "description": "逐项结果、汇总状态、成功/失败计数及更新后的 known uuid。",
 *       "fields": [
 *         { "key": "status", "type": "complete|partial|error", "description": "无失败为 complete；成功和失败并存为 partial；全部失败为 error。空输入结果为 complete。" },
 *         { "key": "pages", "type": "SaveAiDslAssetItem[]", "description": "与 generationResult.pages 顺序一致的页面保存结果。" },
 *         { "key": "apis", "type": "SaveAiDslAssetItem[]", "description": "与 generationResult.apis 顺序一致的 API 保存结果。" },
 *         { "key": "savedCount", "type": "number", "description": "status=success 的页面和 API 总数。" },
 *         { "key": "failedCount", "type": "number", "description": "status=error 的页面和 API 总数。" },
 *         { "key": "knownPageUuids", "type": "string[]", "description": "规范化输入 known 列表与本次成功页面 uuid 的去重合集。" },
 *         { "key": "knownApiUuids", "type": "string[]", "description": "规范化输入 known 列表与本次成功 API uuid 的去重合集。" }
 *       ],
 *       "itemShape": { "type": "page|api", "title": "string", "sourceUuid": "string", "savedUuid": "string?", "href": "string?", "status": "success|error", "error": "string?" }
 *     }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_AI_INPUT_INVALID", "description": "generationResult、strategy 或 apiStatus 顶层输入非法；消息以 AI_DSL_ASSETS_INVALID_RESULT 开头，Block 直接失败且不处理资产。" },
 *     { "code": "BLOCK_DATASOURCE_UNSUPPORTED_DATABASE", "description": "执行器未获得 postgres 或 mysql 数据库类型，Block 直接失败。" },
 *     { "code": "AI_DSL_PAGE_UUID_INVALID", "description": "单个页面 uuid 非法；不是 HTTP 顶层错误，但会中止整个 Page 批次且不写入任何页面。" },
 *     { "code": "AI_DSL_API_UUID_INVALID", "description": "单个 API uuid 非法；写入对应 item.error 后继续。" },
 *     { "code": "AI_DSL_ASSET_UUID_EXISTS", "description": "uuid 已存在但不在对应 known 列表；拒绝覆盖并写入 item.error。" },
 *     { "code": "AI_DSL_ASSET_SAVE_FAILED", "description": "结构、JSON 序列化或数据库写入失败；API 维持逐项结果，任一 Page 结构/图/SQL 失败会中止整个 Page 批次。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，仅访问固定 pages、apis、apis_snapshot 表。" },
 *     { "key": "partialSuccess", "type": "boolean", "value": true, "description": "API 维持逐项结果；Page 以整批为原子单元。" },
 *     { "key": "processingOrder", "type": "string", "value": "apis_then_page_graph_batch", "description": "先按输入顺序保存 API，再一次性校验并保存完整 Page 图。" },
 *     { "key": "pageBatchTransaction", "type": "boolean", "value": true, "description": "Page 候选共享一个引用图事务，支持批内前向引用且全成全败。" },
 *     { "key": "globalTransaction", "type": "boolean", "value": false, "description": "API 与 Page 批次之间没有跨资产全局事务；API 快照失败不会回滚先前成功的其他 API。" },
 *     { "key": "r2Publish", "type": "boolean", "value": false, "description": "不调用 saveJsonToR2；apiStatus 只影响数据库记录和快照。" }
 *   ],
 *   "examples": [
 *     { "title": "保存 AI 生成资产", "block": { "uuid": "save_ai_dsl_assets_block", "functionName": "saveAiDslAssets", "inputs": { "datasource": "Mokelay", "generationResult": { "template": "{{request.body.generationResult}}" }, "knownPageUuids": { "template": "{{request.body.knownPageUuids}}" }, "knownApiUuids": { "template": "{{request.body.knownApiUuids}}" }, "apiStatus": "draft", "strategy": "create_or_update_known" }, "outputs": ["saveSummary"], "nextBlock": null } },
 *     { "title": "允许更新当前会话已保存资产", "input": { "generationResult": { "pages": [{ "uuid": "customer_orders", "subPage": false, "quotes": [], "dependencies": [], "name": "客户列表", "blocks": [] }], "apis": [] }, "knownPageUuids": ["customer_orders"], "knownApiUuids": [], "apiStatus": "draft", "strategy": "create_or_update_known" }, "result": "若页面已存在则更新；若不在 knownPageUuids 中则返回单项 AI_DSL_ASSET_UUID_EXISTS。" }
 *   ]
 * }
 */
export const executeSaveAiDslAssetsBlock: BlockExecutor = async ({
  inputs,
  executeSql,
  databaseType,
  withTransaction,
}) => {
  const resolvedDatabaseType = requireDatabaseType(databaseType)
  const transactionRunner = requireTransactionRunner(withTransaction)
  const systemNodes = await loadSystemPageNodes()
  const apiAssetStorage = await getMokelayApiAssetStorage()
  const systemApiUuids = new Set((await apiAssetStorage.getKeys('mokelay-apis')).flatMap((key) => {
    const normalized = key.replaceAll('\\', '/').replaceAll(':', '/')
    const match = /^mokelay-apis\/([A-Za-z0-9_-]{1,128})\.json$/.exec(normalized)
    return match?.[1] ? [match[1]] : []
  }))
  const store = createAiDslAssetSqlStore(executeSql, resolvedDatabaseType, undefined, async entries => {
    await savePageBatchWithRelations(
      entries.map(({ page, mode }) => ({
        mode,
        uuid: page.uuid,
        name: page.name,
        blocks: page.blocks,
        subPage: page.subPage,
        quotes: page.quotes,
        dependencies: page.dependencies,
      })),
      resolvedDatabaseType,
      transactionRunner,
      systemNodes,
    )
  })
  return {
    saveSummary: await saveAiDslAssets(inputs, store, systemApiUuids),
  }
}
