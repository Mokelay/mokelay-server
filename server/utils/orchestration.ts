import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { sql, type SQL } from 'drizzle-orm'
import {
  defineEventHandler,
  getMethod,
  getQuery,
  getRequestHeaders,
  getRouterParam,
  readBody,
  setResponseStatus,
  type EventHandler,
  type H3Event,
} from 'h3'
import { z } from 'zod'
import {
  datasourceDatabaseType,
  executeDatasourceSql,
  normalizeDatasourceName,
  type DatabaseType,
  type SqlExecutionResult,
} from './db'
import { mokelayError, toMokelayErrorResponse, type MokelayErrorCode } from './mokelay-error'
import { hashPassword, verifyPassword } from './password'
import { readSessionValue, removeSessionValue, setSessionValue } from './session'

const apiJsonUuidPattern = /^[A-Za-z0-9_-]{1,128}$/
const templatePattern = /\{\{\s*([^}]+?)\s*\}\}/g
const wholeTemplatePattern = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/

const processorConfigSchema = z.union([
  z.string().min(1, 'processor 不能为空。'),
  z.object({
    processor: z.string().min(1, 'processor 不能为空。'),
    param: z.unknown().optional(),
  }).strict(),
])
const processorsSchema = z.array(processorConfigSchema)
const processableKeySchema = z.union([
  z.string().min(1),
  z.object({
    key: z.string().min(1, 'key 不能为空。'),
    processors: processorsSchema.optional().default([]),
  }).strict(),
])
const calculateTemplateSchema = z.object({
  template: z.string().min(1, '模板不能为空。'),
  processors: processorsSchema.optional().default([]),
}).strict()

const conditionTypeSchema = z.enum(['GE', 'GT', 'LE', 'LT', 'NEQ', 'EQ', 'NOTIN', 'IN'])
const groupTypeSchema = z.enum(['AND', 'OR'])

type CalculateTemplate = z.infer<typeof calculateTemplateSchema>
type ProcessorConfig = z.infer<typeof processorConfigSchema>
type ProcessableKey = z.infer<typeof processableKeySchema>

type LeafCondition = {
  group: false
  fieldName: string
  fieldValue?: unknown
  conditionType: z.infer<typeof conditionTypeSchema>
}

type GroupCondition = {
  group: true
  groupType: z.infer<typeof groupTypeSchema>
  groups: Condition[]
}

export type Condition = LeafCondition | GroupCondition

const conditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([
  z.object({
    group: z.literal(false),
    fieldName: z.string().min(1, '条件字段不能为空。'),
    fieldValue: z.any(),
    conditionType: conditionTypeSchema,
  }).strict().refine((value) => Object.prototype.hasOwnProperty.call(value, 'fieldValue'), {
    message: 'fieldValue 不能为空。',
  }),
  z.object({
    group: z.literal(true),
    groupType: groupTypeSchema,
    groups: z.array(conditionSchema).min(1, '条件组不能为空。'),
  }).strict(),
]))

const requestSchema = z.object({
  header: z.array(processableKeySchema).optional().default([]),
  query: z.array(processableKeySchema).optional().default([]),
  body: z.array(processableKeySchema).optional().default([]),
}).strict()

const blockSchema = z.object({
  uuid: z.string().min(1, 'Block UUID 不能为空。'),
  alias: z.string().optional(),
  functionName: z.string().min(1, 'Block functionName 不能为空。'),
  inputs: z.record(z.unknown()).optional().default({}),
  outputs: z.array(processableKeySchema).nullable().optional(),
}).strict()

const apiJsonSchema = z.object({
  uuid: z.string().min(1, 'API JSON UUID 不能为空。'),
  alias: z.string().optional(),
  method: z.string().min(1, 'method 不能为空。').transform((method) => method.toUpperCase()),
  request: requestSchema.optional().default({ header: [], query: [], body: [] }),
  blocks: z.array(blockSchema).default([]),
  response: z.record(z.unknown()).nullable().optional(),
}).strict()

type ApiJson = z.infer<typeof apiJsonSchema>
type Block = z.infer<typeof blockSchema>

type RequestContext = {
  header: Record<string, string>
  query: Record<string, unknown>
  body: Record<string, unknown>
}

type BlockExecutionContext = {
  request: RequestContext
  header: Record<string, string>
  query: Record<string, unknown>
  body: Record<string, unknown>
  now: string
  blocks: Record<string, {
    inputs: Record<string, unknown>
    outputs: Record<string, unknown>
  }>
}

type BlockExecutorInput = {
  event: H3Event
  block: Block
  inputs: Record<string, unknown>
  executeSql: SqlExecutor
  databaseType?: DatabaseType
}

