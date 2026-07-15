import { sql } from 'drizzle-orm'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import { parseApiJson, type BlockExecutor, type SqlExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { assertFragmentCallParams, executeFragmentCalls } from './fragmentContracts'
import { getMokelayApiAssetStorage } from './listMokelayApiJsons'

type ApiDefinitionRow = {
  uuid?: unknown
  fragment?: unknown
  status?: unknown
  api_json?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredUuid(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw mokelayError('API_JSON_UUID_INVALID', 'API 标识必须是 1 到 128 位字母、数字、下划线或连字符。', 400)
  }
  return value
}

function optionalUuid(value: unknown) {
  return value === undefined || value === null || value === '' ? undefined : requiredUuid(value)
}

function booleanMetadata(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'boolean') {
    throw mokelayError('API_JSON_INVALID_SCHEMA', 'fragment 元数据必须是 boolean。', 400)
  }
  return value
}

function normalizeRowJson(value: unknown) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  }
  catch {
    return undefined
  }
}

function rowIsFragment(row: ApiDefinitionRow | undefined) {
  return row?.fragment === true || row?.fragment === 1 || row?.fragment === '1'
}

function minimallyValidateDsl(uuid: string, value: unknown) {
  if (!isRecord(value)) {
    throw mokelayError('API_JSON_INVALID_SCHEMA', `API JSON ${uuid} 必须是 object。`, 400)
  }
  if (value.uuid !== uuid) {
    throw mokelayError('API_JSON_UUID_MISMATCH', `API JSON uuid 必须与记录 UUID ${uuid} 一致。`, 400)
  }
  if ('fragment' in value && typeof value.fragment !== 'boolean') {
    throw mokelayError('API_JSON_INVALID_SCHEMA', 'API JSON fragment 必须是 boolean。', 400)
  }

  const fragment = value.fragment === true
  if (fragment) {
    if ('method' in value || 'request' in value) {
      throw mokelayError('API_JSON_INVALID_SCHEMA', 'Fragment DSL 不允许配置 method 或 request。', 400)
    }
  }
  else {
    if (typeof value.method !== 'string' || !value.method.trim()) {
      throw mokelayError('API_JSON_INVALID_SCHEMA', '普通 API DSL 必须配置 method。', 400)
    }
    if ('params' in value) {
      throw mokelayError('API_JSON_INVALID_SCHEMA', '普通 API DSL 不允许配置 params。', 400)
    }
  }

  return { fragment, method: fragment ? 'FRAGMENT' : String(value.method).trim().toUpperCase() }
}

function executeFragmentTargets(apiJson: unknown) {
  return [...new Set(executeFragmentCalls(apiJson).map(call => call.fragmentUuid))]
}

function referencesFragment(apiJson: unknown, fragmentUuid: string) {
  return executeFragmentTargets(normalizeRowJson(apiJson)).includes(fragmentUuid)
}

async function systemApiUuidExists(uuid: string) {
  const storage = await getMokelayApiAssetStorage()
  const target = `mokelay-apis/${uuid}.json`
  const keys = await storage.getKeys('mokelay-apis')
  return keys.some(key => key.replaceAll('\\', '/').replaceAll(':', '/') === target)
}

async function readApiDefinition(executeSql: SqlExecutor, uuid: string) {
  const result = await executeSql<ApiDefinitionRow>(sql`
    SELECT uuid, fragment, status, api_json
    FROM ${sql.identifier('apis')}
    WHERE uuid = ${uuid}
    LIMIT 1
  `)
  return result.rows[0]
}

function fragmentResultKeys(fragmentUuid: string, apiJson: unknown) {
  const parsed = parseApiJson(fragmentUuid, normalizeRowJson(apiJson))
  if (parsed.fragment !== true) {
    throw mokelayError('API_JSON_INVALID_FLOW', `${fragmentUuid} 不是 Fragment。`, 409)
  }

  const response = parsed.response ?? Object.values(parsed.responses ?? {})[0]
  return new Set(Object.keys(response ?? {}))
}

async function publishedFragmentCallers(
  executeSql: SqlExecutor,
  fragmentUuid: string,
  ignoreUuids: ReadonlySet<string> = new Set(),
) {
  const result = await executeSql<ApiDefinitionRow>(sql`
    SELECT uuid, api_json
    FROM ${sql.identifier('apis')}
    WHERE status = ${'published'}
  `)

  return result.rows
    .filter(row => !ignoreUuids.has(String(row.uuid)) && referencesFragment(row.api_json, fragmentUuid))
    .map(row => ({ uuid: String(row.uuid), apiJson: normalizeRowJson(row.api_json) }))
}

async function publishedReferences(
  executeSql: SqlExecutor,
  fragmentUuid: string,
  ignoreUuids: ReadonlySet<string> = new Set(),
) {
  return (await publishedFragmentCallers(executeSql, fragmentUuid, ignoreUuids)).map(caller => caller.uuid)
}

