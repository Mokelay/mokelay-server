import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { sql, type SQL } from 'drizzle-orm'
import {
  createError,
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
import { normalizeDatasourceName, useDatasourceDb } from './db'

const apiJsonUuidPattern = /^[A-Za-z0-9_-]{1,128}$/
const templatePattern = /\{\{\s*([^}]+?)\s*\}\}/g
const wholeTemplatePattern = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/

const calculateTemplateSchema = z.object({
  template: z.string().min(1, '模板不能为空。'),
}).strict()

const conditionTypeSchema = z.enum(['GE', 'GT', 'LE', 'LT', 'NEQ', 'EQ', 'NOTIN', 'IN'])
const groupTypeSchema = z.enum(['AND', 'OR'])

type CalculateTemplate = z.infer<typeof calculateTemplateSchema>

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
  header: z.array(z.string().min(1)).optional().default([]),
  query: z.array(z.string().min(1)).optional().default([]),
  body: z.array(z.string().min(1)).optional().default([]),
}).strict()

const blockSchema = z.object({
  uuid: z.string().min(1, 'Block UUID 不能为空。'),
  alias: z.string().optional(),
  functionName: z.string().min(1, 'Block functionName 不能为空。'),
  inputs: z.record(z.unknown()).optional().default({}),
  outputs: z.array(z.string().min(1)).nullable().optional(),
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
  block: Block
  inputs: Record<string, unknown>
  executeSql: SqlExecutor
}

type BlockExecutor = (input: BlockExecutorInput) => Promise<Record<string, unknown>>

type SqlExecutor = <T extends Record<string, unknown> = Record<string, unknown>>(query: SQL) => Promise<T[]>
type DatasourceSqlExecutor = <T extends Record<string, unknown> = Record<string, unknown>>(query: SQL, datasource: string) => Promise<T[]>

type OrchestrationHandlerOptions = {
  loadApiJson?: (apiJsonUuid: string) => Promise<unknown>
  executeSql?: DatasourceSqlExecutor
}

function assertApiJsonUuid(value: string | undefined) {
  if (!value || !apiJsonUuidPattern.test(value)) {
    throw createError({
      statusCode: 400,
      message: 'API_JSON_UUID 无效或不能为空。',
    })
  }

  return value
}

function parseApiJson(apiJsonUuid: string, value: unknown): ApiJson {
  const parsed = apiJsonSchema.safeParse(value)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: `API JSON ${apiJsonUuid} 不符合规范：${parsed.error.issues[0]?.message || '输入内容无效。'}`,
    })
  }

  if (parsed.data.uuid !== apiJsonUuid) {
    throw createError({
      statusCode: 400,
      message: 'API JSON UUID 与请求路径不一致。',
    })
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
    throw createError({
      statusCode: 400,
      message: 'API_JSON_UUID 无效。',
    })
  }

  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined

    if (code === 'ENOENT') {
      throw createError({
        statusCode: 404,
        message: 'API JSON 不存在。',
      })
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
    throw createError({
      statusCode: 400,
      message: `API JSON ${apiJsonUuid} 不是合法 JSON。`,
    })
  }
}

async function defaultExecuteSql<T extends Record<string, unknown> = Record<string, unknown>>(query: SQL, datasource: string) {
  const rows = await useDatasourceDb(datasource).execute<T>(query)

  return Array.from(rows) as T[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCalculateTemplate(value: unknown): value is CalculateTemplate {
  return calculateTemplateSchema.safeParse(value).success
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
      throw createError({
        statusCode: 400,
        message: `模板路径无效：${expression}`,
      })
    }

    tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
    cursor = match.index + match[0].length
  }

  if (tokens.length === 0 || cursor !== expression.length) {
    throw createError({
      statusCode: 400,
      message: `模板路径无效：${expression}`,
    })
  }

  return tokens
}