type BlockExecutor = (input: BlockExecutorInput) => Promise<Record<string, unknown>>

type SqlExecutor = <T extends Record<string, unknown> = Record<string, unknown>>(query: SQL) => Promise<SqlExecutionResult<T>>
type DatasourceSqlExecutor = <T extends Record<string, unknown> = Record<string, unknown>>(
  query: SQL,
  datasource: string,
  databaseType: DatabaseType,
) => Promise<SqlExecutionResult<T>>

type OrchestrationHandlerOptions = {
  loadApiJson?: (apiJsonUuid: string) => Promise<unknown>
  executeSql?: DatasourceSqlExecutor
}

type MokelaySuccessResponse = {
  ok: true
  data: unknown
}

const allowedBlockOutputs: Record<string, readonly string[]> = {
  list: ['datas'],
  page: ['datas', 'total', 'totalPages', 'page', 'pageSize', 'hasPreviousPage', 'hasNextPage'],
  count: ['total'],
  read: ['data'],
  delete: ['affected'],
  create: ['uuid'],
  update: ['affected'],
  addSession: [],
  removeSession: [],
  readSession: ['value'],
}

const databaseBlockFunctions = new Set(['list', 'page', 'count', 'read', 'delete', 'create', 'update'])

function assertApiJsonUuid(value: string | undefined) {
  if (!value || !apiJsonUuidPattern.test(value)) {
    throw mokelayError('API_JSON_UUID_INVALID', 'API_JSON_UUID 无效或不能为空。', 400)
  }

  return value
}

function parseApiJson(apiJsonUuid: string, value: unknown): ApiJson {
  const parsed = apiJsonSchema.safeParse(value)

  if (!parsed.success) {
    throw mokelayError(
      'API_JSON_INVALID_SCHEMA',
      `API JSON ${apiJsonUuid} 不符合规范：${parsed.error.issues[0]?.message || '输入内容无效。'}`,
      400,
    )
  }

  if (parsed.data.uuid !== apiJsonUuid) {
    throw mokelayError('API_JSON_UUID_MISMATCH', 'API JSON UUID 与请求路径不一致。', 400)
  }

  return parsed.data
}

async function loadApiJsonFromNitroAssets(apiJsonUuid: string) {
  try {
    const { useStorage } = await import('nitropack/runtime')
    const value = await useStorage('assets:server').getItem(`mokelay-apis/${apiJsonUuid}.json`)

    return value ?? undefined
  } catch {
    return undefined
  }
}

async function loadApiJsonFromFileSystem(apiJsonUuid: string) {
  const apiJsonDir = resolve(process.cwd(), 'server/assets/mokelay-apis')
  const filePath = resolve(apiJsonDir, `${apiJsonUuid}.json`)

  if (!filePath.startsWith(`${apiJsonDir}${sep}`)) {
    throw mokelayError('API_JSON_UUID_INVALID', 'API_JSON_UUID 无效。', 400)
  }

  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined

    if (code === 'ENOENT') {
      throw mokelayError('API_JSON_NOT_FOUND', 'API JSON 不存在。', 404)
    }

    throw error
  }
}

export async function loadApiJson(apiJsonUuid: string) {
  assertApiJsonUuid(apiJsonUuid)

  const value = await loadApiJsonFromNitroAssets(apiJsonUuid) ?? await loadApiJsonFromFileSystem(apiJsonUuid)

  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    throw mokelayError('API_JSON_INVALID_JSON', `API JSON ${apiJsonUuid} 不是合法 JSON。`, 400)
  }
}

