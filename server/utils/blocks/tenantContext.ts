import { sql } from 'drizzle-orm'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import type { BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { readSessionValue } from 'mokelay-server-core/utils/session'

function sessionEnterpriseUuid(event: Parameters<BlockExecutor>[0]['event']) {
  const user = readSessionValue(event, 'user')
  if (typeof user !== 'object' || user === null || Array.isArray(user)) {
    throw mokelayError('BLOCK_SESSION_KEY_NOT_FOUND', '请先登录。', 401)
  }
  const enterpriseUuid = (user as Record<string, unknown>).enterprise_uuid
  if (typeof enterpriseUuid !== 'string' || !enterpriseUuid.trim()) {
    throw mokelayError('BLOCK_SESSION_VALUE_MISSING', '登录信息缺少企业标识。', 401)
  }
  return enterpriseUuid.trim()
}

function optionalAppUuid(value: unknown) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.trim())) {
    throw mokelayError('REQUEST_INVALID_BODY', 'APP UUID 无效。', 400)
  }
  return value.trim()
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "requireTenantContext",
 *   "displayName": "校验企业与 APP 上下文",
 *   "category": "security",
 *   "description": "从 Session 读取企业 UUID，并可校验 APP 与 API 是否属于当前企业。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "Mokelay 数据源。" },
 *     { "key": "appUuid", "type": "string", "required": false, "description": "需要校验的 APP UUID。" },
 *     { "key": "requireApp", "type": "boolean", "required": false, "description": "是否强制提供 APP UUID。" },
 *     { "key": "layoutUuid", "type": "string", "required": false, "description": "需要校验的布局 UUID。" },
 *     { "key": "apiUuid", "type": "string", "required": false, "description": "已有 API UUID；存在时校验归属。" }
 *   ],
 *   "outputs": [
 *     { "key": "enterpriseUuid", "type": "string", "description": "Session 企业 UUID。" },
 *     { "key": "appUuid", "type": "string", "description": "已校验 APP UUID。" }
 *   ],
 *   "errors": [{ "code": "BLOCK_SESSION_KEY_NOT_FOUND", "description": "用户未登录。" }],
 *   "config": [],
 *   "runtime": [{ "key": "requiresDatasource", "type": "boolean", "value": true, "description": "校验资源归属需要数据库。" }],
 *   "examples": [{ "title": "校验 APP", "block": { "uuid": "tenant", "functionName": "requireTenantContext", "inputs": { "datasource": "Mokelay", "appUuid": "demo", "requireApp": true }, "outputs": ["enterpriseUuid", "appUuid"], "nextBlock": null } }]
 * }
 */
export const executeRequireTenantContextBlock: BlockExecutor = async ({ inputs, event, executeSql }) => {
  const enterpriseUuid = sessionEnterpriseUuid(event)
  const appUuid = optionalAppUuid(inputs.appUuid)
  const requireApp = inputs.requireApp === true

  if (requireApp && !appUuid) {
    throw mokelayError('REQUEST_PARAMETER_MISSING', 'APP UUID 不能为空。', 400)
  }

  if (appUuid) {
    if (!executeSql) {
      throw mokelayError('BLOCK_SQL_UNSUPPORTED', '租户上下文无法校验 APP。', 500)
    }
    const result = await executeSql(sql`
      SELECT uuid
      FROM ${sql.identifier('apps')}
      WHERE uuid = ${appUuid} AND enterprise_uuid = ${enterpriseUuid}
      LIMIT 1
    `)
    if (!result.rows[0]) {
      throw mokelayError('API_JSON_NOT_FOUND', 'APP 不存在。', 404)
    }
  }

  const layoutUuid = typeof inputs.layoutUuid === 'string' ? inputs.layoutUuid.trim() : ''
  if (layoutUuid) {
    if (!executeSql) {
      throw mokelayError('BLOCK_SQL_UNSUPPORTED', '租户上下文无法校验布局。', 500)
    }
    const result = await executeSql(sql`
      SELECT uuid
      FROM ${sql.identifier('layouts')}
      WHERE uuid = ${layoutUuid} AND enterprise_uuid = ${enterpriseUuid}
      LIMIT 1
    `)
    if (!result.rows[0]) {
      throw mokelayError('API_JSON_NOT_FOUND', '布局不存在。', 404)
    }
  }

  const apiUuid = typeof inputs.apiUuid === 'string' ? inputs.apiUuid.trim() : ''
  if (apiUuid && executeSql) {
    const existing = await executeSql(sql`
      SELECT enterprise_uuid, app_uuid
      FROM ${sql.identifier('apis')}
      WHERE uuid = ${apiUuid}
      LIMIT 1
    `)
    const row = existing.rows[0] as Record<string, unknown> | undefined
    if (row && (row.enterprise_uuid !== enterpriseUuid || (appUuid && row.app_uuid !== appUuid))) {
      throw mokelayError('API_JSON_NOT_FOUND', 'API 不存在。', 404)
    }
  }

  return { enterpriseUuid, appUuid }
}
