import type { DatabaseType, TransactionRunner } from 'mokelay-server-core/utils/db'
import { sql } from 'drizzle-orm'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import type { BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { readSessionValue } from 'mokelay-server-core/utils/session'
import {
  deletePagesWithRelations,
  normalizeUserPage,
  savePageWithRelations,
  type PageSaveInput,
} from '../pageRelationStore'
import { requireUserPageUuid } from '../pageRelations'

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "normalizePageUuid",
 *   "displayName": "规范化用户页面标识",
 *   "category": "transform",
 *   "description": "把用户页面标识去除首尾空格并转为小写，随后校验为 1 到 128 位 Slug。",
 *   "inputs": [
 *     { "key": "uuid", "type": "string", "required": true, "description": "待规范化的用户页面标识。" },
 *     { "key": "optional", "type": "boolean", "required": false, "defaultValue": false, "description": "为 true 且 uuid 为空时返回空字符串，供可选查询条件使用。" }
 *   ],
 *   "outputs": [
 *     { "key": "uuid", "type": "string", "description": "规范化后的小写页面 Slug。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_PAGE_UUID_INVALID", "description": "页面标识为空、超过 128 位或包含非法字符。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "纯输入规范化，不访问数据库。" }
 *   ],
 *   "examples": [
 *     { "title": "规范化详情查询标识", "block": { "uuid": "normalize_page_uuid", "functionName": "normalizePageUuid", "inputs": { "uuid": " Customer_Orders " }, "outputs": ["uuid"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeNormalizePageUuidBlock: BlockExecutor = async ({ inputs }) => {
  if (inputs.optional === true && (
    inputs.uuid === undefined
    || inputs.uuid === null
    || (typeof inputs.uuid === 'string' && !inputs.uuid.trim())
  )) {
    return { uuid: '' }
  }
  return { uuid: requireUserPageUuid(inputs.uuid) }
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "normalizePageRows",
 *   "displayName": "标准化页面列表字段",
 *   "category": "transform",
 *   "description": "把数据库页面行转换为 camelCase 页面对象，并透传分页数据。",
 *   "inputs": [
 *     { "key": "rows", "type": "object[]", "required": true, "description": "页面数据库行。" }
 *   ],
 *   "outputs": [
 *     { "key": "pages", "type": "Page[]", "description": "标准化页面列表。" },
 *     { "key": "page", "type": "Page|number", "description": "标准化单页或当前分页页码。" },
 *     { "key": "affected", "type": "number", "description": "可选的影响行数。" },
 *     { "key": "pageSize", "type": "number", "description": "每页数量。" },
 *     { "key": "total", "type": "number", "description": "总数。" },
 *     { "key": "totalPages", "type": "number", "description": "总页数。" },
 *     { "key": "hasPreviousPage", "type": "boolean", "description": "是否有上一页。" },
 *     { "key": "hasNextPage", "type": "boolean", "description": "是否有下一页。" }
 *   ],
 *   "errors": [],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "仅转换输入，不直接访问数据库。" }
 *   ],
 *   "examples": [
 *     { "title": "标准化列表", "block": { "uuid": "normalize", "functionName": "normalizePageRows", "inputs": { "rows": [] }, "outputs": ["pages", "page", "affected", "pageSize", "total", "totalPages", "hasPreviousPage", "hasNextPage"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeNormalizePageRowsBlock: BlockExecutor = async ({ inputs }) => {
  const rows = Array.isArray(inputs.rows) ? inputs.rows : []
  const row = typeof inputs.row === 'object' && inputs.row !== null && !Array.isArray(inputs.row)
    ? inputs.row as Record<string, unknown>
    : undefined
  return {
    pages: rows
      .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row))
      .map(row => {
        const page = normalizeUserPage(row)
        return {
          ...page,
          pageKindLabel: page.subPage ? '子页面' : '主页面',
          quotesCount: page.quotes.length,
        }
      }),
    page: row && typeof row.uuid === 'string' ? normalizeUserPage(row) : inputs.page,
    affected: inputs.affected,
    pageSize: inputs.pageSize,
    total: inputs.total,
    totalPages: inputs.totalPages,
    hasPreviousPage: inputs.hasPreviousPage,
    hasNextPage: inputs.hasNextPage,
  }
}

function requireDatabaseType(value: DatabaseType | undefined): DatabaseType {
  if (value !== 'postgres' && value !== 'mysql') {
    throw mokelayError('BLOCK_DATASOURCE_UNSUPPORTED_DATABASE', '页面关系 Block 未获得数据库类型。', 500)
  }
  return value
}

function requireTransactionRunner(value: TransactionRunner | undefined): TransactionRunner {
  if (!value) {
    throw mokelayError('BLOCK_SQL_UNSUPPORTED', '页面关系 Block 必须在 datasource transaction runner 中执行。', 500)
  }
  return value
}

function requireEnterpriseUuid(event: Parameters<BlockExecutor>[0]['event']) {
  const user = readSessionValue(event, 'user')
  const value = typeof user === 'object' && user !== null && !Array.isArray(user)
    ? (user as Record<string, unknown>).enterprise_uuid
    : undefined
  if (typeof value !== 'string' || !value) {
    throw mokelayError('BLOCK_SESSION_KEY_NOT_FOUND', '请先登录。', 401)
  }
  return value
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "savePageRelations",
 *   "displayName": "保存页面及引用关系",
 *   "category": "database",
 *   "description": "在串行化事务中创建或更新用户页面，校验完整引用图，并派生 dependencies、quotes 与 subPage。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "页面数据库数据源。" },
 *     { "key": "mode", "type": "create|update", "required": true, "description": "保存模式。" },
 *     { "key": "uuid", "type": "string", "required": false, "description": "1 到 128 位小写 Slug；create 缺失时自动生成 RFC UUID 兼容值。" },
 *     { "key": "name", "type": "string", "required": true, "description": "页面名称。" },
 *     { "key": "blocks", "type": "unknown[]", "required": true, "description": "页面 Block DSL。" }
 *   ],
 *   "outputs": [
 *     { "key": "affected", "type": "number", "description": "保存的页面数量。" },
 *     { "key": "page", "type": "Page", "description": "包含规范关系字段的页面。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_PAGE_REFERENCE_CYCLE", "description": "引用图成环。" },
 *     { "code": "BLOCK_PAGE_REFERENCE_NOT_FOUND", "description": "目标页面不存在。" },
 *     { "code": "BLOCK_PAGE_GRAPH_NOT_READY", "description": "关系图尚未回填。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要数据库事务。" }
 *   ],
 *   "examples": [
 *     { "title": "创建页面", "block": { "uuid": "save", "functionName": "savePageRelations", "inputs": { "datasource": "Mokelay", "mode": "create", "uuid": "customer_orders", "name": "Page", "blocks": [] }, "outputs": ["affected", "page"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeSavePageRelationsBlock: BlockExecutor = async ({
  inputs,
  databaseType,
  withTransaction,
  executeSql,
  event,
}) => {
  if (inputs.mode !== 'create' && inputs.mode !== 'update') {
    throw mokelayError('REQUEST_INVALID_BODY', 'mode 仅支持 create 或 update。', 400)
  }
  const enterpriseUuid = requireEnterpriseUuid(event)
  let appUuid = typeof inputs.appUuid === 'string' ? inputs.appUuid : ''
  if (inputs.mode === 'update') {
    const existing = await executeSql(sql`SELECT app_uuid FROM ${sql.identifier('pages')} WHERE uuid = ${String(inputs.uuid)} AND enterprise_uuid = ${enterpriseUuid} LIMIT 1`)
    if (!existing.rows[0]) throw mokelayError('BLOCK_PAGE_NOT_FOUND', '页面不存在。', 404)
    appUuid = String((existing.rows[0] as Record<string, unknown>).app_uuid ?? '')
  }
  if (!appUuid) throw mokelayError('REQUEST_PARAMETER_MISSING', 'APP UUID 不能为空。', 400)
  const app = await executeSql(sql`SELECT uuid FROM ${sql.identifier('apps')} WHERE uuid = ${appUuid} AND enterprise_uuid = ${enterpriseUuid} LIMIT 1`)
  if (!app.rows[0]) throw mokelayError('BLOCK_PAGE_NOT_FOUND', 'APP 不存在。', 404)

  const input: PageSaveInput = {
    mode: inputs.mode,
    uuid: inputs.uuid,
    name: inputs.name,
    blocks: inputs.blocks,
    dependencies: inputs.dependencies,
    quotes: inputs.quotes,
    subPage: inputs.subPage,
    enterpriseUuid,
    appUuid,
  }
  return await savePageWithRelations(
    input,
    requireDatabaseType(databaseType),
    requireTransactionRunner(withTransaction),
  )
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "deletePageRelations",
 *   "displayName": "删除页面及引用关系",
 *   "category": "database",
 *   "description": "原子删除一个或多个用户页面，仅允许批次外没有父页面引用的删除集合，并重算存活页面关系。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "页面数据库数据源。" },
 *     { "key": "uuid", "type": "string", "required": false, "description": "单删页面 UUID。" },
 *     { "key": "uuids", "type": "string[]", "required": false, "description": "批删页面 UUID。" }
 *   ],
 *   "outputs": [
 *     { "key": "affected", "type": "number", "description": "删除的页面数量。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_PAGE_DELETE_REFERENCED", "description": "页面仍被批次外页面引用。" },
 *     { "code": "BLOCK_PAGE_NOT_FOUND", "description": "至少一个待删除页面不存在。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "需要数据库事务。" }
 *   ],
 *   "examples": [
 *     { "title": "删除页面", "block": { "uuid": "delete", "functionName": "deletePageRelations", "inputs": { "datasource": "Mokelay", "uuid": "customer_orders" }, "outputs": ["affected"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeDeletePageRelationsBlock: BlockExecutor = async ({
  inputs,
  databaseType,
  withTransaction,
  executeSql,
  event,
}) => {
  const uuids = Array.isArray(inputs.uuids) ? inputs.uuids : [inputs.uuid]
  const enterpriseUuid = requireEnterpriseUuid(event)
  for (const uuid of uuids) {
    const owned = await executeSql(sql`SELECT uuid FROM ${sql.identifier('pages')} WHERE uuid = ${String(uuid)} AND enterprise_uuid = ${enterpriseUuid} LIMIT 1`)
    if (!owned.rows[0]) throw mokelayError('BLOCK_PAGE_NOT_FOUND', '页面不存在。', 404)
  }
  return await deletePagesWithRelations(
    uuids,
    requireDatabaseType(databaseType),
    requireTransactionRunner(withTransaction),
  )
}