async function defaultExecuteSql<T extends Record<string, unknown> = Record<string, unknown>>(query: SQL, datasource: string) {
  return await executeDatasourceSql<T>(query, datasource)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function declarationKey(declaration: ProcessableKey) {
  return typeof declaration === 'string' ? declaration : declaration.key
}

function declarationProcessors(declaration: ProcessableKey) {
  return typeof declaration === 'string' ? [] : declaration.processors ?? []
}

function processorName(config: ProcessorConfig) {
  return typeof config === 'string' ? config : config.processor
}

async function processorParams(config: ProcessorConfig, context?: BlockExecutionContext) {
  if (typeof config === 'string' || config.param === undefined) {
    return []
  }

  const param = context ? await resolveTemplates(config.param, context) : config.param

  return Array.isArray(param) ? param : [param]
}

function processorConfigError(processor: string, message: string): never {
  throw mokelayError('PROCESSOR_INVALID_CONFIG', `Processor ${processor} 配置无效：${message}`, 400)
}

function processorValidationError(processor: string, label: string, message: string): never {
  throw mokelayError('PROCESSOR_VALIDATION_FAILED', `Processor ${processor} 校验失败：${label} ${message}`, 400)
}

function stringifyProcessorValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (value === undefined) {
    return 'undefined'
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isNullishProcessorValue(value: unknown) {
  return value === undefined || value === null || value === ''
}

function getLength(value: unknown, processor: string, label: string): number {
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length
  }

  processorValidationError(processor, label, '必须是字符串或数组。')
}

function getLengthLimit(processor: string, params: unknown[]): number {
  const limit = params[0]

  if (params.length !== 1 || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0) {
    processorConfigError(processor, 'param 必须包含一个非负整数。')
  }

  return limit
}

function getSingleParam(processor: string, params: unknown[]) {
  if (params.length !== 1) {
    processorConfigError(processor, 'param 必须包含一个参数。')
  }

  return params[0]
}

function compileRegex(processor: string, param: unknown): RegExp {
  if (typeof param !== 'string' || !param) {
    processorConfigError(processor, 'param 必须是非空正则字符串。')
  }

  try {
    if (param.startsWith('/')) {
      const lastSlashIndex = param.lastIndexOf('/')

      if (lastSlashIndex > 0) {
        return new RegExp(param.slice(1, lastSlashIndex), param.slice(lastSlashIndex + 1))
      }
    }

    return new RegExp(param)
  } catch (error) {
    throw mokelayError('PROCESSOR_INVALID_CONFIG', `Processor ${processor} 配置无效：正则表达式无效。`, 400, error)
  }
}

async function applyProcessor(value: unknown, config: ProcessorConfig, label: string, context?: BlockExecutionContext) {
  const name = processorName(config)
  const params = await processorParams(config, context)

  switch (name) {
    case 'trim':
      return typeof value === 'string' ? value.trim() : value
    case 'is_not_null':
      if (isNullishProcessorValue(value)) {
        processorValidationError(name, label, '不能为空。')
      }

      return value
    case 'is_null':
      if (!isNullishProcessorValue(value)) {
        processorValidationError(name, label, '必须为空。')
      }

      return value
    case 'not_null':
      return value !== undefined && value !== null
    case 'email_check':
      if (typeof value !== 'string' || !z.string().email().safeParse(value).success) {
        processorValidationError(name, label, '不是合法 email。')
      }

      return value
    case 'number_check':
      if (
        typeof value !== 'number' && typeof value !== 'string'
        || typeof value === 'number' && !Number.isFinite(value)
        || typeof value === 'string' && (!value.trim() || !Number.isFinite(Number(value)))
      ) {
        processorValidationError(name, label, '不是合法数字。')
      }

      return value
    case 'eq': {
      const expected = getSingleParam(name, params)

      if (!isDeepStrictEqual(value, expected)) {
        processorValidationError(name, label, `必须等于 ${stringifyProcessorValue(expected)}。`)
      }

      return value
    }
    case 'min': {
      const limit = getLengthLimit(name, params)

      if (getLength(value, name, label) < limit) {
        processorValidationError(name, label, `长度不能小于 ${limit}。`)
      }

      return value
    }
    case 'max': {
      const limit = getLengthLimit(name, params)

      if (getLength(value, name, label) > limit) {
        processorValidationError(name, label, `长度不能大于 ${limit}。`)
      }

      return value
    }
    case 'regex': {
      const regex = compileRegex(name, getSingleParam(name, params))

      if (typeof value !== 'string' || !regex.test(value)) {
        processorValidationError(name, label, `不符合正则 ${regex.toString()}。`)
      }

      return value
    }
    case 'hash_make':
      if (typeof value !== 'string') {
        processorValidationError(name, label, '必须是字符串。')
      }

      return await hashPassword(value)
    case 'hash_check': {
      const plainPassword = getSingleParam(name, params)

      if (typeof value !== 'string' || typeof plainPassword !== 'string') {
        processorValidationError(name, label, '必须使用字符串 hash 和明文密码。')
      }

      if (!(await verifyPassword(value, plainPassword))) {
        processorValidationError(name, label, 'hash 校验不通过。')
      }

      return value
    }
    default:
      throw mokelayError('PROCESSOR_UNSUPPORTED', `不支持的 Processor：${name}`, 400)
  }
}

async function applyProcessors(value: unknown, processors: ProcessorConfig[], label: string, context?: BlockExecutionContext) {
  let current = value

  for (const processor of processors) {
    current = await applyProcessor(current, processor, label, context)
  }

  return current
}

function parseCalculateTemplate(value: unknown): CalculateTemplate | undefined {
  const parsed = calculateTemplateSchema.safeParse(value)

  if (parsed.success) {
    return parsed.data
  }

  if (isRecord(value) && typeof value.template === 'string' && Object.prototype.hasOwnProperty.call(value, 'processors')) {
    throw mokelayError(
      'PROCESSOR_INVALID_CONFIG',
      `template processors 配置无效：${parsed.error.issues[0]?.message || '输入内容无效。'}`,
      400,
    )
  }

  return undefined
}

function stringifyTemplateValue(value: unknown) {
  if (value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return JSON.stringify(value)
}

function parsePathExpression(expression: string) {
  const tokens: string[] = []
  const matcher = /(?:^|\.)([A-Za-z_$][A-Za-z0-9_$]*)|\[['"]([^'"\]]+)['"]\]|\[(\d+)\]/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = matcher.exec(expression)) !== null) {
    if (match.index !== cursor) {
      throw mokelayError('TEMPLATE_PATH_INVALID', `模板路径无效：${expression}`, 400)
    }

    tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
    cursor = match.index + match[0].length
  }

  if (tokens.length === 0 || cursor !== expression.length) {
    throw mokelayError('TEMPLATE_PATH_INVALID', `模板路径无效：${expression}`, 400)
  }

  return tokens
}

