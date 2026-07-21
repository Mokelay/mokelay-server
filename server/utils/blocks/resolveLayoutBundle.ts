import { sql } from 'drizzle-orm'
import type { BlockExecutor, SqlExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import {
  identifierSql,
  isRecord,
  requireDatabaseType,
} from 'mokelay-server-core/utils/blocks/shared'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import { readSessionValue } from 'mokelay-server-core/utils/session'
import { readMokelayPageJson } from './readMokelayPageJson'
import { readMokelayLayoutJson } from './readMokelayLayoutJson'
import { mergeSystemPageRelations } from '../pageRelationStore'
import { requireUserPageUuid } from '../pageRelations'

type LayoutBundleRow = Record<string, unknown>

function readRequiredString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('REQUEST_PARAMETER_MISSING', `${name} 必须是非空字符串。`, 400)
  }

  return value.trim()
}

function readString(value: unknown) {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  return undefined
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function normalizeBlocks(value: unknown) {
  const parsed = parseJsonValue(value)
  return Array.isArray(parsed) ? parsed : []
}

function normalizeLayoutJson(value: unknown) {
  const parsed = parseJsonValue(value)
  return isRecord(parsed) ? parsed : {}
}

function normalizeLayout(
  row: LayoutBundleRow,
  prefix: 'page_layout' | 'app_layout',
) {
  const uuid = readString(row[`${prefix}_uuid`])

  if (!uuid) {
    return null
  }

  const layoutJson = normalizeLayoutJson(row[`${prefix}_json`])
  const name = readString(row[`${prefix}_name`]) ?? readString(layoutJson.name) ?? ''
  const blocks = Array.isArray(layoutJson.blocks) ? layoutJson.blocks : []
  const schemaVersion = typeof layoutJson.schemaVersion === 'number' ? layoutJson.schemaVersion : 1

  return {
    ...layoutJson,
    schemaVersion,
    uuid,
    name,
    blocks,
    createdAt: readString(row[`${prefix}_created_at`]) ?? readString(layoutJson.createdAt),
    updatedAt: readString(row[`${prefix}_updated_at`]) ?? readString(layoutJson.updatedAt),
  }
}

function normalizeAssetLayout(record: {
  uuid?: unknown
  name?: unknown
  layoutJson?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}) {
  const uuid = readString(record.uuid)

  if (!uuid) {
    return null
  }

  const layoutJson = normalizeLayoutJson(record.layoutJson)
  const name = readString(record.name) ?? readString(layoutJson.name) ?? ''
  const blocks = Array.isArray(layoutJson.blocks) ? layoutJson.blocks : []
  const schemaVersion = typeof layoutJson.schemaVersion === 'number' ? layoutJson.schemaVersion : 1

  return {
    ...layoutJson,
    schemaVersion,
    uuid,
    name,
    blocks,
    createdAt: readString(record.createdAt) ?? readString(layoutJson.createdAt),
    updatedAt: readString(record.updatedAt) ?? readString(layoutJson.updatedAt),
  }
}

function normalizePage(row: LayoutBundleRow) {
  const uuid = readString(row.page_uuid)

  if (!uuid) {
    return null
  }

  return {
    uuid,
    name: readString(row.page_name) ?? '',
    blocks: normalizeBlocks(row.page_blocks),
    localeConfig: normalizeLayoutJson(row.page_locale_config),
    appUuid: readString(row.page_app_uuid) ?? null,
    layoutUuid: readString(row.page_layout_uuid_value) ?? null,
    subPage: row.page_sub_page === true || row.page_sub_page === 1 || row.page_sub_page === '1' || row.page_sub_page === 'true',
    quotes: normalizeBlocks(row.page_quotes).filter((item): item is string => typeof item === 'string'),
    dependencies: normalizeBlocks(row.page_dependencies).filter((item): item is string => typeof item === 'string'),
    createdAt: readString(row.page_created_at),
    updatedAt: readString(row.page_updated_at),
  }
}

async function resolveUserPageBundle(pageUuid: string, enterpriseUuid: string, executeSql: SqlExecutor) {
  const pagesTable = identifierSql('pages', 'table', 'BLOCK_INVALID_TABLE')
  const appsTable = identifierSql('apps', 'table', 'BLOCK_INVALID_TABLE')
  const layoutsTable = identifierSql('layouts', 'table', 'BLOCK_INVALID_TABLE')

  const pageResult = await executeSql(sql`
    SELECT
      ${identifierSql('uuid', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_uuid')},
      ${identifierSql('name', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_name')},
      ${identifierSql('blocks', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_blocks')},
      ${identifierSql('app_uuid', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_app_uuid')},
      ${identifierSql('layout_uuid', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_layout_uuid_value')},
      ${identifierSql('sub_page', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_sub_page')},
      ${identifierSql('quotes', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_quotes')},
      ${identifierSql('dependencies', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_dependencies')},
      ${identifierSql('locale_config', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_locale_config')},
      ${identifierSql('created_at', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_created_at')},
      ${identifierSql('updated_at', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_updated_at')}
    FROM ${pagesTable}
    WHERE ${identifierSql('uuid', 'fields', 'BLOCK_INVALID_FIELDS')} = ${pageUuid}
      AND ${identifierSql('enterprise_uuid', 'fields', 'BLOCK_INVALID_FIELDS')} = ${enterpriseUuid}
    LIMIT 1
  `)
  const row = pageResult.rows[0] ?? {}
  const page = normalizePage(row)

  if (!page) {
    return { page: null, layout: null }
  }

  const pageLayout = await readLayoutByUuid(page.layoutUuid, 'page_layout', layoutsTable, executeSql)
  if (pageLayout) {
    return { page, layout: pageLayout }
  }

  const appDefaultLayoutUuid = await readAppDefaultLayoutUuid(page.appUuid, appsTable, executeSql)
  const appLayout = await readLayoutByUuid(appDefaultLayoutUuid, 'app_layout', layoutsTable, executeSql)

  return { page, layout: appLayout }
}

async function resolveSystemPageBundle(pageUuid: string, executeSql: SqlExecutor) {
  const staticPage = await readMokelayPageJson(pageUuid) as Record<string, unknown>
  const page = (await mergeSystemPageRelations([staticPage], executeSql))[0]
  const layoutsTable = identifierSql('layouts', 'table', 'BLOCK_INVALID_TABLE')
  const layoutUuid = readPageLayoutUuid(page)
  const layout = await readSystemLayoutByUuid(layoutUuid, layoutsTable, executeSql)

  return { page, layout }
}

function readErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return undefined
  const data = 'data' in error ? error.data : undefined
  if (typeof data !== 'object' || data === null) return undefined
  const code = 'code' in data ? data.code : undefined
  return typeof code === 'string' ? code : undefined
}