function getByPath(source: unknown, expression: string) {
  const tokens = parsePathExpression(expression.trim())
  let current = source

  for (const token of tokens) {
    if (current === null || current === undefined) {
      throw createError({
        statusCode: 400,
        message: `模板变量不存在：${expression}`,
      })
    }

    if (Array.isArray(current)) {
      const index = Number(token)

      if (!Number.isSafeInteger(index)) {
        throw createError({
          statusCode: 400,
          message: `模板数组索引无效：${expression}`,
        })
      }

      current = current[index]
      continue
    }

    if (!isRecord(current) || !(token in current)) {
      throw createError({
        statusCode: 400,
        message: `模板变量不存在：${expression}`,
      })
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

function resolveTemplates(value: unknown, context: BlockExecutionContext): unknown {
  if (isCalculateTemplate(value)) {
    return renderTemplate(value.template, context)
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, context))
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTemplates(item, context)]))
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
    throw createError({
      statusCode: 400,
      message: `缺少 ${sourceName} 参数：${name}`,
    })
  }

  return source[name]
}

async function readRequestContext(event: H3Event, apiJson: ApiJson): Promise<RequestContext> {
  const shouldReadBody = getMethod(event) !== 'GET'
  const headers = getRequestHeaders(event)
  const headerContext = Object.fromEntries(apiJson.request.header.map((name) => {
    const lowerName = name.toLowerCase()
    return [name, normalizeHeaderValue(headers[lowerName])]
  }))
  const rawQuery = getQuery(event)
  const queryContext = Object.fromEntries(apiJson.request.query.map((name) => {
    const value = rawQuery[name]
    return [name, Array.isArray(value) ? value[0] : value]
  }))
  const bodyContext = !shouldReadBody || apiJson.request.body.length === 0
    ? {}
    : normalizeBody(await readBody(event))

  for (const name of apiJson.request.header) {
    requireDeclaredValue(headerContext, name, 'header')
  }

  for (const name of apiJson.request.query) {
    requireDeclaredValue(queryContext, name, 'query')
  }

  if (shouldReadBody) {
    for (const name of apiJson.request.body) {
      requireDeclaredValue(bodyContext, name, 'body')
    }
  }

  return {
    header: headerContext as Record<string, string>,
    query: queryContext,
    body: bodyContext,
  }
}

function identifierSql(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw createError({
      statusCode: 400,
      message: `${name} 必须是非空字符串。`,
    })
  }

  const parts = value.trim().split('.')

  if (parts.some((part) => !part.trim())) {
    throw createError({
      statusCode: 400,
      message: `${name} 不是合法 SQL 标识符。`,
    })
  }

  return sql.join(parts.map((part) => sql.identifier(part.trim())), sql.raw('.'))
}

function getFields(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || !value.every((field) => typeof field === 'string' && field.trim())) {
    throw createError({
      statusCode: 400,
      message: 'fields 必须是非空字符串数组。',
    })
  }

  return value as string[]
}

function getFieldValues(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw createError({
      statusCode: 400,
      message: 'fields 必须是非空对象。',
    })
  }

  return value
}

function getConditions(value: unknown): Condition[] {
  if (value === undefined) {
    return []
  }

  const parsed = z.array(conditionSchema).safeParse(value)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: `conditions 不符合规范：${parsed.error.issues[0]?.message || '输入内容无效。'}`,
    })
  }

  return parsed.data
}

function buildConditionSql(condition: Condition): SQL {
  if (condition.group) {
    const parts = condition.groups.map((item) => sql`(${buildConditionSql(item)})`)
    return sql.join(parts, condition.groupType === 'AND' ? sql` AND ` : sql` OR `)
  }

  const column = identifierSql(condition.fieldName, 'fieldName')

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
        throw createError({
          statusCode: 400,
          message: `${condition.conditionType} 条件的 fieldValue 必须是非空数组。`,
        })
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

function getPositiveInteger(value: unknown, name: string, defaultValue: number) {
  const parsedValue = Number(value ?? defaultValue)

  if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
    throw createError({
      statusCode: 400,
      message: `${name} 必须是正整数。`,
    })
  }

  return parsedValue
}