function getByPath(source: unknown, expression: string) {
  const tokens = parsePathExpression(expression.trim())
  let current = source

  for (const token of tokens) {
    if (current === null || current === undefined) {
      throw mokelayError('TEMPLATE_VARIABLE_NOT_FOUND', `模板变量不存在：${expression}`, 400)
    }

    if (Array.isArray(current)) {
      const index = Number(token)

      if (!Number.isSafeInteger(index)) {
        throw mokelayError('TEMPLATE_ARRAY_INDEX_INVALID', `模板数组索引无效：${expression}`, 400)
      }

      current = current[index]
      continue
    }

    if (!isRecord(current) || !(token in current)) {
      throw mokelayError('TEMPLATE_VARIABLE_NOT_FOUND', `模板变量不存在：${expression}`, 400)
    }

    current = current[token]
  }

  return current
}

function renderTemplate(template: string, context: BlockExecutionContext) {
  const wholeTemplate = wholeTemplatePattern.exec(template)

  if (wholeTemplate?.[1]) {
    return getByPath(context, wholeTemplate[1])
  }

  return template.replace(templatePattern, (_, expression: string) => stringifyTemplateValue(getByPath(context, expression)))
}

async function resolveTemplates(value: unknown, context: BlockExecutionContext): Promise<unknown> {
  const template = parseCalculateTemplate(value)

  if (template) {
    const rendered = renderTemplate(template.template, context)
    return await applyProcessors(rendered, template.processors ?? [], 'template', context)
  }

  if (Array.isArray(value)) {
    return await Promise.all(value.map((item) => resolveTemplates(item, context)))
  }

  if (isRecord(value)) {
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => {
      return [key, await resolveTemplates(item, context)] as const
    }))

    return Object.fromEntries(entries)
  }

  return value
}

function normalizeHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }

  return value ?? ''
}

function normalizeBody(body: unknown) {
  return isRecord(body) ? body : {}
}

function requireDeclaredValue(source: Record<string, unknown>, name: string, sourceName: string) {
  if (!(name in source) || source[name] === undefined || source[name] === null || source[name] === '') {
    throw mokelayError('REQUEST_PARAMETER_MISSING', `缺少 ${sourceName} 参数：${name}`, 400)
  }

  return source[name]
}

async function readRequestContext(event: H3Event, apiJson: ApiJson): Promise<RequestContext> {
  const shouldReadBody = getMethod(event) !== 'GET'
  const headers = getRequestHeaders(event)
  const headerContext: Record<string, unknown> = {}
  const rawQuery = getQuery(event)
  const queryContext: Record<string, unknown> = {}
  let bodyContext: Record<string, unknown> = {}

  if (shouldReadBody && apiJson.request.body.length > 0) {
    try {
      bodyContext = normalizeBody(await readBody(event))
    } catch (error) {
      throw mokelayError('REQUEST_INVALID_BODY', '请求 body 不是合法 JSON。', 400, error)
    }
  }

  for (const declaration of apiJson.request.header) {
    const name = declarationKey(declaration)
    const value = normalizeHeaderValue(headers[name.toLowerCase()])

    headerContext[name] = typeof declaration === 'string'
      ? requireDeclaredValue({ [name]: value }, name, 'header')
      : await applyProcessors(value, declarationProcessors(declaration), `request.header.${name}`)
  }

  for (const declaration of apiJson.request.query) {
    const name = declarationKey(declaration)
    const value = rawQuery[name]
    const normalizedValue = Array.isArray(value) ? value[0] : value

    queryContext[name] = typeof declaration === 'string'
      ? requireDeclaredValue({ [name]: normalizedValue }, name, 'query')
      : await applyProcessors(normalizedValue, declarationProcessors(declaration), `request.query.${name}`)
  }

  if (shouldReadBody) {
    for (const declaration of apiJson.request.body) {
      const name = declarationKey(declaration)

      bodyContext[name] = typeof declaration === 'string'
        ? requireDeclaredValue(bodyContext, name, 'body')
        : await applyProcessors(bodyContext[name], declarationProcessors(declaration), `request.body.${name}`)
    }
  }

  return {
    header: headerContext as Record<string, string>,
    query: queryContext,
    body: bodyContext,
  }
}