async function assertPublishedCallerContracts(
  executeSql: SqlExecutor,
  fragmentUuid: string,
  fragmentApiJson: unknown,
) {
  const callers = await publishedFragmentCallers(executeSql, fragmentUuid, new Set([fragmentUuid]))
  for (const caller of callers) {
    for (const call of executeFragmentCalls(caller.apiJson)) {
      if (call.fragmentUuid === fragmentUuid) {
        assertFragmentCallParams(caller.uuid, call, fragmentApiJson)
      }
    }
  }
  return callers
}

function assertFragmentResultBackwardCompatible(
  fragmentUuid: string,
  existingApiJson: unknown,
  nextApiJson: unknown,
) {
  const existingKeys = fragmentResultKeys(fragmentUuid, existingApiJson)
  const nextKeys = fragmentResultKeys(fragmentUuid, nextApiJson)
  const removedKeys = [...existingKeys].filter(key => !nextKeys.has(key)).sort()

  if (removedKeys.length > 0) {
    throw mokelayError(
      'API_JSON_INVALID_FLOW',
      `Fragment ${fragmentUuid} 正被已发布 API 引用，不能删除已有 result 顶层字段：${removedKeys.join(', ')}。`,
      409,
    )
  }
}

async function assertNoPublishedReferences(
  executeSql: SqlExecutor,
  fragmentUuid: string,
  ignoreUuids: ReadonlySet<string> = new Set(),
) {
  const references = await publishedReferences(executeSql, fragmentUuid, ignoreUuids)
  if (references.length > 0) {
    throw mokelayError(
      'API_JSON_INVALID_FLOW',
      `Fragment ${fragmentUuid} 正被已发布 API 引用：${references.join(', ')}。`,
      409,
    )
  }
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "validateApiDefinition",
 *   "displayName": "校验 API/Fragment 定义",
 *   "category": "validation",
 *   "description": "校验用户 API 与 Fragment DSL、数据库元数据、根目录内置 API UUID 冲突和数据库 Fragment 依赖，并输出规范化 method/fragment。draft caller 的目标必须是数据库 Fragment；published caller 另要求目标已发布且 params 契约一致。内置 Fragment 与数据库 Fragment 是隔离命名空间，允许同 UUID。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "固定为 Mokelay。" },
 *     { "key": "uuid", "type": "string", "required": true, "description": "API 或 Fragment UUID。" },
 *     { "key": "apiJson", "type": "object", "required": true, "description": "待保存的完整 DSL。" },
 *     { "key": "method", "type": "string", "required": false, "description": "普通 API method；Fragment 可省略或传 FRAGMENT。" },
 *     { "key": "fragment", "type": "boolean", "required": false, "defaultValue": false, "description": "持久化类型元数据。" },
 *     { "key": "status", "type": "draft|published", "required": true, "description": "发布状态。" },
 *     { "key": "originalUuid", "type": "string", "required": false, "description": "编辑前 UUID；Fragment 首次保存后禁止改名。" }
 *   ],
 *   "outputs": [
 *     { "key": "method", "type": "string", "description": "普通 API 的 HTTP method 或 Fragment 的 FRAGMENT 哨兵。" },
 *     { "key": "fragment", "type": "boolean", "description": "由 DSL 判别出的类型。" }
 *   ],
 *   "errors": [
 *     { "code": "API_JSON_INVALID_SCHEMA", "description": "DSL 与 method/fragment/status 元数据不一致。" },
 *     { "code": "API_JSON_DUPLICATE_UUID", "description": "UUID 与根目录内置 API 资产冲突；nested 内置 Fragment 不参与该冲突。" },
 *     { "code": "API_JSON_INVALID_FLOW", "description": "Fragment 依赖不存在/类型错误/未发布、UUID 被修改，或试图取消发布仍在使用的 Fragment。" }
 *   ],
 *   "config": [],
 *   "runtime": [{ "key": "requiresDatasource", "type": "boolean", "value": true, "description": "读取 apis 表验证发布依赖。" }],
 *   "examples": []
 * }
 */
export const executeValidateApiDefinitionBlock: BlockExecutor = async ({ inputs, executeSql }) => {
  return await validateApiDefinition(inputs, executeSql)
}