function returningSql(outputs: Block['outputs']) {
  if (!outputs?.length) {
    return undefined
  }

  return sql.join(outputs.map((field) => identifierSql(field, 'outputs')), sql`, `)
}

function fieldValueSql(value: unknown) {
  return Array.isArray(value) || isRecord(value)
    ? sql`${JSON.stringify(value)}::jsonb`
    : sql`${value}`
}

function orderBySql(value: unknown) {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      message: 'orderBy 必须是数组。',
    })
  }

  const orders = value.map((item) => {
    if (!isRecord(item) || typeof item.fieldName !== 'string' || !item.fieldName.trim()) {
      throw createError({
        statusCode: 400,
        message: 'orderBy.fieldName 必须是非空字符串。',
      })
    }

    const direction = typeof item.direction === 'string' ? item.direction.toUpperCase() : 'ASC'

    if (direction !== 'ASC' && direction !== 'DESC') {
      throw createError({
        statusCode: 400,
        message: 'orderBy.direction 只能是 ASC 或 DESC。',
      })
    }

    return sql`${identifierSql(item.fieldName, 'orderBy.fieldName')} ${sql.raw(direction)}`
  })

  return orders.length > 0 ? sql.join(orders, sql`, `) : undefined
}

async function executeList(inputs: Record<string, unknown>, executeSql: SqlExecutor, paged = false) {
  const table = identifierSql(inputs.table, 'table')
  const fields = getFields(inputs.fields)
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const orderBy = orderBySql(inputs.orderBy)
  const selectedFields = sql.join(fields.map((field) => identifierSql(field, 'fields')), sql`, `)
  const baseQuery = sql`FROM ${table}`
  const page = getPositiveInteger(inputs.page, 'page', 1)
  const pageSize = getPositiveInteger(inputs.pageSize, 'pageSize', 20)

  const dataQuery = where
    ? sql`SELECT ${selectedFields} ${baseQuery} WHERE ${where}`
    : sql`SELECT ${selectedFields} ${baseQuery}`
  const orderedDataQuery = orderBy ? sql`${dataQuery} ORDER BY ${orderBy}` : dataQuery
  const rows = paged
    ? await executeSql(sql`${orderedDataQuery} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`)
    : await executeSql(orderedDataQuery)

  if (!paged) {
    return { datas: rows }
  }

  const totalRows = await executeSql<{ total: number }>(where
    ? sql`SELECT count(*)::int AS total ${baseQuery} WHERE ${where}`
    : sql`SELECT count(*)::int AS total ${baseQuery}`)
  const total = totalRows[0]?.total ?? 0

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
  const table = identifierSql(inputs.table, 'table')
  const fields = getFields(inputs.fields)
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const selectedFields = sql.join(fields.map((field) => identifierSql(field, 'fields')), sql`, `)
  const query = where
    ? sql`SELECT ${selectedFields} FROM ${table} WHERE ${where} LIMIT 1`
    : sql`SELECT ${selectedFields} FROM ${table} LIMIT 1`
  const rows = await executeSql(query)

  return {
    data: rows[0] ?? null,
  }
}

async function executeCreate(block: Block, inputs: Record<string, unknown>, executeSql: SqlExecutor) {
  const table = identifierSql(inputs.table, 'table')
  const fields = getFieldValues(inputs.fields)
  const columns = Object.keys(fields)
  const columnSql = sql.join(columns.map((field) => identifierSql(field, 'fields')), sql`, `)
  const valueSql = sql.join(columns.map((field) => fieldValueSql(fields[field])), sql`, `)
  const returning = returningSql(block.outputs)

  try {
    if (!returning) {
      await executeSql(sql`INSERT INTO ${table} (${columnSql}) VALUES (${valueSql})`)
      return {}
    }

    const rows = await executeSql(sql`INSERT INTO ${table} (${columnSql}) VALUES (${valueSql}) RETURNING ${returning}`)

    return rows[0] ?? {}
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined

    if (code === '23505') {
      throw createError({
        statusCode: 409,
        message: '记录已经存在。',
      })
    }

    throw error
  }
}