function identifierSql(value: unknown, name: string, errorCode: MokelayErrorCode) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError(errorCode, `${name} 必须是非空字符串。`, 400)
  }

  const parts = value.trim().split('.')

  if (parts.some((part) => !part.trim())) {
    throw mokelayError(errorCode, `${name} 不是合法 SQL 标识符。`, 400)
  }

  return sql.join(parts.map((part) => sql.identifier(part.trim())), sql.raw('.'))
}

function getFields(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || !value.every((field) => typeof field === 'string' && field.trim())) {
    throw mokelayError('BLOCK_INVALID_FIELDS', 'fields 必须是非空字符串数组。', 400)
  }

  return value as string[]
}

function getFieldValues(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw mokelayError('BLOCK_INVALID_FIELDS', 'fields 必须是非空对象。', 400)
  }

  return value
}

function getConditions(value: unknown): Condition[] {
  if (value === undefined) {
    return []
  }

  const parsed = z.array(conditionSchema).safeParse(value)

  if (!parsed.success) {
    throw mokelayError(
      'BLOCK_INVALID_CONDITIONS',
      `conditions 不符合规范：${parsed.error.issues[0]?.message || '输入内容无效。'}`,
      400,
    )
  }

  return parsed.data
}

function buildConditionSql(condition: Condition): SQL {
  if (condition.group) {
    const parts = condition.groups.map((item) => sql`(${buildConditionSql(item)})`)
    return sql.join(parts, condition.groupType === 'AND' ? sql` AND ` : sql` OR `)
  }

  const column = identifierSql(condition.fieldName, 'fieldName', 'BLOCK_INVALID_CONDITIONS')

  switch (condition.conditionType) {
    case 'EQ':
      return sql`${column} = ${condition.fieldValue}`
    case 'NEQ':
      return sql`${column} <> ${condition.fieldValue}`
    case 'GT':
      return sql`${column} > ${condition.fieldValue}`
    case 'GE':
      return sql`${column} >= ${condition.fieldValue}`
    case 'LT':
      return sql`${column} < ${condition.fieldValue}`
    case 'LE':
      return sql`${column} <= ${condition.fieldValue}`
    case 'IN':
    case 'NOTIN': {
      if (!Array.isArray(condition.fieldValue) || condition.fieldValue.length === 0) {
        throw mokelayError(
          'BLOCK_INVALID_CONDITION_VALUE',
          `${condition.conditionType} 条件的 fieldValue 必须是非空数组。`,
          400,
        )
      }

      const values = sql.join(condition.fieldValue.map((item) => sql`${item}`), sql`, `)
      return condition.conditionType === 'IN'
        ? sql`${column} IN (${values})`
        : sql`${column} NOT IN (${values})`
    }
  }
}

function buildWhereSql(conditions: Condition[]) {
  if (conditions.length === 0) {
    return undefined
  }

  return sql.join(conditions.map((condition) => sql`(${buildConditionSql(condition)})`), sql` AND `)
}

function getPositiveInteger(value: unknown, name: string, defaultValue: number, errorCode: MokelayErrorCode) {
  const parsedValue = Number(value ?? defaultValue)

  if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
    throw mokelayError(errorCode, `${name} 必须是正整数。`, 400)
  }

  return parsedValue
}

function getSessionKey(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('BLOCK_SESSION_KEY_INVALID', 'key 必须是非空字符串。', 400)
  }

  return value.trim()
}

function getCreateIdField(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('BLOCK_INVALID_ID_FIELD', 'idField 必须是非空字符串。', 400)
  }

  const fieldName = value.trim()

  return {
    fieldName: fieldName.split('.').at(-1)?.trim() || fieldName,
    fieldSql: identifierSql(fieldName, 'idField', 'BLOCK_INVALID_ID_FIELD'),
  }
}

function fieldValueSql(value: unknown, databaseType: DatabaseType) {
  if (!Array.isArray(value) && !isRecord(value)) {
    return sql`${value}`
  }

  const jsonValue = JSON.stringify(value)

  return databaseType === 'postgres'
    ? sql`${jsonValue}::jsonb`
    : sql`${jsonValue}`
}