export async function validateApiDefinition(inputs: Record<string, unknown>, executeSql: SqlExecutor) {
  const uuid = requiredUuid(inputs.uuid)
  const originalUuid = optionalUuid(inputs.originalUuid)
  const status = inputs.status
  if (status !== 'draft' && status !== 'published') {
    throw mokelayError('API_JSON_INVALID_SCHEMA', 'status 仅支持 draft 或 published。', 400)
  }

  const minimalDsl = minimallyValidateDsl(uuid, inputs.apiJson)
  const parsed = status === 'published' ? parseApiJson(uuid, inputs.apiJson) : inputs.apiJson
  const fragment = minimalDsl.fragment
  const metadataFragment = booleanMetadata(inputs.fragment, fragment)

  if (metadataFragment !== fragment) {
    throw mokelayError('API_JSON_INVALID_SCHEMA', 'fragment 元数据必须与 API JSON 的 fragment 字段一致。', 400)
  }

  const metadataMethod = typeof inputs.method === 'string' ? inputs.method.trim().toUpperCase() : ''
  const method = minimalDsl.method

  if ((fragment && metadataMethod && metadataMethod !== 'FRAGMENT')
    || (!fragment && metadataMethod && metadataMethod !== method)) {
    throw mokelayError('API_JSON_INVALID_SCHEMA', 'method 元数据必须与 API JSON 类型和 method 一致。', 400)
  }

  if (await systemApiUuidExists(uuid)) {
    throw mokelayError('API_JSON_DUPLICATE_UUID', `API 标识 ${uuid} 与系统资产冲突。`, 409)
  }

  const existingUuid = originalUuid ?? uuid
  const existing = await readApiDefinition(executeSql, existingUuid)
  if (rowIsFragment(existing) && existingUuid !== uuid) {
    throw mokelayError('API_JSON_INVALID_FLOW', 'Fragment 首次保存后不允许修改 UUID。', 409)
  }
  if (existing && rowIsFragment(existing) !== fragment) {
    throw mokelayError('API_JSON_INVALID_FLOW', 'API 与 Fragment 的类型在首次保存后不允许转换。', 409)
  }

  if (rowIsFragment(existing) && existing?.status === 'published' && status !== 'published') {
    await assertNoPublishedReferences(executeSql, existingUuid, new Set([existingUuid]))
  }

  const fragmentCalls = executeFragmentCalls(parsed)
  if (fragment && fragmentCalls.length > 0) {
    throw mokelayError('API_JSON_INVALID_FLOW', 'Fragment 不允许嵌套调用其他 Fragment。', 409)
  }

  if (status === 'published') {
    if (fragment) {
      const callers = await assertPublishedCallerContracts(executeSql, uuid, parsed)
      if (callers.length > 0 && rowIsFragment(existing) && existing?.status === 'published') {
        assertFragmentResultBackwardCompatible(uuid, existing.api_json, parsed)
      }
    }
  }

  if (!fragment) {
    const targets = new Map<string, ApiDefinitionRow>()
    for (const call of fragmentCalls) {
      requiredUuid(call.fragmentUuid)
      let target = targets.get(call.fragmentUuid)
      if (!target) {
        target = await readApiDefinition(executeSql, call.fragmentUuid)
        if (target) targets.set(call.fragmentUuid, target)
      }
      if (!target || !rowIsFragment(target)) {
        throw mokelayError(
          'API_JSON_INVALID_FLOW',
          `Fragment ${call.fragmentUuid} 不存在或类型不正确。`,
          409,
        )
      }
      if (status === 'published' && target.status !== 'published') {
        throw mokelayError('API_JSON_INVALID_FLOW', `Fragment ${call.fragmentUuid} 尚未发布。`, 409)
      }
      if (status === 'published') assertFragmentCallParams(uuid, call, target.api_json)
    }
  }

  return { method, fragment }
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "assertApiDefinitionsDeletable",
 *   "displayName": "校验 API/Fragment 可删除",
 *   "category": "validation",
 *   "description": "删除前拒绝仍被批次外已发布数据库 API 引用的 Fragment；同批 caller 与 target 可以一起删除，内置 caller 不计入数据库引用。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "固定为 Mokelay。" },
 *     { "key": "uuids", "type": "string[]", "required": true, "description": "待删除 UUID 列表。" }
 *   ],
 *   "outputs": [],
 *   "errors": [{ "code": "API_JSON_INVALID_FLOW", "description": "至少一个 Fragment 仍被已发布 API 引用。" }],
 *   "config": [],
 *   "runtime": [{ "key": "requiresDatasource", "type": "boolean", "value": true, "description": "读取 apis 表验证引用。" }],
 *   "examples": []
 * }
 */
export const executeAssertApiDefinitionsDeletableBlock: BlockExecutor = async ({ inputs, executeSql }) => {
  const values = Array.isArray(inputs.uuids) ? inputs.uuids : [inputs.uuids]
  const uuids = [...new Set(values.map(requiredUuid))]
  const deleting = new Set(uuids)

  for (const uuid of uuids) {
    const existing = await readApiDefinition(executeSql, uuid)
    if (rowIsFragment(existing)) await assertNoPublishedReferences(executeSql, uuid, deleting)
  }

  return {}
}