async function executeUpdate(inputs: Record<string, unknown>, executeSql: SqlExecutor) {
  const table = identifierSql(inputs.table, 'table')
  const fields = getFieldValues(inputs.fields)
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const assignments = sql.join(Object.entries(fields).map(([field, value]) => sql`${identifierSql(field, 'fields')} = ${fieldValueSql(value)}`), sql`, `)

  await executeSql(where
    ? sql`UPDATE ${table} SET ${assignments} WHERE ${where}`
    : sql`UPDATE ${table} SET ${assignments}`)

  return {}
}

async function executeDelete(inputs: Record<string, unknown>, executeSql: SqlExecutor) {
  const table = identifierSql(inputs.table, 'table')
  const conditions = getConditions(inputs.conditions)
  const where = buildWhereSql(conditions)
  const rows = await executeSql(where
    ? sql`DELETE FROM ${table} WHERE ${where} RETURNING 1 AS affected_marker`
    : sql`DELETE FROM ${table} RETURNING 1 AS affected_marker`)

  return { affected: rows.length }
}

const blockExecutors: Record<string, BlockExecutor> = {
  list: ({ inputs, executeSql }) => executeList(inputs, executeSql),
  page: ({ inputs, executeSql }) => executeList(inputs, executeSql, true),
  read: ({ inputs, executeSql }) => executeRead(inputs, executeSql),
  delete: ({ inputs, executeSql }) => executeDelete(inputs, executeSql),
  create: ({ block, inputs, executeSql }) => executeCreate(block, inputs, executeSql),
  update: ({ inputs, executeSql }) => executeUpdate(inputs, executeSql),
}

async function executeBlock(block: Block, context: BlockExecutionContext, executeSql: DatasourceSqlExecutor) {
  const executor = blockExecutors[block.functionName]

  if (!executor) {
    throw createError({
      statusCode: 400,
      message: `不支持的 Block functionName：${block.functionName}`,
    })
  }

  if (block.functionName === 'update' && block.outputs?.length) {
    throw createError({
      statusCode: 400,
      message: 'update Block 不支持 outputs，如需读取更新后的数据请追加 read Block。',
    })
  }

  const inputs = resolveTemplates(block.inputs, context) as Record<string, unknown>
  const datasource = normalizeDatasourceName(inputs.datasource)
  const executeBlockSql: SqlExecutor = (query) => executeSql(query, datasource)

  context.blocks[block.uuid] = {
    inputs,
    outputs: {},
  }

  const outputs = await executor({ block, inputs, executeSql: executeBlockSql })

  if (block.outputs) {
    for (const outputName of block.outputs) {
      if (!(outputName in outputs)) {
        throw createError({
          statusCode: 400,
          message: `Block ${block.uuid} 未产生声明的输出：${outputName}`,
        })
      }
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
    throw createError({
      statusCode: 400,
      message: `请求方法不匹配，应使用 ${apiJson.method}。`,
    })
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
    await executeBlock(block, context, executeSql)
  }

  if (!apiJson.response) {
    setResponseStatus(event, 204)
    return ''
  }

  return resolveTemplates(apiJson.response, context)
}

export function createMokelayOrchestrationHandler(options: OrchestrationHandlerOptions = {}): EventHandler {
  return defineEventHandler(async (event) => {
    const apiJsonUuid = assertApiJsonUuid(getRouterParam(event, 'apiJsonUuid'))
    const rawApiJson = await (options.loadApiJson ?? loadApiJson)(apiJsonUuid)

    return await executeApiJson(event, rawApiJson, options)
  })
}