function countExpressionSql(databaseType: DatabaseType) {
  return databaseType === 'postgres'
    ? sql`count(*)::int`
    : sql`count(*)`
}

function normalizeCountTotal(value: unknown) {
  const total = Number(value ?? 0)

  return Number.isFinite(total) ? total : 0
}

function isPresentId(value: unknown) {
  return value !== undefined
    && value !== null
    && value !== ''
    && value !== 0
    && (typeof value !== 'bigint' || value !== BigInt(0))
}

function isDuplicateRecordError(error: unknown) {
  if (!isRecord(error)) {
    return false
  }

  return error.code === '23505'
    || error.code === 'ER_DUP_ENTRY'
    || error.code === 1062
    || error.errno === 1062
}

function orderBySql(value: unknown) {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw mokelayError('BLOCK_INVALID_ORDER_BY', 'orderBy 必须是数组。', 400)
  }

  const orders = value.map((item) => {
    if (!isRecord(item) || typeof item.fieldName !== 'string' || !item.fieldName.trim()) {
      throw mokelayError('BLOCK_INVALID_ORDER_BY_FIELD', 'orderBy.fieldName 必须是非空字符串。', 400)
    }

    const direction = typeof item.direction === 'string' ? item.direction.toUpperCase() : 'ASC'

    if (direction !== 'ASC' && direction !== 'DESC') {
      throw mokelayError('BLOCK_INVALID_ORDER_BY_DIRECTION', 'orderBy.direction 只能是 ASC 或 DESC。', 400)
    }

    return sql`${identifierSql(item.fieldName, 'orderBy.fieldName', 'BLOCK_INVALID_ORDER_BY_FIELD')} ${sql.raw(direction)}`
  })

  return orders.length > 0 ? sql.join(orders, sql`, `) : undefined
}