function readPageLayoutUuid(page: unknown) {
  if (!isRecord(page)) return null
  return readString(page.layoutUuid) ?? readString(page.layout_uuid) ?? null
}

async function readAppDefaultLayoutUuid(
  appUuid: string | null,
  appsTable: ReturnType<typeof identifierSql>,
  executeSql: SqlExecutor,
) {
  if (!appUuid) return null

  const result = await executeSql(sql`
    SELECT
      ${identifierSql('default_layout_uuid', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('app_default_layout_uuid')}
    FROM ${appsTable}
    WHERE ${identifierSql('uuid', 'fields', 'BLOCK_INVALID_FIELDS')} = ${appUuid}
    LIMIT 1
  `)

  return readString(result.rows[0]?.app_default_layout_uuid) ?? null
}

async function readLayoutByUuid(
  layoutUuid: string | null,
  prefix: 'page_layout' | 'app_layout',
  layoutsTable: ReturnType<typeof identifierSql>,
  executeSql: SqlExecutor,
) {
  if (!layoutUuid) return null

  const result = await executeSql(sql`
    SELECT
      ${identifierSql('uuid', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier(`${prefix}_uuid`)},
      ${identifierSql('name', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier(`${prefix}_name`)},
      ${identifierSql('layout_json', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier(`${prefix}_json`)},
      ${identifierSql('created_at', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier(`${prefix}_created_at`)},
      ${identifierSql('updated_at', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier(`${prefix}_updated_at`)}
    FROM ${layoutsTable}
    WHERE ${identifierSql('uuid', 'fields', 'BLOCK_INVALID_FIELDS')} = ${layoutUuid}
    LIMIT 1
  `)

  return normalizeLayout(result.rows[0] ?? {}, prefix)
}