async function executeList(inputs: Record<string, unknown>, executeSql: SqlExecutor, databaseType: DatabaseType, paged = false) {
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = getFields(inputs.fields)
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const orderBy = orderBySql(inputs.orderBy)
  const selectedFields = sql.join(fields.map((field) => identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')), sql`, `)
  const baseQuery = sql`FROM ${table}`
  const page = getPositiveInteger(inputs.page, 'page', 1, 'BLOCK_INVALID_PAGE')
  const pageSize = getPositiveInteger(inputs.pageSize, 'pageSize', 20, 'BLOCK_INVALID_PAGE_SIZE')

  const dataQuery = where
    ? sql`SELECT ${selectedFields} ${baseQuery} WHERE ${where}`
    : sql`SELECT ${selectedFields} ${baseQuery}`
  const orderedDataQuery = orderBy ? sql`${dataQuery} ORDER BY ${orderBy}` : dataQuery
  const dataResult = paged
    ? await executeSql(sql`${orderedDataQuery} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`)
    : await executeSql(orderedDataQuery)
  const rows = dataResult.rows

  if (!paged) {
    return { datas: rows }
  }

  const totalResult = await executeSql<{ total: number | string | bigint }>(where
    ? sql`SELECT ${countExpressionSql(databaseType)} AS total ${baseQuery} WHERE ${where}`
    : sql`SELECT ${countExpressionSql(databaseType)} AS total ${baseQuery}`)
  const total = normalizeCountTotal(totalResult.rows[0]?.total)

  return {
    datas: rows,
    total,
    totalPages: Math.ceil(total / pageSize),
    page,
    pageSize,
    hasPreviousPage: page > 1 && total > 0,
    hasNextPage: page < Math.ceil(total / pageSize),
  }
}

async function executeRead(inputs: Record<string, unknown>, executeSql: SqlExecutor) {
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = getFields(inputs.fields)
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const selectedFields = sql.join(fields.map((field) => identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')), sql`, `)
  const query = where
    ? sql`SELECT ${selectedFields} FROM ${table} WHERE ${where} LIMIT 1`
    : sql`SELECT ${selectedFields} FROM ${table} LIMIT 1`
  const result = await executeSql(query)

  return {
    data: result.rows[0] ?? null,
  }
}

async function executeCount(inputs: Record<string, unknown>, executeSql: SqlExecutor, databaseType: DatabaseType) {
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const result = await executeSql<{ total: number | string | bigint }>(where
    ? sql`SELECT ${countExpressionSql(databaseType)} AS total FROM ${table} WHERE ${where}`
    : sql`SELECT ${countExpressionSql(databaseType)} AS total FROM ${table}`)

  return {
    total: normalizeCountTotal(result.rows[0]?.total),
  }
}

async function executeCreate(inputs: Record<string, unknown>, executeSql: SqlExecutor, databaseType: DatabaseType) {
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = getFieldValues(inputs.fields)
  const idField = getCreateIdField(inputs.idField)
  const columns = Object.keys(fields)
  const columnSql = sql.join(columns.map((field) => identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')), sql`, `)
  const valueSql = sql.join(columns.map((field) => fieldValueSql(fields[field], databaseType)), sql`, `)

  try {
    const result = databaseType === 'postgres'
      ? await executeSql(sql`INSERT INTO ${table} (${columnSql}) VALUES (${valueSql}) RETURNING ${idField.fieldSql}`)
      : await executeSql(sql`INSERT INTO ${table} (${columnSql}) VALUES (${valueSql})`)
    const uuid = databaseType === 'postgres'
      ? result.rows[0]?.[idField.fieldName]
      : isPresentId(result.insertId)
        ? result.insertId
        : fields[idField.fieldName]

    if (uuid === undefined || uuid === null || uuid === '') {
      throw mokelayError('BLOCK_CREATE_MISSING_ID', 'create Block 未返回插入记录的唯一 ID。', 500)
    }

    return { uuid }
  } catch (error) {
    if (isDuplicateRecordError(error)) {
      throw mokelayError('BLOCK_DUPLICATE_RECORD', '记录已经存在。', 409, error)
    }

    throw error
  }
}

async function executeUpdate(inputs: Record<string, unknown>, executeSql: SqlExecutor, databaseType: DatabaseType) {
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = getFieldValues(inputs.fields)
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const assignments = sql.join(Object.entries(fields).map(([field, value]) => sql`${identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')} = ${fieldValueSql(value, databaseType)}`), sql`, `)

  const result = databaseType === 'postgres'
    ? await executeSql(where
      ? sql`UPDATE ${table} SET ${assignments} WHERE ${where} RETURNING 1 AS affected_marker`
      : sql`UPDATE ${table} SET ${assignments} RETURNING 1 AS affected_marker`)
    : await executeSql(where
      ? sql`UPDATE ${table} SET ${assignments} WHERE ${where}`
      : sql`UPDATE ${table} SET ${assignments}`)

  return { affected: databaseType === 'postgres' ? result.rows.length : result.affectedRows ?? 0 }
}

async function executeDelete(inputs: Record<string, unknown>, executeSql: SqlExecutor, databaseType: DatabaseType) {
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const result = databaseType === 'postgres'
    ? await executeSql(where
      ? sql`DELETE FROM ${table} WHERE ${where} RETURNING 1 AS affected_marker`
      : sql`DELETE FROM ${table} RETURNING 1 AS affected_marker`)
    : await executeSql(where
      ? sql`DELETE FROM ${table} WHERE ${where}`
      : sql`DELETE FROM ${table}`)

  return { affected: databaseType === 'postgres' ? result.rows.length : result.affectedRows ?? 0 }
}

async function executeAddSession(event: H3Event, inputs: Record<string, unknown>) {
  const key = getSessionKey(inputs.key)

  if (!Object.prototype.hasOwnProperty.call(inputs, 'value')) {
    throw mokelayError('BLOCK_SESSION_VALUE_MISSING', 'value 不能为空。', 400)
  }

  setSessionValue(event, key, inputs.value)

  return {}
}

async function executeRemoveSession(event: H3Event, inputs: Record<string, unknown>) {
  const key = getSessionKey(inputs.key)

  removeSessionValue(event, key)

  return {}
}

async function executeReadSession(event: H3Event, inputs: Record<string, unknown>) {
  const key = getSessionKey(inputs.key)

  try {
    return {
      value: readSessionValue(event, key),
    }
  } catch (error) {
    const data = typeof error === 'object' && error && 'data' in error ? error.data : undefined
    const code = isRecord(data) ? data.code : undefined

    if (code !== 'BLOCK_SESSION_KEY_NOT_FOUND') {
      throw error
    }

    return {
      value: null,
    }
  }
}

function requireDatabaseType(databaseType: DatabaseType | undefined) {
  if (!databaseType) {
    throw mokelayError('BLOCK_SQL_UNSUPPORTED', '数据库 Block 缺少数据库类型。', 500)
  }

  return databaseType
}

const blockExecutors: Record<string, BlockExecutor> = {
  list: ({ inputs, executeSql, databaseType }) => executeList(inputs, executeSql, requireDatabaseType(databaseType)),
  page: ({ inputs, executeSql, databaseType }) => executeList(inputs, executeSql, requireDatabaseType(databaseType), true),
  count: ({ inputs, executeSql, databaseType }) => executeCount(inputs, executeSql, requireDatabaseType(databaseType)),
  read: ({ inputs, executeSql }) => executeRead(inputs, executeSql),
  delete: ({ inputs, executeSql, databaseType }) => executeDelete(inputs, executeSql, requireDatabaseType(databaseType)),
  create: ({ inputs, executeSql, databaseType }) => executeCreate(inputs, executeSql, requireDatabaseType(databaseType)),
  update: ({ inputs, executeSql, databaseType }) => executeUpdate(inputs, executeSql, requireDatabaseType(databaseType)),
  addSession: ({ event, inputs }) => executeAddSession(event, inputs),
  removeSession: ({ event, inputs }) => executeRemoveSession(event, inputs),
  readSession: ({ event, inputs }) => executeReadSession(event, inputs),
}

function validateDeclaredOutputs(block: Block) {
  if (!block.outputs?.length) {
    return
  }

  const allowedOutputs = allowedBlockOutputs[block.functionName]

  if (!allowedOutputs) {
    return
  }

  for (const outputName of block.outputs) {
    const key = declarationKey(outputName)

    if (!allowedOutputs.includes(key)) {
      throw mokelayError('BLOCK_UNSUPPORTED_OUTPUT', `Block ${block.functionName} 不支持输出：${key}`, 400)
    }
  }
}

async function executeBlock(block: Block, context: BlockExecutionContext, executeSql: DatasourceSqlExecutor, event: H3Event) {
  const executor = blockExecutors[block.functionName]

  if (!executor) {
    throw mokelayError('BLOCK_UNSUPPORTED_FUNCTION', `不支持的 Block functionName：${block.functionName}`, 400)
  }

  validateDeclaredOutputs(block)

  const inputs = await resolveTemplates(block.inputs, context) as Record<string, unknown>
  const datasource = databaseBlockFunctions.has(block.functionName)
    ? normalizeDatasourceName(inputs.datasource)
    : undefined
  const databaseType = datasource ? datasourceDatabaseType(datasource) : undefined
  const executeBlockSql: SqlExecutor = (query) => {
    if (!datasource) {
      throw mokelayError('BLOCK_SQL_UNSUPPORTED', `Block ${block.functionName} 不支持 SQL 执行。`, 500)
    }

    return executeSql(query, datasource, requireDatabaseType(databaseType))
  }

  context.blocks[block.uuid] = {
    inputs,
    outputs: {},
  }

  const outputs = await executor({ event, block, inputs, executeSql: executeBlockSql, databaseType })

  if (block.outputs) {
    for (const outputDeclaration of block.outputs) {
      const outputName = declarationKey(outputDeclaration)

      if (!(outputName in outputs)) {
        throw mokelayError('BLOCK_OUTPUT_MISSING', `Block ${block.uuid} 未产生声明的输出：${outputName}`, 400)
      }

      outputs[outputName] = await applyProcessors(
        outputs[outputName],
        declarationProcessors(outputDeclaration),
        `blocks['${block.uuid}'].outputs.${outputName}`,
        context,
      )
    }
  }

  context.blocks[block.uuid].outputs = outputs

  return outputs
}

export async function executeApiJson(event: H3Event, rawApiJson: unknown, options: OrchestrationHandlerOptions = {}) {
  const apiJsonUuid = assertApiJsonUuid(getRouterParam(event, 'apiJsonUuid'))
  const apiJson = parseApiJson(apiJsonUuid, rawApiJson)
  const actualMethod = getMethod(event).toUpperCase()

  if (apiJson.method !== actualMethod) {
    throw mokelayError('REQUEST_METHOD_MISMATCH', `请求方法不匹配，应使用 ${apiJson.method}。`, 400)
  }

  const request = await readRequestContext(event, apiJson)
  const executeSql = options.executeSql ?? defaultExecuteSql
  const context: BlockExecutionContext = {
    request,
    header: request.header,
    query: request.query,
    body: request.body,
    now: new Date().toISOString(),
    blocks: {},
  }

  for (const block of apiJson.blocks) {
    await executeBlock(block, context, executeSql, event)
  }

  const data = apiJson.response == null ? null : await resolveTemplates(apiJson.response, context)

  return {
    ok: true,
    data,
  } satisfies MokelaySuccessResponse
}

export function createMokelayOrchestrationHandler(options: OrchestrationHandlerOptions = {}): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const apiJsonUuid = assertApiJsonUuid(getRouterParam(event, 'apiJsonUuid'))
      const rawApiJson = await (options.loadApiJson ?? loadApiJson)(apiJsonUuid)

      return await executeApiJson(event, rawApiJson, options)
    } catch (error) {
      setResponseStatus(event, 200)
      return toMokelayErrorResponse(error)
    }
  })
}