async function readSystemLayoutByUuid(
  layoutUuid: string | null,
  layoutsTable: ReturnType<typeof identifierSql>,
  executeSql: SqlExecutor,
) {
  if (!layoutUuid) return null

  try {
    const assetLayout = await readMokelayLayoutJson(layoutUuid)
    return normalizeAssetLayout(assetLayout)
  } catch (error) {
    if (readErrorCode(error) !== 'API_JSON_NOT_FOUND') {
      throw error
    }
  }

  return await readLayoutByUuid(layoutUuid, 'page_layout', layoutsTable, executeSql)
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "resolveLayoutBundle",
 *   "displayName": "解析页面布局包",
 *   "category": "asset",
 *   "description": "按页面 uuid 和来源解析页面 JSON 及其布局 JSON，系统页面优先读资产，用户页面读数据库并回退 app 默认布局。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "Mokelay 数据源，对应 ${datasource}_DATABASE_URL。" },
 *     { "key": "uuid", "type": "string", "required": true, "description": "页面 uuid。" },
 *     { "key": "source", "type": "user|system", "required": false, "defaultValue": "user", "description": "页面来源；system 读取系统页面资产，其他值按用户页面处理。" }
 *   ],
 *   "outputs": [
 *     { "key": "page", "type": "PageBundle|null", "description": "标准化后的页面数据；未命中用户页面时为 null。" },
 *     { "key": "layout", "type": "LayoutBundle|null", "description": "页面布局；无匹配布局时为 null。" }
 *   ],
 *   "errors": [
 *     { "code": "REQUEST_PARAMETER_MISSING", "description": "uuid 不是非空字符串。" },
 *     { "code": "BLOCK_DATABASE_TYPE_MISSING", "description": "执行器未获得数据库类型。" },
 *     { "code": "API_JSON_NOT_FOUND", "description": "system 页面资产不存在。" },
 *     { "code": "BLOCK_INVALID_TABLE", "description": "内部表名标识符校验失败。" },
 *     { "code": "BLOCK_INVALID_FIELDS", "description": "内部字段标识符校验失败。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要 datasource，读取 pages/apps/layouts 表并在 system layout 缺失时回退数据库。" },
 *     { "key": "assetFallback", "type": "string", "value": "mokelay-pages/mokelay-layouts", "description": "system source 会读取系统页面与布局资产。" }
 *   ],
 *   "examples": [
 *     { "title": "解析系统页面 bundle", "block": { "uuid": "resolve_layout_bundle_block", "functionName": "resolveLayoutBundle", "inputs": { "datasource": "Mokelay", "uuid": { "template": "{{request.query.uuid}}" }, "source": "system" }, "outputs": ["page", "layout"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeResolveLayoutBundleBlock: BlockExecutor = async ({ inputs, executeSql, databaseType, event }) => {
  requireDatabaseType(databaseType)

  const pageUuid = readRequiredString(inputs.uuid, 'uuid')
  const source = typeof inputs.source === 'string' && inputs.source.trim() ? inputs.source.trim() : 'user'

  if (source === 'system') {
    return await resolveSystemPageBundle(pageUuid, executeSql)
  }

  const user = event ? readSessionValue(event, 'user') : { enterprise_uuid: '' }
  const enterpriseUuid = typeof user === 'object' && user !== null && !Array.isArray(user)
    ? (user as Record<string, unknown>).enterprise_uuid
    : undefined
  if (event && (typeof enterpriseUuid !== 'string' || !enterpriseUuid)) {
    throw mokelayError('BLOCK_SESSION_KEY_NOT_FOUND', '请先登录。', 401)
  }
  return await resolveUserPageBundle(requireUserPageUuid(pageUuid), String(enterpriseUuid ?? ''), executeSql)
}
