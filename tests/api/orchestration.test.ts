import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { PgDialect } from 'drizzle-orm/pg-core'
import { createApp, createRouter, toNodeListener, type EventHandler } from 'h3'
import orchestrationHandler from '../../server/routes/api/mokelay/[apiJsonUuid]'
import missingApiJsonUuidHandler from '../../server/routes/api/mokelay/index'
import { createMokelayOrchestrationHandler as createCoreMokelayOrchestrationHandler } from 'mokelay-server-core/utils/orchestration'
import type { MokelayErrorCode } from 'mokelay-server-core/utils/mokelay-error'
import { verifyPassword } from 'mokelay-server-core/utils/password'
import { orchestrationSessionCookieName } from 'mokelay-server-core/utils/session'
import type { DatabaseType, SqlExecutionResult } from 'mokelay-server-core/utils/db'

const apiR2MockState = vi.hoisted(() => ({
  sentInputs: [] as Array<Record<string, unknown>>,
  failPut: false,
}))

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: class {
    constructor(readonly input: unknown) {}
  },
  PutObjectCommand: class {
    constructor(readonly input: unknown) {}
  },
  S3Client: class {
    send = async (command: { input: Record<string, unknown> }) => {
      apiR2MockState.sentInputs.push(command.input)

      if ('Body' in command.input) {
        if (apiR2MockState.failPut) {
          throw new Error('R2 unavailable')
        }

        return { ETag: '"api-etag"' }
      }

      throw new Error('NoSuchKey')
    }
  },
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

type MokelayDebugError = {
  code: string
  message: string
}

type MokelayDebugBlockStep = {
  uuid: string
  type: 'block'
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  nextBlock: MokelayDebugStep | null
  error?: MokelayDebugError
}

type MokelayDebugControllerStep = {
  uuid: string
  type: 'controller'
  inputs: Record<string, unknown>
  node?: {
    uuid: string
    nextBlock: MokelayDebugStep | null
  }
  error?: MokelayDebugError
}

type MokelayDebugStep = MokelayDebugBlockStep | MokelayDebugControllerStep

type MokelayDebugTrace = {
  uuid: 'starter'
  nextBlock: MokelayDebugStep | null
}

type CreateUserResponse = {
  id: string
}

type ReadUserResponse = {
  user_info: null | {
    id: string
    name: string
    email: string
    created_at: string
    updated_at: string
  }
}

type UserListResponse = {
  user_list: Array<{
    id: string
    name: string
    email: string
    created_at: string
    updated_at: string
  }>
}

type CountFreeUsersResponse = {
  total: number
}

type RegisterResponse = {
  user: {
    id: string
    enterprise_uuid: string
    enterprise_name: string
    name: string
    email: string
    plan: string
  } | null
}

type PublicPage = {
  uuid: string
  name: string
  blocks: unknown[]
  createdAt: string
  updatedAt: string
}

type PageResponse = {
  page: PublicPage | null
}

type PageListResponse = {
  pages: Array<{
    uuid: string
    name: string
    blocks: unknown[]
    created_at: string
    updated_at: string
  }>
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasPreviousPage: boolean
    hasNextPage: boolean
  }
}

type PublicApp = {
  id: number
  uuid: string
  alias: string
  description: string
}

type AppResponse = {
  app: PublicApp | null
}

type AppListResponse = {
  apps: PublicApp[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasPreviousPage: boolean
    hasNextPage: boolean
  }
}

type PublicDatasource = {
  id: number
  uuid: string
  alias: string
  description: string
  schema_data: Array<{
    name: string
    columns: Array<{ name: string; type: string; dataType: string }>
  }>
}

type DatasourceResponse = {
  datasource: PublicDatasource | null
  affected?: number
}

type DatasourceListResponse = {
  datasources: PublicDatasource[]
  pagination: AppListResponse['pagination']
}

type PublicApi = {
  uuid: string
  name: string
  method: string
  status: string
  apiJson?: Record<string, unknown>
  layout?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  created_at?: string
  updated_at?: string
}

type ApiResponse = {
  api: PublicApi | null
}

type ApiListResponse = {
  apis: PublicApi[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasPreviousPage: boolean
    hasNextPage: boolean
  }
}

type PublicApiBuilderSample = {
  uuid: string
  title: string
  description: string
  method: string
  api_json: Record<string, unknown>
  status: string
  sort_order: number
  created_at: string
  updated_at: string
}

type ApiBuilderSampleListResponse = {
  samples: PublicApiBuilderSample[]
  pagination: ApiListResponse['pagination']
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const pgDialect = new PgDialect()
const mysqlDialect = new MySqlDialect()
const apiR2EnvKeys = [
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_ENDPOINT',
  'MOKELAY_APIS_R2_BUCKET',
  'MOKELAY_APIS_R2_PREFIX',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function blockUuid(block: unknown) {
  return isRecord(block) && typeof block.uuid === 'string' ? block.uuid : null
}

function normalizeBlockSequence(blocks: unknown[], continuation: string | null): { first: string | null, blocks: unknown[] } {
  const migratedBlocks: unknown[] = []

  blocks.forEach((block, index) => {
    if (!isRecord(block)) {
      migratedBlocks.push(block)
      return
    }

    const nextTopLevelBlock = index + 1 < blocks.length ? blockUuid(blocks[index + 1]) : continuation

    if (block.type === 'controller' && Array.isArray(block.nodes)) {
      const nestedBlocks: unknown[] = []
      const controller: Record<string, unknown> = {
        ...block,
        nodes: block.nodes.map((node) => {
          if (!isRecord(node)) {
            return node
          }

          if (!Array.isArray(node.blocks)) {
            return Object.prototype.hasOwnProperty.call(node, 'nextBlock')
              ? node
              : { ...node, nextBlock: nextTopLevelBlock }
          }

          const nested = normalizeBlockSequence(node.blocks, nextTopLevelBlock)
          const { blocks: _blocks, nextBlock: _nextBlock, ...nodeWithoutBlocks } = node

          nestedBlocks.push(...nested.blocks)

          return {
            ...nodeWithoutBlocks,
            nextBlock: nested.first,
          }
        }),
      }

      delete controller.nextBlock
      migratedBlocks.push(controller, ...nestedBlocks)
      return
    }

    migratedBlocks.push(
      Object.prototype.hasOwnProperty.call(block, 'nextBlock')
        ? block
        : { ...block, nextBlock: nextTopLevelBlock },
    )
  })

  return {
    first: blockUuid(blocks[0]) ?? continuation,
    blocks: migratedBlocks,
  }
}

function normalizeApiJsonFlow(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.blocks)) {
    return value
  }

  if (value.blocks.some((block) => isRecord(block) && block.uuid === 'starter')) {
    return value
  }

  const migrated = normalizeBlockSequence(value.blocks, null)

  return {
    ...value,
    blocks: [
      { uuid: 'starter', nextBlock: migrated.first },
      ...migrated.blocks,
    ],
  }
}

function emptyApiJsonBlocks() {
  return [{ uuid: 'starter', nextBlock: null }]
}

function createMokelayOrchestrationHandler(
  options: Parameters<typeof createCoreMokelayOrchestrationHandler>[0] = {},
) {
  const loadApiJson = options.loadApiJson

  return createCoreMokelayOrchestrationHandler({
    ...options,
    loadApiJson: loadApiJson
      ? async (apiJsonUuid) => normalizeApiJsonFlow(await loadApiJson(apiJsonUuid))
      : undefined,
  })
}

type EnterpriseRow = {
  id: number
  uuid: string
  name: string
}

type EmployeeRow = {
  id: string
  enterprise_uuid: string
  name: string
  email: string
  password_hash: string
  plan: string
  created_at: string
  updated_at: string
}

type PageRow = {
  uuid: string
  name: string
  blocks: unknown[]
  created_at: string
  updated_at: string
}

type AppRow = {
  id: number
  uuid: string
  alias: string
  description: string
}

type DatasourceRow = {
  id: number
  uuid: string
  alias: string
  description: string
  schema_data: PublicDatasource['schema_data']
}

type ApiRow = {
  uuid: string
  name: string
  method: string
  status: string
  api_json: Record<string, unknown>
  layout: Record<string, unknown>
  created_at: string
  updated_at: string
}

type ApiSnapshotRow = {
  id: string
  api_uuid: string
  name: string
  method: string
  status: string
  api_json: Record<string, unknown>
  created_at: string
}

type ApiBuilderSampleRow = {
  uuid: string
  title: string
  description: string
  method: string
  api_json: Record<string, unknown>
  status: string
  sort_order: number
  created_at: string
  updated_at: string
}

class FakeSqlExecutor {
  readonly enterprise: EnterpriseRow[] = []
  readonly employees: EmployeeRow[] = []
  readonly users = this.employees
  readonly pages: PageRow[] = []
  readonly apps: AppRow[] = []
  readonly datasourceRows: DatasourceRow[] = []
  readonly apis: ApiRow[] = []
  readonly apiSnapshots: ApiSnapshotRow[] = []
  readonly apiBuilderSamples: ApiBuilderSampleRow[] = []
  readonly datasources: string[] = []

  execute = async <T extends Record<string, unknown> = Record<string, unknown>>(
    query: SQL,
    datasource: string,
    databaseType: DatabaseType,
  ): Promise<SqlExecutionResult<T>> => {
    this.datasources.push(datasource)

    const builtQuery = pgDialect.sqlToQuery(query)
    const queryText = builtQuery.sql.replace(/\s+/g, ' ').trim()
    const params = builtQuery.params

    if (queryText.startsWith('INSERT INTO "enterprise"')) {
      return this.result(databaseType, this.insertEnterprise<T>(queryText, params))
    }

    if (queryText.startsWith('INSERT INTO "employees"') || queryText.startsWith('INSERT INTO "users"')) {
      return this.result(databaseType, this.insertEmployee<T>(queryText, params))
    }

    if (queryText.startsWith('INSERT INTO "pages"')) {
      return this.result(databaseType, this.insertPage<T>(queryText, params))
    }

    if (queryText.startsWith('INSERT INTO "apps"')) {
      return this.result(databaseType, this.insertApp<T>(queryText, params))
    }

    if (queryText.startsWith('INSERT INTO "datasources"')) {
      return this.result(databaseType, this.insertDatasource<T>(queryText, params))
    }

    if (queryText.startsWith('INSERT INTO "apis"')) {
      return this.result(databaseType, this.upsertApi<T>(queryText, params))
    }

    if (queryText.startsWith('INSERT INTO "apis_snapshot"')) {
      return this.result(databaseType, this.insertApiSnapshot<T>(queryText, params))
    }

    if (
      queryText.startsWith('SELECT count(*)::int AS total FROM "employees"') ||
      queryText.startsWith('SELECT count(*)::int AS total FROM "users"')
    ) {
      return this.result(databaseType, [{ total: this.filterEmployees(queryText, params).length }] as unknown as T[])
    }

    if (queryText.startsWith('SELECT count(*)::int AS total FROM "pages"')) {
      return this.result(databaseType, [{ total: this.filterPages(queryText, params).length }] as unknown as T[])
    }

    if (queryText.startsWith('SELECT count(*)::int AS total FROM "apps"')) {
      return this.result(databaseType, [{ total: this.filterApps(queryText, params).length }] as unknown as T[])
    }

    if (queryText.startsWith('SELECT count(*)::int AS total FROM "datasources"')) {
      return this.result(databaseType, [{ total: this.filterDatasourceRows(queryText, params).length }] as unknown as T[])
    }

    if (queryText.startsWith('SELECT count(*)::int AS total FROM "api_builder_samples"')) {
      return this.result(databaseType, [{ total: this.filterApiBuilderSamples(queryText, params).length }] as unknown as T[])
    }

    if (queryText.startsWith('SELECT count(*)::int AS total FROM "apis"')) {
      return this.result(databaseType, [{ total: this.filterApis(queryText, params).length }] as unknown as T[])
    }

    if (queryText.startsWith('SELECT')) {
      if (queryText.includes('FROM pg_catalog.pg_class cls')) {
        return this.result(databaseType, [
          { tableName: 'orders', columnName: 'id', columnType: 'integer' },
          { tableName: 'orders', columnName: 'total', columnType: 'numeric(12,2)' },
          { tableName: 'enterprise', columnName: 'uuid', columnType: 'uuid' },
          { tableName: 'employees', columnName: 'enterprise_uuid', columnType: 'uuid' },
        ] as unknown as T[])
      }

      if (queryText.includes('FROM "enterprise"')) {
        return this.result(databaseType, this.selectEnterprise<T>(queryText, params))
      }

      if (queryText.includes('FROM "datasources"')) {
        return this.result(databaseType, this.selectDatasourceRows<T>(queryText, params))
      }

      if (queryText.includes('FROM "apps"')) {
        return this.result(databaseType, this.selectApps<T>(queryText, params))
      }

      if (queryText.includes('FROM "api_builder_samples"')) {
        return this.result(databaseType, this.selectApiBuilderSamples<T>(queryText, params))
      }

      if (queryText.includes('FROM "apis"')) {
        return this.result(databaseType, this.selectApis<T>(queryText, params))
      }

      if (queryText.includes('FROM "pages"')) {
        return this.result(databaseType, this.selectPages<T>(queryText, params))
      }

      return this.result(databaseType, this.selectEmployees<T>(queryText, params))
    }

    if (queryText.startsWith('UPDATE "employees"') || queryText.startsWith('UPDATE "users"')) {
      return this.result(databaseType, this.updateEmployees<T>(queryText, params))
    }

    if (queryText.startsWith('UPDATE "pages"')) {
      return this.result(databaseType, this.updatePages<T>(queryText, params))
    }

    if (queryText.startsWith('UPDATE "apps"')) {
      return this.result(databaseType, this.updateApps<T>(queryText, params))
    }

    if (queryText.startsWith('UPDATE "datasources"')) {
      return this.result(databaseType, this.updateDatasourceRows<T>(queryText, params))
    }

    if (queryText.startsWith('DELETE FROM "employees"') || queryText.startsWith('DELETE FROM "users"')) {
      return this.result(databaseType, this.deleteEmployees<T>(queryText, params))
    }

    if (queryText.startsWith('DELETE FROM "apis"')) {
      return this.result(databaseType, this.deleteApis<T>(queryText, params))
    }

    throw new Error(`Unsupported SQL in test fake: ${queryText}`)
  }

  private result<T extends Record<string, unknown>>(
    databaseType: DatabaseType,
    rows: T[],
    metadata: Omit<SqlExecutionResult<T>, 'databaseType' | 'rows'> = {},
  ): SqlExecutionResult<T> {
    return {
      databaseType,
      rows,
      ...metadata,
    }
  }

  private ensureDefaultEnterprise() {
    if (!this.enterprise.length) {
      this.enterprise.push({
        id: 1,
        uuid: crypto.randomUUID(),
        name: '默认企业',
      })
    }

    return this.enterprise[0]!
  }

  private insertEnterprise<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const columns = this.insertColumns(queryText, 'enterprise')
    const row: EnterpriseRow = {
      id: this.enterprise.length + 1,
      uuid: crypto.randomUUID(),
      name: '',
    }

    columns.forEach((column, index) => {
      row[column as keyof EnterpriseRow] = this.parseJsonParam(params[index]) as never
    })

    this.enterprise.push(row)

    return [this.projectReturning(row, queryText)] as T[]
  }

  private insertEmployee<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const table = queryText.startsWith('INSERT INTO "employees"') ? 'employees' : 'users'
    const columns = this.insertColumns(queryText, table)
    const now = new Date().toISOString()
    const row: EmployeeRow = {
      id: crypto.randomUUID(),
      enterprise_uuid: '',
      name: '',
      email: '',
      password_hash: '',
      plan: 'free',
      created_at: now,
      updated_at: now,
    }

    columns.forEach((column, index) => {
      row[column as keyof EmployeeRow] = params[index] as never
    })

    if (!row.enterprise_uuid) {
      row.enterprise_uuid = this.ensureDefaultEnterprise().uuid
    }

    this.employees.push(row)

    return [this.projectReturning(row, queryText)] as T[]
  }

  private insertPage<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const columns = this.insertColumns(queryText, 'pages')
    const now = new Date().toISOString()
    const row: PageRow = {
      uuid: crypto.randomUUID(),
      name: '',
      blocks: [],
      created_at: now,
      updated_at: now,
    }

    columns.forEach((column, index) => {
      row[column as keyof PageRow] = this.parseJsonParam(params[index]) as never
    })

    this.pages.push(row)

    return [this.projectReturning(row, queryText)] as T[]
  }

  private insertApp<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const columns = this.insertColumns(queryText, 'apps')
    const row: AppRow = {
      id: this.apps.length + 1,
      uuid: crypto.randomUUID().replaceAll('-', '').slice(0, 8),
      alias: '',
      description: '',
    }

    columns.forEach((column, index) => {
      row[column as keyof AppRow] = this.parseJsonParam(params[index]) as never
    })

    this.apps.push(row)

    return [this.projectReturning(row, queryText)] as T[]
  }

  private insertDatasource<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const columns = this.insertColumns(queryText, 'datasources')
    const row: DatasourceRow = {
      id: this.datasourceRows.length + 1,
      uuid: `d${crypto.randomUUID().replaceAll('-', '').slice(0, 7)}`,
      alias: '',
      description: '',
      schema_data: [],
    }

    columns.forEach((column, index) => {
      row[column as keyof DatasourceRow] = this.parseJsonParam(params[index]) as never
    })

    this.datasourceRows.push(row)
    return [this.projectReturning(row, queryText)] as T[]
  }

  private upsertApi<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const columns = this.insertColumns(queryText, 'apis')
    const now = new Date().toISOString()
    const nextRow: ApiRow = {
      uuid: '',
      name: '',
      method: 'GET',
      status: 'draft',
      api_json: {},
      layout: {},
      created_at: now,
      updated_at: now,
    }

    columns.forEach((column, index) => {
      nextRow[column as keyof ApiRow] = this.parseJsonParam(params[index]) as never
    })

    const existing = this.apis.find((api) => api.uuid === nextRow.uuid)

    if (existing) {
      Object.assign(existing, {
        name: nextRow.name,
        method: nextRow.method,
        status: nextRow.status,
        api_json: nextRow.api_json,
        layout: nextRow.layout,
        updated_at: nextRow.updated_at,
      })

      return [this.projectReturning(existing, queryText)] as T[]
    }

    this.apis.push(nextRow)

    return [this.projectReturning(nextRow, queryText)] as T[]
  }

  private insertApiSnapshot<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const columns = this.insertColumns(queryText, 'apis_snapshot')
    const now = new Date().toISOString()
    const row: ApiSnapshotRow = {
      id: crypto.randomUUID(),
      api_uuid: '',
      name: '',
      method: 'GET',
      status: 'draft',
      api_json: {},
      created_at: now,
    }

    columns.forEach((column, index) => {
      row[column as keyof ApiSnapshotRow] = this.parseJsonParam(params[index]) as never
    })

    this.apiSnapshots.push(row)

    return [this.projectReturning(row, queryText)] as T[]
  }

  private selectEnterprise<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const fields = this.selectFields(queryText)
    const enterprise = this.filterEnterprise(queryText, params)
    const rows = queryText.includes(' LIMIT 1') ? enterprise.slice(0, 1) : enterprise

    return rows.map((row) => this.projectFields(row, fields)) as T[]
  }

  private selectEmployees<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const fields = this.selectFields(queryText)
    const employees = this.filterEmployees(queryText, params)
    const rows = queryText.includes(' OFFSET ')
      ? employees.slice(Number(params.at(-1) ?? 0), Number(params.at(-1) ?? 0) + Number(params.at(-2) ?? 1))
      : queryText.includes(' LIMIT 1')
        ? employees.slice(0, 1)
        : employees

    return rows.map((row) => this.projectFields(row, fields)) as T[]
  }

  private selectPages<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const fields = this.selectFields(queryText)
    const pages = this.filterPages(queryText, params)
    const sortedPages = queryText.includes('ORDER BY "updated_at" DESC')
      ? pages.sort((firstPage, secondPage) => (
          secondPage.updated_at.localeCompare(firstPage.updated_at)
          || secondPage.created_at.localeCompare(firstPage.created_at)
        ))
      : pages
    const rows = queryText.includes(' OFFSET ')
      ? sortedPages.slice(Number(params.at(-1) ?? 0), Number(params.at(-1) ?? 0) + Number(params.at(-2) ?? 1))
      : queryText.includes(' LIMIT 1')
        ? sortedPages.slice(0, 1)
        : sortedPages

    return rows.map((row) => this.projectFields(row, fields)) as T[]
  }

  private selectApps<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const fields = this.selectFields(queryText)
    const apps = this.filterApps(queryText, params)
    const sortedApps = queryText.includes('ORDER BY "id" DESC')
      ? apps.sort((firstApp, secondApp) => secondApp.id - firstApp.id)
      : apps
    const rows = queryText.includes(' OFFSET ')
      ? sortedApps.slice(Number(params.at(-1) ?? 0), Number(params.at(-1) ?? 0) + Number(params.at(-2) ?? 1))
      : queryText.includes(' LIMIT 1')
        ? sortedApps.slice(0, 1)
        : sortedApps

    return rows.map((row) => this.projectFields(row, fields)) as T[]
  }

  private selectDatasourceRows<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const fields = this.selectFields(queryText)
    const datasourceRows = this.filterDatasourceRows(queryText, params)
    const sortedRows = queryText.includes('ORDER BY "id" DESC')
      ? datasourceRows.sort((first, second) => second.id - first.id)
      : datasourceRows
    const rows = queryText.includes(' OFFSET ')
      ? sortedRows.slice(Number(params.at(-1) ?? 0), Number(params.at(-1) ?? 0) + Number(params.at(-2) ?? 1))
      : queryText.includes(' LIMIT 1')
        ? sortedRows.slice(0, 1)
        : sortedRows

    return rows.map((row) => this.projectFields(row, fields)) as T[]
  }

  private selectApis<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const fields = this.selectFields(queryText)
    const apis = this.filterApis(queryText, params)
    const sortedApis = queryText.includes('ORDER BY "updated_at" DESC')
      ? apis.sort((firstApi, secondApi) => (
          secondApi.updated_at.localeCompare(firstApi.updated_at)
          || secondApi.created_at.localeCompare(firstApi.created_at)
        ))
      : apis
    const rows = queryText.includes(' OFFSET ')
      ? sortedApis.slice(Number(params.at(-1) ?? 0), Number(params.at(-1) ?? 0) + Number(params.at(-2) ?? 1))
      : queryText.includes(' LIMIT 1')
        ? sortedApis.slice(0, 1)
        : sortedApis

    return rows.map((row) => this.projectFields(row, fields)) as T[]
  }

  private selectApiBuilderSamples<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const fields = this.selectFields(queryText)
    const samples = this.filterApiBuilderSamples(queryText, params)
    const sortedSamples = queryText.includes('ORDER BY "sort_order" ASC')
      ? samples.sort((firstSample, secondSample) => (
          firstSample.sort_order - secondSample.sort_order
          || firstSample.created_at.localeCompare(secondSample.created_at)
        ))
      : samples
    const rows = queryText.includes(' OFFSET ')
      ? sortedSamples.slice(Number(params.at(-1) ?? 0), Number(params.at(-1) ?? 0) + Number(params.at(-2) ?? 1))
      : queryText.includes(' LIMIT 1')
        ? sortedSamples.slice(0, 1)
        : sortedSamples

    return rows.map((row) => this.projectFields(row, fields)) as T[]
  }

  private updateEmployees<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const setMatch = / SET (.*?) WHERE /.exec(queryText) ?? / SET (.*?) RETURNING /.exec(queryText)
    const setFields = setMatch?.[1]?.match(/"([^"]+)" =/g)?.map((field) => field.replace(/" =$/, '').replaceAll('"', '')) ?? []
    const setParamCount = setFields.length
    const employees = this.filterEmployees(queryText, params.slice(setParamCount))

    for (const employee of employees) {
      setFields.forEach((field, index) => {
        employee[field as keyof EmployeeRow] = params[index] as never
      })
    }

    return employees.map(() => ({ affected_marker: 1 })) as unknown as T[]
  }

  private deleteApis<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const apis = this.filterApis(queryText, params)
    const uuids = new Set(apis.map((api) => api.uuid))

    for (let index = this.apis.length - 1; index >= 0; index -= 1) {
      if (uuids.has(this.apis[index]?.uuid || '')) {
        this.apis.splice(index, 1)
      }
    }

    return apis.map(() => ({ affected_marker: 1 })) as unknown as T[]
  }

  private updatePages<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const setMatch = / SET (.*?) WHERE /.exec(queryText) ?? / SET (.*?) RETURNING /.exec(queryText)
    const setFields = setMatch?.[1]?.match(/"([^"]+)" =/g)?.map((field) => field.replace(/" =$/, '').replaceAll('"', '')) ?? []
    const setParamCount = setFields.length
    const pages = this.filterPages(queryText, params.slice(setParamCount))

    for (const page of pages) {
      setFields.forEach((field, index) => {
        page[field as keyof PageRow] = this.parseJsonParam(params[index]) as never
      })
    }

    return queryText.includes('affected_marker')
      ? pages.map(() => ({ affected_marker: 1 })) as unknown as T[]
      : pages.map((page) => this.projectReturning(page, queryText)) as T[]
  }

  private updateApps<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const setMatch = / SET (.*?) WHERE /.exec(queryText) ?? / SET (.*?) RETURNING /.exec(queryText)
    const setFields = setMatch?.[1]?.match(/"([^"]+)" =/g)?.map((field) => field.replace(/" =$/, '').replaceAll('"', '')) ?? []
    const setParamCount = setFields.length
    const apps = this.filterApps(queryText, params.slice(setParamCount))

    for (const app of apps) {
      setFields.forEach((field, index) => {
        app[field as keyof AppRow] = this.parseJsonParam(params[index]) as never
      })
    }

    return apps.map(() => ({ affected_marker: 1 })) as unknown as T[]
  }

  private updateDatasourceRows<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const setMatch = / SET (.*?) WHERE /.exec(queryText) ?? / SET (.*?) RETURNING /.exec(queryText)
    const setFields = setMatch?.[1]?.match(/"([^"]+)" =/g)?.map((field) => field.replace(/" =$/, '').replaceAll('"', '')) ?? []
    const setParamCount = setFields.length
    const datasourceRows = this.filterDatasourceRows(queryText, params.slice(setParamCount))

    for (const datasource of datasourceRows) {
      setFields.forEach((field, index) => {
        datasource[field as keyof DatasourceRow] = this.parseJsonParam(params[index]) as never
      })
    }

    return datasourceRows.map(() => ({ affected_marker: 1 })) as unknown as T[]
  }

  private deleteEmployees<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const employees = this.filterEmployees(queryText, params)
    const ids = new Set(employees.map((employee) => employee.id))

    for (let index = this.employees.length - 1; index >= 0; index -= 1) {
      if (ids.has(this.employees[index]?.id || '')) {
        this.employees.splice(index, 1)
      }
    }

    return employees.map(() => ({ affected_marker: 1 })) as unknown as T[]
  }

  private selectFields(queryText: string) {
    const fieldMatch = /^SELECT (.*?) FROM /.exec(queryText)
    return fieldMatch?.[1]?.match(/"([^"]+)"/g)?.map((field) => field.replaceAll('"', '')) ?? []
  }

  private projectFields(row: Record<string, unknown>, fields: string[]) {
    return Object.fromEntries(fields.map((field) => [field, row[field]]))
  }

  private projectReturning(row: Record<string, unknown>, queryText: string) {
    const returningMatch = / RETURNING (.*)$/.exec(queryText)
    const fields = returningMatch?.[1]?.match(/"([^"]+)"/g)?.map((field) => {
      return field.replaceAll('"', '')
    }) ?? []

    return this.projectFields(row, fields)
  }

  private insertColumns(queryText: string, table: string) {
    const columnMatch = new RegExp(`INSERT INTO "${table}" \\((.*?)\\) VALUES`).exec(queryText)
    return columnMatch?.[1]?.match(/"([^"]+)"/g)?.map((column) => column.replaceAll('"', '')) ?? []
  }

  private parseJsonParam(value: unknown) {
    if (typeof value !== 'string') {
      return value
    }

    try {
      return JSON.parse(value) as unknown
    } catch {
      return value
    }
  }

  private filterEnterprise(queryText: string, params: unknown[]) {
    if (!queryText.includes(' WHERE ')) {
      return [...this.enterprise]
    }

    if (queryText.includes('"uuid" =')) {
      const uuid = params.at(-1)
      return this.enterprise.filter((item) => item.uuid === uuid)
    }

    if (queryText.includes('"id" =')) {
      const id = Number(params.at(-1))
      return this.enterprise.filter((item) => item.id === id)
    }

    if (queryText.includes('"name" =')) {
      const name = params.at(-1)
      return this.enterprise.filter((item) => item.name === name)
    }

    return [...this.enterprise]
  }

  private filterEmployees(queryText: string, params: unknown[]) {
    if (!queryText.includes(' WHERE ')) {
      return [...this.employees]
    }

    if (queryText.includes('"id" =')) {
      const id = params.at(-1)
      return this.employees.filter((employee) => employee.id === id)
    }

    if (queryText.includes('"enterprise_uuid" =')) {
      const enterpriseUuid = params.at(-1)
      return this.employees.filter((employee) => employee.enterprise_uuid === enterpriseUuid)
    }

    if (queryText.includes('"plan" =')) {
      const plan = params.at(-1)
      return this.employees.filter((employee) => employee.plan === plan)
    }

    if (queryText.includes('"email" =')) {
      const email = params.at(-1)
      return this.employees.filter((employee) => employee.email === email)
    }

    if (queryText.includes('"name" =') && queryText.includes('"created_at" >=')) {
      const [name, createdAtBegin, createdAtEnd] = params

      return this.employees.filter((employee) => (
        employee.name === name
        && employee.created_at >= String(createdAtBegin)
        && employee.created_at <= String(createdAtEnd)
      ))
    }

    if (queryText.includes('"id" IN')) {
      return this.employees.filter((employee) => params.includes(employee.id))
    }

    return [...this.employees]
  }

  private filterPages(queryText: string, params: unknown[]) {
    if (!queryText.includes(' WHERE ')) {
      return [...this.pages]
    }

    const whereText = queryText.split(' WHERE ')[1] ?? ''
    let result = [...this.pages]
    let paramIndex = 0

    if (whereText.includes('"uuid" =')) {
      const uuid = params[paramIndex++]
      result = result.filter((page) => page.uuid === uuid)
    }

    if (whereText.includes('"name" =')) {
      const name = params[paramIndex++]
      result = result.filter((page) => page.name === name)
    }

    if (whereText.includes('"created_at" >=')) {
      const createdAtBegin = String(params[paramIndex++] ?? '')
      result = result.filter((page) => page.created_at >= createdAtBegin)
    }

    if (whereText.includes('"created_at" <=')) {
      const createdAtEnd = String(params[paramIndex++] ?? '')
      result = result.filter((page) => page.created_at <= createdAtEnd)
    }

    return result
  }

  private filterApps(queryText: string, params: unknown[]) {
    if (!queryText.includes(' WHERE ')) {
      return [...this.apps]
    }

    if (queryText.includes('"id" =')) {
      const id = Number(params.at(-1))
      return this.apps.filter((app) => app.id === id)
    }

    if (queryText.includes('"uuid" =')) {
      const uuid = params.at(-1)
      return this.apps.filter((app) => app.uuid === uuid)
    }

    return [...this.apps]
  }

  private filterDatasourceRows(queryText: string, params: unknown[]) {
    if (!queryText.includes(' WHERE ')) {
      return [...this.datasourceRows]
    }

    if (queryText.includes('"id" =')) {
      const id = Number(params.at(-1))
      return this.datasourceRows.filter((datasource) => datasource.id === id)
    }

    if (queryText.includes('"uuid" =')) {
      const uuid = params.at(-1)
      return this.datasourceRows.filter((datasource) => datasource.uuid === uuid)
    }

    return [...this.datasourceRows]
  }

  private filterApis(queryText: string, params: unknown[]) {
    if (!queryText.includes(' WHERE ')) {
      return [...this.apis]
    }

    if (queryText.includes('"uuid" =') && queryText.includes('"uuid" <>')) {
      const [uuid, ignoredUuid] = params
      return this.apis.filter((api) => api.uuid === uuid && api.uuid !== ignoredUuid)
    }

    if (queryText.includes('"uuid" =') && queryText.includes('"status" =')) {
      const [uuid, status] = params
      return this.apis.filter((api) => api.uuid === uuid && api.status === status)
    }

    if (queryText.includes('"uuid" =')) {
      const uuid = params.at(-1)
      return this.apis.filter((api) => api.uuid === uuid)
    }

    return [...this.apis]
  }

  private filterApiBuilderSamples(queryText: string, params: unknown[]) {
    if (!queryText.includes(' WHERE ')) {
      return [...this.apiBuilderSamples]
    }

    const whereText = queryText.split(' WHERE ')[1] ?? ''
    let result = [...this.apiBuilderSamples]
    let paramIndex = 0

    if (whereText.includes('"status" =')) {
      const status = params[paramIndex++]
      result = result.filter((sample) => sample.status === status)
    }

    if (whereText.includes('"uuid" =')) {
      const uuid = params[paramIndex++]
      result = result.filter((sample) => sample.uuid === uuid)
    }

    return result
  }
}

type RecordedQuery = {
  datasource: string
  databaseType: DatabaseType
  sql: string
  params: unknown[]
}

class MysqlRecordingExecutor {
  readonly queries: RecordedQuery[] = []

  execute = async <T extends Record<string, unknown> = Record<string, unknown>>(
    query: SQL,
    datasource: string,
    databaseType: DatabaseType,
  ): Promise<SqlExecutionResult<T>> => {
    const builtQuery = mysqlDialect.sqlToQuery(query)
    const queryText = builtQuery.sql.replace(/\s+/g, ' ').trim()
    const params = builtQuery.params

    this.queries.push({
      datasource,
      databaseType,
      sql: queryText,
      params,
    })

    if (queryText.startsWith('SELECT DATA_TYPE AS data_type')) {
      return this.result(databaseType, [{
        data_type: 'int',
        column_default: null,
        extra: 'auto_increment',
      }] as unknown as T[])
    }

    if (queryText.startsWith('INSERT INTO `smart_contracts`')) {
      return this.result<T>(databaseType, [], { affectedRows: 1, insertId: 42 })
    }

    if (queryText.startsWith('SELECT count(*) AS total FROM `smart_contracts`')) {
      return this.result(databaseType, [{ total: '1' }] as unknown as T[])
    }

    if (queryText.startsWith('SELECT')) {
      return this.result(databaseType, [{
        id: 42,
        address: '0xabc',
        abi_json: '{"ok":true}',
      }] as unknown as T[])
    }

    if (queryText.startsWith('UPDATE `smart_contracts`')) {
      return this.result<T>(databaseType, [], { affectedRows: 1 })
    }

    if (queryText.startsWith('DELETE FROM `smart_contracts`')) {
      return this.result<T>(databaseType, [], { affectedRows: 1 })
    }

    throw new Error(`Unsupported MySQL SQL in test fake: ${queryText}`)
  }

  private result<T extends Record<string, unknown>>(
    databaseType: DatabaseType,
    rows: T[],
    metadata: Omit<SqlExecutionResult<T>, 'databaseType' | 'rows'> = {},
  ): SqlExecutionResult<T> {
    return {
      databaseType,
      rows,
      ...metadata,
    }
  }
}

async function startServer(handler: EventHandler = orchestrationHandler): Promise<TestServer> {
  const app = createApp()
  const router = createRouter()

  router.use('/api/mokelay/:apiJsonUuid', handler)
  router.use('/api/mokelay', missingApiJsonUuidHandler)
  app.use(router)

  const server = createServer(toNodeListener(app))

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
  }
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function readJson<T>(response: Response) {
  return await response.json() as T
}

async function readMokelaySuccess<T>(response: Response) {
  const body = await readJson<MokelaySuccessBody<T>>(response)

  expect(body.ok).toBe(true)

  return body
}

async function readMokelayData<T>(response: Response) {
  return (await readMokelaySuccess<T>(response)).data
}

async function expectMokelayError(response: Response, code: MokelayErrorCode, message?: string | RegExp) {
  expect(response.status).toBe(200)

  const body = await readJson<MokelayErrorBody>(response)

  expect(body.ok).toBe(false)
  expect(body.error.code).toBe(code)

  if (typeof message === 'string') {
    expect(body.error.message).toBe(message)
  } else if (message) {
    expect(body.error.message).toMatch(message)
  }

  return body
}

function responseCookie(response: Response, name: string) {
  return response.headers.get('set-cookie')?.split(';')[0] || `${name}=`
}

function clearApiR2Env() {
  for (const key of apiR2EnvKeys) {
    delete process.env[key]
  }
}

function configureApiR2Env() {
  process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'account-id'
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'access-key-id'
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-access-key'
  process.env.MOKELAY_APIS_R2_BUCKET = 'mokelay-api-json'
  process.env.MOKELAY_APIS_R2_PREFIX = 'mokelay-apis'
}

async function postJson(baseUrl: string, apiJsonUuid: string, body: Record<string, unknown>, query = '') {
  return await fetch(`${baseUrl}/api/mokelay/${apiJsonUuid}${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function createUser(baseUrl: string, input: { name: string, email: string }) {
  const response = await postJson(baseUrl, 'create_user_info', {
    name: input.name,
    email: input.email,
    password_hash: `hashed:${input.email}`,
  })

  expect(response.status).toBe(200)
  return await readMokelayData<CreateUserResponse>(response)
}

async function createPage(baseUrl: string, input: { uuid?: string, name: string, blocks: unknown[] }) {
  const response = await postJson(baseUrl, 'create_page', input)

  expect(response.status).toBe(200)
  return await readMokelayData<PageResponse>(response)
}

async function createMokelayApp(baseUrl: string, input: { uuid: string, alias: string, description?: string }) {
  const response = await postJson(baseUrl, 'create_app', input)

  expect(response.status).toBe(200)
  return await readMokelayData<AppResponse>(response)
}

async function createMokelayDatasource(baseUrl: string, input: { uuid: string, alias: string, description?: string }) {
  const response = await postJson(baseUrl, 'create_datasource', input)

  expect(response.status).toBe(200)
  return await readMokelayData<DatasourceResponse>(response)
}

describe('mokelay orchestration API', () => {
  let testServer: TestServer
  let fakeSqlExecutor: FakeSqlExecutor
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    fakeSqlExecutor = new FakeSqlExecutor()
    process.env = {
      ...originalEnv,
      Mokelay_DATABASE_URL: 'postgres://unit-test',
      NODE_ENV: 'test',
    }
    clearApiR2Env()
    apiR2MockState.sentInputs.length = 0
    apiR2MockState.failPut = false
    testServer = await startServer(createMokelayOrchestrationHandler({
      executeSql: fakeSqlExecutor.execute,
    }))
  })

  afterEach(async () => {
    await testServer.close()
    process.env = { ...originalEnv }
  })

  it('executes the five stored user API JSON definitions', async () => {
    const created = await createUser(testServer.baseUrl, {
      name: 'Alice',
      email: 'alice@mokelay.test',
    })

    expect(created.id).toMatch(uuidPattern)

    const readResponse = await fetch(`${testServer.baseUrl}/api/mokelay/read_user_by_id?id=${created.id}`)
    const readBody = await readMokelayData<ReadUserResponse>(readResponse)

    expect(readResponse.status).toBe(200)
    expect(readBody.user_info).toMatchObject({
      id: created.id,
      name: 'Alice',
      email: 'alice@mokelay.test',
    })
    expect(Date.parse(readBody.user_info?.created_at || '')).not.toBeNaN()
    expect(Date.parse(readBody.user_info?.updated_at || '')).not.toBeNaN()

    const updateResponse = await postJson(
      testServer.baseUrl,
      'update_user_info_by_id',
      {
        name: 'Alice Updated',
        email: 'alice.updated@mokelay.test',
      },
      `?id=${created.id}`,
    )
    const updateBody = await readMokelayData<Record<string, unknown>>(updateResponse)

    expect(updateResponse.status).toBe(200)
    expect(updateBody).toEqual({ update: true })

    const updatedReadResponse = await fetch(`${testServer.baseUrl}/api/mokelay/read_user_by_id?id=${created.id}`)
    const updatedReadBody = await readMokelayData<ReadUserResponse>(updatedReadResponse)

    expect(updatedReadBody.user_info).toMatchObject({
      id: created.id,
      name: 'Alice Updated',
      email: 'alice.updated@mokelay.test',
    })

    const bob = await createUser(testServer.baseUrl, {
      name: 'Bob',
      email: 'bob@mokelay.test',
    })
    const bobRow = fakeSqlExecutor.users.find((user) => user.id === bob.id)

    expect(bobRow).toBeDefined()

    if (bobRow) {
      bobRow.plan = 'pro'
    }

    const countFreeUsersResponse = await fetch(`${testServer.baseUrl}/api/mokelay/count_free_users`)
    const countFreeUsersBody = await readMokelayData<CountFreeUsersResponse>(countFreeUsersResponse)

    expect(countFreeUsersResponse.status).toBe(200)
    expect(countFreeUsersBody).toEqual({ total: 1 })

    const listResponse = await postJson(testServer.baseUrl, 'read_user_list', {
      created_at_begin: '1970-01-01T00:00:00.000Z',
      created_at_end: '2999-12-31T23:59:59.999Z',
      name: 'Alice Updated',
    })
    const listBody = await readMokelayData<UserListResponse>(listResponse)

    expect(listResponse.status).toBe(200)
    expect(listBody.user_list).toHaveLength(1)
    expect(listBody.user_list[0]).toMatchObject({
      id: created.id,
      name: 'Alice Updated',
      email: 'alice.updated@mokelay.test',
    })

    const deleteResponse = await postJson(testServer.baseUrl, 'delete_user_info_by_id', {
      id: created.id,
    })
    const deleteBody = await readMokelayData<Record<string, unknown>>(deleteResponse)

    expect(deleteResponse.status).toBe(200)
    expect(deleteBody).toEqual({ message: '删除成功' })

    const missingReadResponse = await fetch(`${testServer.baseUrl}/api/mokelay/read_user_by_id?id=${created.id}`)
    const missingReadBody = await readMokelayData<ReadUserResponse>(missingReadResponse)

    expect(missingReadResponse.status).toBe(200)
    expect(missingReadBody.user_info).toBeNull()
    expect(new Set(fakeSqlExecutor.datasources)).toEqual(new Set(['Mokelay']))
  })

  it('executes the stored register API JSON with request, output, and session processors', async () => {
    const response = await postJson(testServer.baseUrl, 'register', {
      enterprise_name: '  Register Enterprise  ',
      name: '  Register User  ',
      email: '  register@mokelay.test  ',
      password: 'abc12345',
    })
    const body = await readMokelayData<RegisterResponse>(response)
    const row = fakeSqlExecutor.employees.find((employee) => employee.email === 'register@mokelay.test')
    const enterprise = fakeSqlExecutor.enterprise.find((item) => item.name === 'Register Enterprise')

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain(`${orchestrationSessionCookieName}=`)
    expect(body.user).toMatchObject({
      id: expect.stringMatching(uuidPattern),
      enterprise_uuid: expect.stringMatching(uuidPattern),
      enterprise_name: 'Register Enterprise',
      name: 'Register User',
      email: 'register@mokelay.test',
      plan: 'free',
    })
    expect(enterprise).toBeDefined()
    expect(row).toBeDefined()
    expect(row?.enterprise_uuid).toBe(enterprise?.uuid)
    expect(row?.name).toBe('Register User')
    expect(row?.password_hash).not.toBe('abc12345')
    expect(await verifyPassword(row?.password_hash || '', 'abc12345')).toBe(true)
  })

  it('stops stored register when the output processor detects a duplicate email', async () => {
    const firstResponse = await postJson(testServer.baseUrl, 'register', {
      enterprise_name: 'Duplicate Enterprise',
      name: 'First Register',
      email: 'duplicate@mokelay.test',
      password: 'abc12345',
    })

    expect(firstResponse.status).toBe(200)
    expect((await readMokelaySuccess<RegisterResponse>(firstResponse)).ok).toBe(true)

    const duplicateResponse = await postJson(testServer.baseUrl, 'register', {
      enterprise_name: 'Duplicate Enterprise Two',
      name: 'Duplicate Register',
      email: 'duplicate@mokelay.test',
      password: 'abc12345',
    })

    await expectMokelayError(duplicateResponse, 'PROCESSOR_VALIDATION_FAILED', /Processor eq/)
    expect(fakeSqlExecutor.employees).toHaveLength(1)
    expect(fakeSqlExecutor.enterprise.filter((item) => item.name.startsWith('Duplicate Enterprise'))).toHaveLength(1)
  })

  it('executes the stored login API JSON and stores the public user in orchestration session', async () => {
    const registerResponse = await postJson(testServer.baseUrl, 'register', {
      enterprise_name: 'Login Enterprise',
      name: 'Login User',
      email: 'login@mokelay.test',
      password: 'abc12345',
    })

    expect(registerResponse.status).toBe(200)
    expect((await readMokelaySuccess<RegisterResponse>(registerResponse)).ok).toBe(true)

    const loginResponse = await postJson(testServer.baseUrl, 'login', {
      email: '  login@mokelay.test  ',
      password: 'abc12345',
    })
    const body = await readMokelayData<RegisterResponse>(loginResponse)

    expect(loginResponse.status).toBe(200)
    expect(loginResponse.headers.get('set-cookie')).toContain(`${orchestrationSessionCookieName}=`)
    expect(body.user).toEqual(expect.objectContaining({
      id: expect.stringMatching(uuidPattern),
      enterprise_uuid: expect.stringMatching(uuidPattern),
      enterprise_name: 'Login Enterprise',
      name: 'Login User',
      email: 'login@mokelay.test',
      plan: 'free',
    }))
    expect(body.user).not.toHaveProperty('password_hash')
  })

  it('rejects stored login JSON for unknown users, wrong passwords, and invalid email', async () => {
    const registerResponse = await postJson(testServer.baseUrl, 'register', {
      enterprise_name: 'Password Enterprise',
      name: 'Password User',
      email: 'password-user@mokelay.test',
      password: 'abc12345',
    })

    expect(registerResponse.status).toBe(200)

    const unknownUserResponse = await postJson(testServer.baseUrl, 'login', {
      email: 'unknown@mokelay.test',
      password: 'abc12345',
    })
    const wrongPasswordResponse = await postJson(testServer.baseUrl, 'login', {
      email: 'password-user@mokelay.test',
      password: 'wrong12345',
    })
    const invalidEmailResponse = await postJson(testServer.baseUrl, 'login', {
      email: 'invalid-email',
      password: 'abc12345',
    })

    await expectMokelayError(unknownUserResponse, 'PROCESSOR_VALIDATION_FAILED', /Processor is_not_null/)
    await expectMokelayError(wrongPasswordResponse, 'PROCESSOR_VALIDATION_FAILED', /Processor hash_check/)
    await expectMokelayError(invalidEmailResponse, 'PROCESSOR_VALIDATION_FAILED', /Processor email_check/)
  })

  it('executes stored me and logout API JSON against the orchestration session', async () => {
    const anonymousMeResponse = await fetch(`${testServer.baseUrl}/api/mokelay/me`)
    const anonymousMe = await readMokelayData<Record<string, unknown>>(anonymousMeResponse)

    expect(anonymousMeResponse.status).toBe(200)
    expect(anonymousMe).toEqual({
      loggedIn: false,
      user: null,
    })

    const registerResponse = await postJson(testServer.baseUrl, 'register', {
      enterprise_name: 'Session Enterprise',
      name: 'Session User',
      email: 'session@mokelay.test',
      password: 'abc12345',
    })
    const cookie = responseCookie(registerResponse, orchestrationSessionCookieName)
    const meResponse = await fetch(`${testServer.baseUrl}/api/mokelay/me`, {
      headers: { cookie },
    })
    const meBody = await readMokelayData<Record<string, unknown>>(meResponse)

    expect(registerResponse.status).toBe(200)
    expect(meResponse.status).toBe(200)
    expect(meBody).toEqual({
      loggedIn: true,
      user: expect.objectContaining({
        id: expect.stringMatching(uuidPattern),
        enterprise_uuid: expect.stringMatching(uuidPattern),
        enterprise_name: 'Session Enterprise',
        name: 'Session User',
        email: 'session@mokelay.test',
        plan: 'free',
      }),
    })

    const logoutResponse = await fetch(`${testServer.baseUrl}/api/mokelay/logout`, {
      method: 'POST',
      headers: { cookie },
    })
    const logoutBody = await readMokelayData<Record<string, unknown>>(logoutResponse)

    expect(logoutResponse.status).toBe(200)
    expect(logoutResponse.headers.get('set-cookie')).toContain(`${orchestrationSessionCookieName}=`)
    expect(logoutResponse.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(logoutBody).toEqual({ ok: true })
  })

  it('rejects invalid stored register request processor inputs', async () => {
    const cases: Array<{
      body: Record<string, unknown>
      message: RegExp
    }> = [
      {
        body: { enterprise_name: 'Invalid Enterprise', name: 'Invalid Email', email: 'not-email', password: 'abc12345' },
        message: /Processor email_check/,
      },
      {
        body: { enterprise_name: 'Short Password Enterprise', name: 'Short Password', email: 'short-password@mokelay.test', password: 'a1' },
        message: /Processor min/,
      },
      {
        body: { enterprise_name: 'Missing Digit Enterprise', name: 'Missing Digit', email: 'missing-digit@mokelay.test', password: 'abcdefgh' },
        message: /Processor regex/,
      },
      {
        body: { enterprise_name: 'Missing Letter Enterprise', name: 'Missing Letter', email: 'missing-letter@mokelay.test', password: '12345678' },
        message: /Processor regex/,
      },
      {
        body: { enterprise_name: '', name: 'Missing Enterprise', email: 'missing-enterprise@mokelay.test', password: 'abc12345' },
        message: /Processor is_not_null/,
      },
    ]

    for (const item of cases) {
      const response = await postJson(testServer.baseUrl, 'register', item.body)

      await expectMokelayError(response, 'PROCESSOR_VALIDATION_FAILED', item.message)
    }

    expect(fakeSqlExecutor.employees).toHaveLength(0)
  })

  it('applies processors on input and response templates', async () => {
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'template_processors',
        method: 'POST',
        request: {
          body: [{
            key: 'value',
            processors: ['trim'],
          }],
        },
        blocks: [
          {
            uuid: 'add',
            functionName: 'addSession',
            inputs: {
              key: 'processed',
              value: {
                template: '{{request.body.value}}',
                processors: [{
                  processor: 'eq',
                  param: ['abc'],
                }],
              },
            },
          },
          {
            uuid: 'read',
            functionName: 'readSession',
            inputs: { key: 'processed' },
            outputs: ['value'],
          },
        ],
        response: {
          echoed: {
            template: "  {{blocks['read'].outputs.value}}  ",
            processors: ['trim'],
          },
        },
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await postJson(server.baseUrl, 'template_processors', {
        value: '  abc  ',
      })
      const body = await readMokelayData<Record<string, unknown>>(response)

      expect(response.status).toBe(200)
      expect(body).toEqual({ echoed: 'abc' })
    } finally {
      await server.close()
    }
  })

  it('executes if_controller branches for boolean, number, string, and fallback values', async () => {
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'if_controller_values',
        method: 'POST',
        request: {
          body: [{ key: 'value' }],
        },
        blocks: [
          {
            uuid: 'starter',
            nextBlock: 'choose',
          },
          {
            uuid: 'choose',
            alias: '选择真假分支',
            functionName: 'if_controller',
            type: 'controller',
            inputs: {
              value: { template: '{{request.body.value}}' },
            },
            nodes: [
              {
                uuid: 'if_true_node',
                value: true,
                nextBlock: 'store_true',
              },
              {
                uuid: 'if_false_node',
                value: false,
                nextBlock: 'store_false',
              },
            ],
          },
          {
            uuid: 'store_true',
            functionName: 'addSession',
            inputs: {
              key: 'if-result',
              value: 'true-branch',
            },
            nextBlock: 'read_result',
          },
          {
            uuid: 'store_false',
            functionName: 'addSession',
            inputs: {
              key: 'if-result',
              value: 'false-branch',
            },
            nextBlock: 'read_result',
          },
          {
            uuid: 'read_result',
            functionName: 'readSession',
            inputs: { key: 'if-result' },
            outputs: ['value'],
            nextBlock: null,
          },
        ],
        response: {
          result: { template: "{{blocks['read_result'].outputs.value}}" },
        },
      }),
    })
    const server = await startServer(handler)

    try {
      const cases: Array<{ value: unknown, expected: string }> = [
        { value: true, expected: 'true-branch' },
        { value: 1, expected: 'true-branch' },
        { value: 'ok', expected: 'true-branch' },
        { value: false, expected: 'false-branch' },
        { value: 0, expected: 'false-branch' },
        { value: '', expected: 'false-branch' },
        { value: null, expected: 'false-branch' },
        { value: { ok: true }, expected: 'false-branch' },
        { value: [], expected: 'false-branch' },
      ]

      for (const item of cases) {
        const response = await postJson(server.baseUrl, 'if_controller_values', {
          value: item.value,
        })
        const body = await readMokelayData<Record<string, unknown>>(response)

        expect(response.status).toBe(200)
        expect(body).toEqual({ result: item.expected })
      }
    } finally {
      await server.close()
    }
  })

  it('executes switch_controller cases, default nodes, nested controllers, and controller debug traces', async () => {
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'switch_controller_debug',
        method: 'POST',
        request: {
          body: [{ key: 'status' }],
        },
        blocks: [
          {
            uuid: 'starter',
            nextBlock: 'status_switch',
          },
          {
            uuid: 'status_switch',
            alias: '状态分支',
            functionName: 'switch_controller',
            type: 'controller',
            inputs: {
              value: { template: '{{request.body.status}}' },
              dataType: 'string',
            },
            nodes: [
              {
                uuid: 'published_node',
                value: 'published',
                nextBlock: 'nested_if',
              },
              {
                uuid: 'default_status_node',
                alias: '默认分支',
                type: 'DEFAULT',
                nextBlock: 'store_default',
              },
            ],
          },
          {
            uuid: 'nested_if',
            alias: '嵌套 if',
            functionName: 'if_controller',
            type: 'controller',
            inputs: { value: 1 },
            nodes: [
              {
                uuid: 'nested_true_node',
                value: true,
                nextBlock: 'store_nested',
              },
              {
                uuid: 'nested_false_node',
                value: false,
                nextBlock: 'store_status',
              },
            ],
          },
          {
            uuid: 'store_nested',
            functionName: 'addSession',
            inputs: {
              key: 'nested-result',
              value: 'nested-true',
            },
            nextBlock: 'store_status',
          },
          {
            uuid: 'store_status',
            functionName: 'addSession',
            inputs: {
              key: 'switch-result',
              value: 'published-branch',
            },
            nextBlock: 'read_switch',
          },
          {
            uuid: 'store_default',
            functionName: 'addSession',
            inputs: {
              key: 'switch-result',
              value: 'default-branch',
            },
            nextBlock: 'read_switch',
          },
          {
            uuid: 'read_switch',
            functionName: 'readSession',
            inputs: { key: 'switch-result' },
            outputs: ['value'],
            nextBlock: 'read_nested',
          },
          {
            uuid: 'read_nested',
            functionName: 'readSession',
            inputs: { key: 'nested-result' },
            outputs: ['value'],
            nextBlock: null,
          },
        ],
        response: {
          result: { template: "{{blocks['read_switch'].outputs.value}}" },
          nested: { template: "{{blocks['read_nested'].outputs.value}}" },
        },
      }),
    })
    const server = await startServer(handler)

    try {
      const publishedResponse = await postJson(server.baseUrl, 'switch_controller_debug', {
        status: 'published',
      }, '?__debug=1')
      const publishedBody = await readJson<MokelaySuccessBody<Record<string, unknown>> & { debug: MokelayDebugTrace }>(publishedResponse)

      expect(publishedResponse.status).toBe(200)
      expect(publishedBody.data).toEqual({
        result: 'published-branch',
        nested: 'nested-true',
      })
      expect(publishedBody.debug).toEqual({
        uuid: 'starter',
        nextBlock: {
          uuid: 'status_switch',
          type: 'controller',
          inputs: {
            value: 'published',
            dataType: 'string',
          },
          node: {
            uuid: 'published_node',
            nextBlock: {
              uuid: 'nested_if',
              type: 'controller',
              inputs: {
                value: 1,
              },
              node: {
                uuid: 'nested_true_node',
                nextBlock: {
                  uuid: 'store_nested',
                  type: 'block',
                  inputs: {
                    key: 'nested-result',
                    value: 'nested-true',
                  },
                  outputs: {},
                  nextBlock: {
                    uuid: 'store_status',
                    type: 'block',
                    inputs: {
                      key: 'switch-result',
                      value: 'published-branch',
                    },
                    outputs: {},
                    nextBlock: {
                      uuid: 'read_switch',
                      type: 'block',
                      inputs: {
                        key: 'switch-result',
                      },
                      outputs: {
                        value: 'published-branch',
                      },
                      nextBlock: {
                        uuid: 'read_nested',
                        type: 'block',
                        inputs: {
                          key: 'nested-result',
                        },
                        outputs: {
                          value: 'nested-true',
                        },
                        nextBlock: null,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
      expect(JSON.stringify(publishedBody.debug)).not.toContain('store_default')

      const defaultResponse = await postJson(server.baseUrl, 'switch_controller_debug', {
        status: 'draft',
      })
      const defaultBody = await readMokelayData<Record<string, unknown>>(defaultResponse)

      expect(defaultResponse.status).toBe(200)
      expect(defaultBody).toEqual({
        result: 'default-branch',
        nested: null,
      })
    } finally {
      await server.close()
    }
  })

  it('returns controller errors for invalid switch configuration', async () => {
    const apiJsons: Record<string, unknown> = {
      switch_data_type_error: {
        uuid: 'switch_data_type_error',
        method: 'POST',
        blocks: [
          { uuid: 'starter', nextBlock: 'switch' },
          {
            uuid: 'switch',
            functionName: 'switch_controller',
            type: 'controller',
            inputs: {
              value: 1,
              dataType: 'string',
            },
            nodes: [{
              uuid: 'default_node',
              type: 'DEFAULT',
              nextBlock: null,
            }],
          },
        ],
        response: { ok: true },
      },
      switch_duplicate_default: {
        uuid: 'switch_duplicate_default',
        method: 'POST',
        blocks: [
          { uuid: 'starter', nextBlock: 'switch' },
          {
            uuid: 'switch',
            functionName: 'switch_controller',
            type: 'controller',
            inputs: {
              value: 'draft',
              dataType: 'string',
            },
            nodes: [
              {
                uuid: 'default_node_one',
                type: 'DEFAULT',
                nextBlock: null,
              },
              {
                uuid: 'default_node_two',
                type: 'DEFAULT',
                nextBlock: null,
              },
            ],
          },
        ],
        response: { ok: true },
      },
      switch_missing_default: {
        uuid: 'switch_missing_default',
        method: 'POST',
        blocks: [
          { uuid: 'starter', nextBlock: 'switch' },
          {
            uuid: 'switch',
            functionName: 'switch_controller',
            type: 'controller',
            inputs: {
              value: 'draft',
              dataType: 'string',
            },
            nodes: [{
              uuid: 'published_node',
              value: 'published',
              nextBlock: null,
            }],
          },
        ],
        response: { ok: true },
      },
    }
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async (apiJsonUuid) => apiJsons[apiJsonUuid],
    })
    const server = await startServer(handler)

    try {
      await expectMokelayError(
        await postJson(server.baseUrl, 'switch_data_type_error', {}),
        'CONTROLLER_INVALID_INPUTS',
      )
      const duplicateDefaultBody = await expectMokelayError(
        await postJson(server.baseUrl, 'switch_duplicate_default', {}, '?__debug=1'),
        'CONTROLLER_INVALID_NODES',
      ) as MokelayErrorBody & { debug: MokelayDebugTrace }

      expect(duplicateDefaultBody.debug).toEqual({
        uuid: 'starter',
        nextBlock: {
          uuid: 'switch',
          type: 'controller',
          inputs: {
            value: 'draft',
            dataType: 'string',
          },
          error: {
            code: 'CONTROLLER_INVALID_NODES',
            message: 'Controller switch nodes 配置无效：switch_controller 只能配置一个 DEFAULT node。',
          },
        },
      })
      await expectMokelayError(
        await postJson(server.baseUrl, 'switch_missing_default', {}),
        'CONTROLLER_INVALID_NODES',
      )
    } finally {
      await server.close()
    }
  })

  it('rejects duplicate UUIDs across controller nodes and blocks', async () => {
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'duplicate_controller_uuid',
        method: 'POST',
        blocks: [
          { uuid: 'starter', nextBlock: 'choose' },
          {
            uuid: 'choose',
            functionName: 'if_controller',
            type: 'controller',
            inputs: {
              value: true,
            },
            nodes: [
              {
                uuid: 'duplicate_uuid',
                value: true,
                nextBlock: 'store',
              },
              {
                uuid: 'duplicate_uuid',
                value: false,
                nextBlock: null,
              },
            ],
          },
          {
            uuid: 'store',
            functionName: 'addSession',
            inputs: {
              key: 'result',
              value: true,
            },
            nextBlock: null,
          },
        ],
        response: null,
      }),
    })
    const server = await startServer(handler)

    try {
      await expectMokelayError(
        await postJson(server.baseUrl, 'duplicate_controller_uuid', {}),
        'API_JSON_DUPLICATE_UUID',
      )
    } finally {
      await server.close()
    }
  })

  it('validates starter and nextBlock graph configuration', async () => {
    async function expectRawApiJsonError(apiJsonUuid: string, apiJson: unknown, code: MokelayErrorCode) {
      const handler = createCoreMokelayOrchestrationHandler({
        loadApiJson: async () => apiJson,
      })
      const server = await startServer(handler)

      try {
        await expectMokelayError(
          await postJson(server.baseUrl, apiJsonUuid, {}),
          code,
        )
      } finally {
        await server.close()
      }
    }

    await expectRawApiJsonError('missing_starter', {
      uuid: 'missing_starter',
      method: 'POST',
      blocks: [{
        uuid: 'store',
        functionName: 'addSession',
        inputs: { key: 'value', value: true },
        nextBlock: null,
      }],
      response: null,
    }, 'API_JSON_INVALID_FLOW')

    await expectRawApiJsonError('multiple_starter', {
      uuid: 'multiple_starter',
      method: 'POST',
      blocks: [
        { uuid: 'starter', nextBlock: null },
        { uuid: 'starter', nextBlock: null },
      ],
      response: null,
    }, 'API_JSON_DUPLICATE_UUID')

    await expectRawApiJsonError('missing_next_block', {
      uuid: 'missing_next_block',
      method: 'POST',
      blocks: [
        { uuid: 'starter', nextBlock: 'store' },
        {
          uuid: 'store',
          functionName: 'addSession',
          inputs: { key: 'value', value: true },
        },
      ],
      response: null,
    }, 'API_JSON_INVALID_SCHEMA')

    await expectRawApiJsonError('unknown_next_block', {
      uuid: 'unknown_next_block',
      method: 'POST',
      blocks: [
        { uuid: 'starter', nextBlock: 'missing' },
        {
          uuid: 'store',
          functionName: 'addSession',
          inputs: { key: 'value', value: true },
          nextBlock: null,
        },
      ],
      response: null,
    }, 'API_JSON_INVALID_FLOW')

    await expectRawApiJsonError('node_next_block', {
      uuid: 'node_next_block',
      method: 'POST',
      blocks: [
        { uuid: 'starter', nextBlock: 'true_node' },
        {
          uuid: 'choose',
          functionName: 'if_controller',
          type: 'controller',
          inputs: { value: true },
          nodes: [
            { uuid: 'true_node', value: true, nextBlock: null },
            { uuid: 'false_node', value: false, nextBlock: null },
          ],
        },
      ],
      response: null,
    }, 'API_JSON_INVALID_FLOW')

    await expectRawApiJsonError('starter_next_block', {
      uuid: 'starter_next_block',
      method: 'POST',
      blocks: [
        { uuid: 'starter', nextBlock: 'store' },
        {
          uuid: 'store',
          functionName: 'addSession',
          inputs: { key: 'value', value: true },
          nextBlock: 'starter',
        },
      ],
      response: null,
    }, 'API_JSON_INVALID_FLOW')

    await expectRawApiJsonError('cycle_next_block', {
      uuid: 'cycle_next_block',
      method: 'POST',
      blocks: [
        { uuid: 'starter', nextBlock: 'store' },
        {
          uuid: 'store',
          functionName: 'addSession',
          inputs: { key: 'value', value: true },
          nextBlock: 'store',
        },
      ],
      response: null,
    }, 'API_JSON_INVALID_FLOW')

    const terminalHandler = createCoreMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'terminal_next_block',
        method: 'POST',
        blocks: [
          { uuid: 'starter', nextBlock: null },
        ],
        response: { ok: true },
      }),
    })
    const terminalServer = await startServer(terminalHandler)

    try {
      const response = await postJson(terminalServer.baseUrl, 'terminal_next_block', {})
      const body = await readMokelayData<Record<string, unknown>>(response)

      expect(response.status).toBe(200)
      expect(body).toEqual({ ok: true })
    } finally {
      await terminalServer.close()
    }
  })

  it('returns block debug traces only when __debug=1 is provided', async () => {
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'debug_blocks',
        method: 'POST',
        request: {
          body: [{
            key: 'value',
            processors: ['trim'],
          }],
        },
        blocks: [
          {
            uuid: 'store',
            functionName: 'addSession',
            inputs: {
              key: 'debug-value',
              value: { template: '{{request.body.value}}' },
            },
          },
          {
            uuid: 'read',
            functionName: 'readSession',
            inputs: { key: 'debug-value' },
            outputs: ['value'],
          },
        ],
        response: {
          echoed: { template: "{{blocks['read'].outputs.value}}" },
        },
      }),
    })
    const server = await startServer(handler)

    try {
      const responseWithoutDebug = await postJson(server.baseUrl, 'debug_blocks', {
        value: '  Alice  ',
      })
      const bodyWithoutDebug = await readJson<MokelaySuccessBody<Record<string, unknown>> & { debug?: MokelayDebugTrace }>(responseWithoutDebug)

      expect(responseWithoutDebug.status).toBe(200)
      expect(bodyWithoutDebug).toEqual({
        ok: true,
        data: { echoed: 'Alice' },
      })

      const responseWithDebug = await postJson(server.baseUrl, 'debug_blocks', {
        value: '  Alice  ',
      }, '?__debug=1')
      const bodyWithDebug = await readJson<MokelaySuccessBody<Record<string, unknown>> & { debug: MokelayDebugTrace }>(responseWithDebug)

      expect(responseWithDebug.status).toBe(200)
      expect(bodyWithDebug).toEqual({
        ok: true,
        data: { echoed: 'Alice' },
        debug: {
          uuid: 'starter',
          nextBlock: {
            uuid: 'store',
            type: 'block',
            inputs: {
              key: 'debug-value',
              value: 'Alice',
            },
            outputs: {},
            nextBlock: {
              uuid: 'read',
              type: 'block',
              inputs: {
                key: 'debug-value',
              },
              outputs: {
                value: 'Alice',
              },
              nextBlock: null,
            },
          },
        },
      })
    } finally {
      await server.close()
    }
  })

  it('returns partial block debug traces on block errors', async () => {
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'debug_error',
        method: 'POST',
        request: { body: ['value'] },
        blocks: [
          {
            uuid: 'store',
            functionName: 'addSession',
            inputs: {
              key: 'debug-value',
              value: { template: '{{request.body.value}}' },
            },
          },
          {
            uuid: 'fail',
            functionName: 'addSession',
            inputs: { key: 'missing-value' },
          },
          {
            uuid: 'never',
            functionName: 'readSession',
            inputs: { key: 'debug-value' },
            outputs: ['value'],
          },
        ],
        response: { ok: true },
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await postJson(server.baseUrl, 'debug_error', {
        value: 'kept',
      }, '?__debug=1')
      const body = await readJson<MokelayErrorBody & { debug: MokelayDebugTrace }>(response)

      expect(response.status).toBe(200)
      expect(body.ok).toBe(false)
      expect(body.error).toEqual({
        code: 'BLOCK_SESSION_VALUE_MISSING',
        message: 'value 不能为空。',
      })
      expect(body.debug).toEqual({
        uuid: 'starter',
        nextBlock: {
          uuid: 'store',
          type: 'block',
          inputs: {
            key: 'debug-value',
            value: 'kept',
          },
          outputs: {},
          nextBlock: {
            uuid: 'fail',
            type: 'block',
            inputs: {
              key: 'missing-value',
            },
            outputs: {},
            nextBlock: null,
            error: {
              code: 'BLOCK_SESSION_VALUE_MISSING',
              message: 'value 不能为空。',
            },
          },
        },
      })
      expect(JSON.stringify(body.debug)).not.toContain('never')
    } finally {
      await server.close()
    }
  })

  it('executes the four stored page API JSON definitions', async () => {
    const firstCreate = await createPage(testServer.baseUrl, {
      name: 'First Page',
      blocks: [{ type: 'hero', title: 'Hello' }],
    })
    const secondCreate = await createPage(testServer.baseUrl, {
      name: 'Second Page',
      blocks: [{ type: 'text', value: 'World' }],
    })
    const firstPage = firstCreate.page
    const secondPage = secondCreate.page

    expect(firstPage?.uuid).toMatch(uuidPattern)
    expect(firstPage).toMatchObject({
      name: 'First Page',
      blocks: [{ type: 'hero', title: 'Hello' }],
    })
    expect(secondPage?.uuid).toMatch(uuidPattern)

    const readResponse = await fetch(`${testServer.baseUrl}/api/mokelay/read_page_by_uuid?uuid=${firstPage?.uuid}`)
    const readBody = await readMokelayData<PageResponse>(readResponse)

    expect(readResponse.status).toBe(200)
    expect(readBody.page).toEqual(firstPage)

    const updateResponse = await postJson(
      testServer.baseUrl,
      'update_page_blocks_by_uuid',
      {
        name: 'First Page Updated',
        blocks: [{ type: 'text', value: 'Updated' }],
      },
      `?uuid=${firstPage?.uuid}`,
    )
    const updateBody = await readMokelayData<PageResponse>(updateResponse)

    expect(updateResponse.status).toBe(200)
    expect(updateBody.page).toMatchObject({
      uuid: firstPage?.uuid,
      name: 'First Page Updated',
      blocks: [{ type: 'text', value: 'Updated' }],
      updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/),
    })

    const listResponse = await fetch(`${testServer.baseUrl}/api/mokelay/list_pages?page=1&pageSize=1`)
    const listBody = await readMokelayData<PageListResponse>(listResponse)

    expect(listResponse.status).toBe(200)
    expect(listBody.pages).toHaveLength(1)
    expect(listBody.pages[0]).toEqual(expect.objectContaining({
      created_at: expect.any(String),
      updated_at: expect.any(String),
    }))
    expect(listBody.pagination).toEqual({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
      hasPreviousPage: false,
      hasNextPage: true,
    })

    const secondPageResponse = await fetch(`${testServer.baseUrl}/api/mokelay/list_pages?page=2&pageSize=1`)
    const secondPageBody = await readMokelayData<PageListResponse>(secondPageResponse)

    expect(secondPageResponse.status).toBe(200)
    expect(new Set([
      listBody.pages[0]?.uuid,
      secondPageBody.pages[0]?.uuid,
    ])).toEqual(new Set([firstPage?.uuid, secondPage?.uuid]))
    expect(secondPageBody.pagination).toMatchObject({
      page: 2,
      pageSize: 1,
      hasPreviousPage: true,
      hasNextPage: false,
    })

    const firstPageRow = fakeSqlExecutor.pages.find((page) => page.uuid === firstPage?.uuid)
    const secondPageRow = fakeSqlExecutor.pages.find((page) => page.uuid === secondPage?.uuid)

    expect(firstPageRow).toBeDefined()
    expect(secondPageRow).toBeDefined()

    if (firstPageRow) {
      firstPageRow.created_at = '2026-05-01T00:00:00.000Z'
    }

    if (secondPageRow) {
      secondPageRow.created_at = '2026-05-10T00:00:00.000Z'
    }

    const emptySearchResponse = await fetch(
      `${testServer.baseUrl}/api/mokelay/list_pages?page=1&pageSize=10&uuid=&name=&created_at_begin=&created_at_end=`,
    )
    const emptySearchBody = await readMokelayData<PageListResponse>(emptySearchResponse)

    expect(emptySearchResponse.status).toBe(200)
    expect(emptySearchBody.pagination.total).toBe(2)

    const uuidSearchResponse = await fetch(
      `${testServer.baseUrl}/api/mokelay/list_pages?page=1&pageSize=10&uuid=${secondPage?.uuid}`,
    )
    const uuidSearchBody = await readMokelayData<PageListResponse>(uuidSearchResponse)

    expect(uuidSearchBody.pagination.total).toBe(1)
    expect(uuidSearchBody.pages[0]?.uuid).toBe(secondPage?.uuid)

    const nameSearchResponse = await fetch(
      `${testServer.baseUrl}/api/mokelay/list_pages?page=1&pageSize=10&name=${encodeURIComponent('First Page Updated')}`,
    )
    const nameSearchBody = await readMokelayData<PageListResponse>(nameSearchResponse)

    expect(nameSearchBody.pagination.total).toBe(1)
    expect(nameSearchBody.pages[0]?.uuid).toBe(firstPage?.uuid)

    const rangeSearchResponse = await fetch(
      `${testServer.baseUrl}/api/mokelay/list_pages?page=1&pageSize=10`
        + '&created_at_begin=2026-05-05T00%3A00%3A00.000Z'
        + '&created_at_end=2026-05-31T23%3A59%3A59.999Z',
    )
    const rangeSearchBody = await readMokelayData<PageListResponse>(rangeSearchResponse)

    expect(rangeSearchBody.pagination.total).toBe(1)
    expect(rangeSearchBody.pages[0]?.uuid).toBe(secondPage?.uuid)

    const combinedSearchResponse = await fetch(
      `${testServer.baseUrl}/api/mokelay/list_pages?page=1&pageSize=10`
        + `&name=${encodeURIComponent('Second Page')}`
        + '&created_at_begin=2026-05-05T00%3A00%3A00.000Z',
    )
    const combinedSearchBody = await readMokelayData<PageListResponse>(combinedSearchResponse)

    expect(combinedSearchBody.pagination.total).toBe(1)
    expect(combinedSearchBody.pages[0]?.uuid).toBe(secondPage?.uuid)
    expect(new Set(fakeSqlExecutor.datasources)).toEqual(new Set(['Mokelay']))
  })

  it('creates a page with a caller-provided UUID when create_page receives uuid', async () => {
    const pageUuid = '550e8400-e29b-41d4-a716-446655440000'
    const created = await createPage(testServer.baseUrl, {
      uuid: pageUuid,
      name: 'AI Generated Page',
      blocks: [{ type: 'MHeading', data: { text: 'AI Generated Page' } }],
    })

    expect(created.page).toMatchObject({
      uuid: pageUuid,
      name: 'AI Generated Page',
      blocks: [{ type: 'MHeading', data: { text: 'AI Generated Page' } }],
    })

    const readResponse = await fetch(`${testServer.baseUrl}/api/mokelay/read_page_by_uuid?uuid=${pageUuid}`)
    const readBody = await readMokelayData<PageResponse>(readResponse)

    expect(readResponse.status).toBe(200)
    expect(readBody.page).toEqual(created.page)
  })

  it('executes the stored app create and list API JSON definitions', async () => {
    const firstCreate = await createMokelayApp(testServer.baseUrl, {
      uuid: 'launch',
      alias: '  Launch Pad  ',
      description: '  First app  ',
    })
    const secondCreate = await createMokelayApp(testServer.baseUrl, {
      uuid: 'console',
      alias: 'Console',
      description: '',
    })
    const firstApp = firstCreate.app
    const secondApp = secondCreate.app

    expect(firstApp).toMatchObject({
      id: 1,
      uuid: 'launch',
      alias: 'Launch Pad',
      description: 'First app',
    })
    expect(secondApp).toMatchObject({
      id: 2,
      uuid: 'console',
      alias: 'Console',
      description: '',
    })

    const listResponse = await fetch(`${testServer.baseUrl}/api/mokelay/list_apps?page=1&pageSize=1`)
    const listBody = await readMokelayData<AppListResponse>(listResponse)

    expect(listResponse.status).toBe(200)
    expect(listBody.apps).toEqual([secondApp])
    expect(listBody.pagination).toEqual({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
      hasPreviousPage: false,
      hasNextPage: true,
    })

    const secondPageResponse = await fetch(`${testServer.baseUrl}/api/mokelay/list_apps?page=2&pageSize=1`)
    const secondPageBody = await readMokelayData<AppListResponse>(secondPageResponse)

    expect(secondPageResponse.status).toBe(200)
    expect(secondPageBody.apps).toEqual([firstApp])
    expect(secondPageBody.pagination).toMatchObject({
      page: 2,
      pageSize: 1,
      hasPreviousPage: true,
      hasNextPage: false,
    })

    const updateResponse = await postJson(testServer.baseUrl, 'update_app_by_uuid', {
      alias: '  Launch Pad Updated  ',
      description: '  Updated app  ',
    }, '?uuid=launch')
    const updateBody = await readMokelayData<AppResponse & { affected: number }>(updateResponse)

    expect(updateBody).toMatchObject({
      affected: 1,
      app: {
        id: 1,
        uuid: 'launch',
        alias: 'Launch Pad Updated',
        description: 'Updated app',
      },
    })
    expect(new Set(fakeSqlExecutor.datasources)).toEqual(new Set(['Mokelay']))
  })

  it('requires an app UUID no longer than eight characters', async () => {
    const missingUuidResponse = await postJson(testServer.baseUrl, 'create_app', {
      alias: 'Missing UUID',
    })
    await expectMokelayError(missingUuidResponse, 'PROCESSOR_VALIDATION_FAILED')

    const longUuidResponse = await postJson(testServer.baseUrl, 'create_app', {
      uuid: 'more-than-eight',
      alias: 'Long UUID',
    })
    await expectMokelayError(longUuidResponse, 'PROCESSOR_VALIDATION_FAILED')
  })

  it('executes datasource CRUD and schema sync API JSON definitions', async () => {
    const firstCreate = await createMokelayDatasource(testServer.baseUrl, {
      uuid: 'analytic',
      alias: '  Analytics  ',
      description: '  Reporting database  ',
    })
    const secondCreate = await createMokelayDatasource(testServer.baseUrl, {
      uuid: 'ops_db',
      alias: 'Operations',
    })
    const firstDatasource = firstCreate.datasource
    const secondDatasource = secondCreate.datasource

    expect(firstDatasource).toMatchObject({
      id: 1,
      uuid: 'analytic',
      alias: 'Analytics',
      description: 'Reporting database',
      schema_data: [],
    })
    expect(secondDatasource).toMatchObject({
      id: 2,
      uuid: 'ops_db',
      alias: 'Operations',
      description: '',
      schema_data: [],
    })

    const listResponse = await fetch(`${testServer.baseUrl}/api/mokelay/list_datasources?page=1&pageSize=1`)
    const listBody = await readMokelayData<DatasourceListResponse>(listResponse)

    expect(listBody.datasources).toEqual([secondDatasource])
    expect(listBody.pagination).toEqual({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
      hasPreviousPage: false,
      hasNextPage: true,
    })

    const updateResponse = await postJson(testServer.baseUrl, 'update_datasource_by_uuid', {
      alias: '  Analytics Primary  ',
      description: '  Updated description  ',
    }, `?uuid=${firstDatasource?.uuid}`)
    const updateBody = await readMokelayData<DatasourceResponse>(updateResponse)

    expect(updateBody).toMatchObject({
      affected: 1,
      datasource: {
        uuid: firstDatasource?.uuid,
        alias: 'Analytics Primary',
        description: 'Updated description',
        schema_data: [],
      },
    })

    process.env[`${firstDatasource?.uuid}_DATABASE_URL`] = 'postgres://schema-unit-test'
    const syncResponse = await postJson(
      testServer.baseUrl,
      'sync_datasource_schema',
      {},
      `?uuid=${firstDatasource?.uuid}`,
    )
    const syncBody = await readMokelayData<DatasourceResponse>(syncResponse)

    expect(syncResponse.status).toBe(200)
    expect(syncBody.datasource?.schema_data).toEqual([
      {
        name: 'orders',
        columns: [
          { name: 'id', type: 'integer', dataType: 'integer' },
          { name: 'total', type: 'numeric(12,2)', dataType: 'numeric(12,2)' },
        ],
      },
      {
        name: 'enterprise',
        columns: [
          { name: 'uuid', type: 'uuid', dataType: 'uuid' },
        ],
      },
      {
        name: 'employees',
        columns: [
          { name: 'enterprise_uuid', type: 'uuid', dataType: 'uuid' },
        ],
      },
    ])
    expect(fakeSqlExecutor.datasourceRows[0]?.schema_data).toEqual(syncBody.datasource?.schema_data)

    process.env[`${firstDatasource?.uuid}_DATABASE_URL`] = ''
    const failedSyncResponse = await postJson(
      testServer.baseUrl,
      'sync_datasource_schema',
      {},
      `?uuid=${firstDatasource?.uuid}`,
    )
    await expectMokelayError(
      failedSyncResponse,
      'BLOCK_DATASOURCE_URL_MISSING',
      `${firstDatasource?.uuid}_DATABASE_URL is not configured.`,
    )
    expect(fakeSqlExecutor.datasourceRows[0]?.schema_data).toEqual(syncBody.datasource?.schema_data)
    expect(new Set(fakeSqlExecutor.datasources)).toEqual(new Set(['Mokelay', firstDatasource?.uuid]))
  })

  it('requires a valid datasource UUID no longer than eight characters', async () => {
    const missingUuidResponse = await postJson(testServer.baseUrl, 'create_datasource', {
      alias: 'Missing UUID',
    })
    await expectMokelayError(missingUuidResponse, 'PROCESSOR_VALIDATION_FAILED')

    const longUuidResponse = await postJson(testServer.baseUrl, 'create_datasource', {
      uuid: 'more_than_8',
      alias: 'Long UUID',
    })
    await expectMokelayError(longUuidResponse, 'PROCESSOR_VALIDATION_FAILED')

    const invalidUuidResponse = await postJson(testServer.baseUrl, 'create_datasource', {
      uuid: '1invalid',
      alias: 'Invalid UUID',
    })
    await expectMokelayError(invalidUuidResponse, 'PROCESSOR_VALIDATION_FAILED')
  })

  it('executes the stored API builder CRUD JSON definitions', async () => {
    configureApiR2Env()

    const registerApiJson = {
      uuid: 'register_users',
      alias: 'users 注册接口',
      method: 'POST',
      blocks: emptyApiJsonBlocks(),
      response: null,
    }
    const loginApiJson = {
      uuid: 'login_users',
      alias: 'users 登录接口',
      method: 'POST',
      blocks: emptyApiJsonBlocks(),
      response: null,
    }
    const loginLayout = {
      version: 1,
      nodes: {
        read_user: { x: 220, y: 80 },
        login_controller: { x: 460, y: 80 },
      },
    }
    const firstSaveResponse = await postJson(testServer.baseUrl, 'save_api', {
      uuid: registerApiJson.uuid,
      name: 'users 注册接口',
      method: 'POST',
      status: 'draft',
      apiJson: registerApiJson,
    })
    const firstSaveBody = await readMokelayData<ApiResponse>(firstSaveResponse)

    expect(firstSaveResponse.status).toBe(200)
    expect(firstSaveBody.api).toMatchObject({
      uuid: 'register_users',
      name: 'users 注册接口',
      method: 'POST',
      status: 'draft',
      apiJson: registerApiJson,
      layout: {},
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    expect(firstSaveBody.api?.layout).toEqual({})
    expect(fakeSqlExecutor.apiSnapshots).toHaveLength(1)
    expect(fakeSqlExecutor.apiSnapshots[0]).toMatchObject({
      api_uuid: 'register_users',
      name: 'users 注册接口',
      method: 'POST',
      status: 'draft',
      api_json: registerApiJson,
      created_at: expect.any(String),
    })
    expect(apiR2MockState.sentInputs).toHaveLength(0)

    const secondSaveResponse = await postJson(testServer.baseUrl, 'save_api', {
      uuid: loginApiJson.uuid,
      name: 'users 登录接口',
      method: 'POST',
      status: 'published',
      apiJson: loginApiJson,
      layout: loginLayout,
    })
    const secondSaveBody = await readMokelayData<ApiResponse>(secondSaveResponse)

    expect(secondSaveResponse.status).toBe(200)
    expect(secondSaveBody.api?.layout).toEqual(loginLayout)
    expect(fakeSqlExecutor.apis.find((api) => api.uuid === 'login_users')?.layout).toEqual(loginLayout)
    expect(fakeSqlExecutor.apiSnapshots).toHaveLength(2)
    expect(fakeSqlExecutor.apiSnapshots[1]).toMatchObject({
      api_uuid: 'login_users',
      name: 'users 登录接口',
      status: 'published',
      api_json: loginApiJson,
    })
    expect(apiR2MockState.sentInputs).toHaveLength(1)
    expect(apiR2MockState.sentInputs[0]).toMatchObject({
      Bucket: 'mokelay-api-json',
      Key: 'mokelay-apis/login_users.json',
      ContentType: 'application/json; charset=utf-8',
    })
    expect(JSON.parse(String(apiR2MockState.sentInputs[0]?.Body))).toMatchObject(loginApiJson)

    const overwriteResponse = await postJson(testServer.baseUrl, 'save_api', {
      uuid: registerApiJson.uuid,
      originalUuid: registerApiJson.uuid,
      name: 'users 注册接口 v2',
      method: 'POST',
      status: 'published',
      apiJson: {
        ...registerApiJson,
        alias: 'users 注册接口 v2',
      },
    })
    const overwriteBody = await readMokelayData<ApiResponse>(overwriteResponse)

    expect(overwriteResponse.status).toBe(200)
    expect(overwriteBody.api).toMatchObject({
      uuid: 'register_users',
      name: 'users 注册接口 v2',
      status: 'published',
      apiJson: {
        uuid: 'register_users',
        alias: 'users 注册接口 v2',
      },
    })
    expect(overwriteBody.api?.createdAt).toBe(firstSaveBody.api?.createdAt)
    expect(fakeSqlExecutor.apiSnapshots).toHaveLength(3)
    expect(fakeSqlExecutor.apiSnapshots[2]).toMatchObject({
      api_uuid: 'register_users',
      name: 'users 注册接口 v2',
      status: 'published',
      api_json: {
        uuid: 'register_users',
        alias: 'users 注册接口 v2',
      },
    })
    expect(apiR2MockState.sentInputs).toHaveLength(2)
    expect(apiR2MockState.sentInputs[1]).toMatchObject({
      Bucket: 'mokelay-api-json',
      Key: 'mokelay-apis/register_users.json',
      ContentType: 'application/json; charset=utf-8',
    })
    expect(JSON.parse(String(apiR2MockState.sentInputs[1]?.Body))).toMatchObject({
      uuid: 'register_users',
      alias: 'users 注册接口 v2',
    })

    const readResponse = await fetch(`${testServer.baseUrl}/api/mokelay/read_api_by_uuid?uuid=register_users`)
    const readBody = await readMokelayData<ApiResponse>(readResponse)

    expect(readResponse.status).toBe(200)
    expect(readBody.api).toEqual(overwriteBody.api)

    const listResponse = await fetch(`${testServer.baseUrl}/api/mokelay/list_apis?page=1&pageSize=1`)
    const listBody = await readMokelayData<ApiListResponse>(listResponse)

    expect(listResponse.status).toBe(200)
    expect(listBody.apis).toHaveLength(1)
    expect(listBody.apis[0]).toEqual(expect.objectContaining({
      uuid: 'register_users',
      name: 'users 注册接口 v2',
      method: 'POST',
      status: 'published',
      created_at: expect.any(String),
      updated_at: expect.any(String),
    }))
    expect(listBody.apis[0]).not.toHaveProperty('api_json')
    expect(listBody.apis[0]).not.toHaveProperty('layout')
    expect(listBody.pagination).toEqual({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
      hasPreviousPage: false,
      hasNextPage: true,
    })

    const duplicateUuidResponse = await postJson(testServer.baseUrl, 'save_api', {
      uuid: loginApiJson.uuid,
      name: '重复登录接口',
      method: 'POST',
      status: 'draft',
      apiJson: {
        ...loginApiJson,
        alias: '重复登录接口',
      },
    })

    await expectMokelayError(duplicateUuidResponse, 'BLOCK_UNIQUE_CONFLICT', 'API 标识已存在。')
    expect(fakeSqlExecutor.apiSnapshots).toHaveLength(3)

    const saveSelfResponse = await postJson(testServer.baseUrl, 'save_api', {
      uuid: loginApiJson.uuid,
      originalUuid: loginApiJson.uuid,
      name: 'users 登录接口 v2',
      method: 'POST',
      status: 'draft',
      apiJson: {
        ...loginApiJson,
        alias: 'users 登录接口 v2',
      },
    })
    const saveSelfBody = await readMokelayData<ApiResponse>(saveSelfResponse)

    expect(saveSelfResponse.status).toBe(200)
    expect(saveSelfBody.api).toMatchObject({
      uuid: 'login_users',
      name: 'users 登录接口 v2',
      status: 'draft',
    })
    expect(fakeSqlExecutor.apiSnapshots).toHaveLength(4)
    expect(fakeSqlExecutor.apiSnapshots[3]).toMatchObject({
      api_uuid: 'login_users',
      name: 'users 登录接口 v2',
      status: 'draft',
    })
    expect(apiR2MockState.sentInputs).toHaveLength(2)

    const renameToExistingUuidResponse = await postJson(testServer.baseUrl, 'save_api', {
      uuid: loginApiJson.uuid,
      originalUuid: registerApiJson.uuid,
      name: '冲突注册接口',
      method: 'POST',
      status: 'draft',
      apiJson: {
        ...registerApiJson,
        uuid: loginApiJson.uuid,
        alias: '冲突注册接口',
      },
    })

    await expectMokelayError(renameToExistingUuidResponse, 'BLOCK_UNIQUE_CONFLICT', 'API 标识已存在。')
    expect(fakeSqlExecutor.apiSnapshots).toHaveLength(4)

    const deleteResponse = await postJson(testServer.baseUrl, 'delete_api_by_uuid', {
      uuid: 'register_users',
    })
    const deleteBody = await readMokelayData<Record<string, unknown>>(deleteResponse)

    expect(deleteResponse.status).toBe(200)
    expect(deleteBody).toEqual({
      affected: 1,
      message: '删除成功',
    })

    const deleteMissingResponse = await postJson(testServer.baseUrl, 'delete_api_by_uuid', {
      uuid: 'missing_api',
    })
    const deleteMissingBody = await readMokelayData<Record<string, unknown>>(deleteMissingResponse)

    expect(deleteMissingResponse.status).toBe(200)
    expect(deleteMissingBody).toEqual({
      affected: 0,
      message: '删除成功',
    })
  })

  it('lists active API builder samples with pagination and full API JSON', async () => {
    fakeSqlExecutor.apiBuilderSamples.push(
      {
        uuid: 'inactive_sample',
        title: '隐藏样例',
        description: '不返回 inactive 样例。',
        method: 'GET',
        api_json: { uuid: 'hidden_api', blocks: [] },
        status: 'inactive',
        sort_order: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        uuid: 'active_second',
        title: '第二个样例',
        description: '排序第二。',
        method: 'POST',
        api_json: { uuid: 'second_api', method: 'POST', blocks: [{ uuid: 'starter', nextBlock: null }] },
        status: 'active',
        sort_order: 2,
        created_at: '2026-01-02T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
      {
        uuid: 'active_first',
        title: '第一个样例',
        description: '排序第一。',
        method: 'GET',
        api_json: { uuid: 'first_api', method: 'GET', blocks: [{ uuid: 'starter', nextBlock: null }] },
        status: 'active',
        sort_order: 1,
        created_at: '2026-01-03T00:00:00.000Z',
        updated_at: '2026-01-03T00:00:00.000Z',
      },
      {
        uuid: 'active_third',
        title: '第三个样例',
        description: '第二页。',
        method: 'GET',
        api_json: { uuid: 'third_api', method: 'GET', blocks: [{ uuid: 'starter', nextBlock: null }] },
        status: 'active',
        sort_order: 3,
        created_at: '2026-01-04T00:00:00.000Z',
        updated_at: '2026-01-04T00:00:00.000Z',
      },
    )

    const response = await fetch(`${testServer.baseUrl}/api/mokelay/list_api_builder_samples?page=1&pageSize=2`)
    const body = await readMokelayData<ApiBuilderSampleListResponse>(response)

    expect(response.status).toBe(200)
    expect(body.samples.map((sample) => sample.uuid)).toEqual(['active_first', 'active_second'])
    expect(body.samples[0]).toEqual(expect.objectContaining({
      title: '第一个样例',
      method: 'GET',
      status: 'active',
      sort_order: 1,
      api_json: {
        uuid: 'first_api',
        method: 'GET',
        blocks: [{ uuid: 'starter', nextBlock: null }],
      },
    }))
    expect(body.samples.some((sample) => sample.uuid === 'inactive_sample')).toBe(false)
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasPreviousPage: false,
      hasNextPage: true,
    })
  })

  it('does not execute API builder drafts from the database fallback', async () => {
    const draftApiJson = {
      uuid: 'draft_builder_api',
      alias: '草稿 API',
      method: 'POST',
      blocks: emptyApiJsonBlocks(),
      response: null,
    }
    const saveResponse = await postJson(testServer.baseUrl, 'save_api', {
      uuid: draftApiJson.uuid,
      name: '草稿 API',
      method: 'POST',
      status: 'draft',
      apiJson: draftApiJson,
    })

    expect(saveResponse.status).toBe(200)
    expect(fakeSqlExecutor.apis).toHaveLength(1)
    expect(fakeSqlExecutor.apis[0]).toMatchObject({
      uuid: 'draft_builder_api',
      status: 'draft',
    })

    const executeResponse = await postJson(testServer.baseUrl, 'draft_builder_api', {})

    await expectMokelayError(executeResponse, 'API_JSON_NOT_FOUND', 'API JSON 不存在。')
  })

  it('fails API publishing before database writes when R2 upload fails', async () => {
    configureApiR2Env()
    apiR2MockState.failPut = true

    const apiJson = {
      uuid: 'failed_publish_api',
      alias: '失败发布 API',
      method: 'POST',
      blocks: emptyApiJsonBlocks(),
      response: null,
    }
    const response = await postJson(testServer.baseUrl, 'save_api', {
      uuid: apiJson.uuid,
      name: '失败发布 API',
      method: 'POST',
      status: 'published',
      apiJson,
    })

    await expectMokelayError(response, 'BLOCK_R2_SAVE_FAILED', '保存 JSON 到 Cloudflare R2 失败。')
    expect(apiR2MockState.sentInputs).toHaveLength(1)
    expect(apiR2MockState.sentInputs[0]).toMatchObject({
      Bucket: 'mokelay-api-json',
      Key: 'mokelay-apis/failed_publish_api.json',
    })
    expect(fakeSqlExecutor.apis).toHaveLength(0)
    expect(fakeSqlExecutor.apiSnapshots).toHaveLength(0)
  })

  it('returns an error body when API_JSON_UUID is missing', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/mokelay`)

    await expectMokelayError(response, 'API_JSON_UUID_INVALID', 'API_JSON_UUID 无效或不能为空。')
  })

  it('returns an error body for unknown API JSON definitions', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/mokelay/not_found`)

    await expectMokelayError(response, 'API_JSON_NOT_FOUND', 'API JSON 不存在。')
  })

  it('stops orchestration when datasource database URL is missing', async () => {
    process.env.Missing_DATABASE_URL = ''
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'missing_datasource_url',
        method: 'POST',
        blocks: [{
          uuid: 'list',
          functionName: 'list',
          inputs: {
            datasource: 'Missing',
            table: 'users',
            fields: ['id'],
          },
        }],
        response: { ok: true },
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/missing_datasource_url`, { method: 'POST' })

      await expectMokelayError(response, 'BLOCK_DATASOURCE_URL_MISSING', 'Missing_DATABASE_URL is not configured.')
    } finally {
      await server.close()
    }
  })

  it('hides unknown orchestration errors behind a generic error body', async () => {
    const handler = createMokelayOrchestrationHandler({
      executeSql: async () => {
        throw new Error('raw database failure')
      },
      loadApiJson: async () => ({
        uuid: 'unknown_sql_error',
        method: 'POST',
        blocks: [{
          uuid: 'list',
          functionName: 'list',
          inputs: {
            datasource: 'Mokelay',
            table: 'users',
            fields: ['id'],
          },
        }],
        response: { ok: true },
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/unknown_sql_error`, { method: 'POST' })

      await expectMokelayError(response, 'INTERNAL_ERROR', '服务器内部错误。')
    } finally {
      await server.close()
    }
  })

  it('rejects method mismatches and missing declared parameters', async () => {
    const methodMismatchResponse = await fetch(`${testServer.baseUrl}/api/mokelay/create_user_info`)

    await expectMokelayError(methodMismatchResponse, 'REQUEST_METHOD_MISMATCH', '请求方法不匹配，应使用 POST。')

    const missingBodyFieldResponse = await postJson(testServer.baseUrl, 'create_user_info', {
      name: 'Missing Password',
      email: 'missing-password@mokelay.test',
    })

    await expectMokelayError(missingBodyFieldResponse, 'REQUEST_PARAMETER_MISSING', '缺少 body 参数：password_hash')
  })

  it('does not require tables or fields to be predeclared in server code', async () => {
    let receivedDatasource = ''
    process.env.Custom_DATABASE_URL = 'postgres://custom-unit-test'
    const handler = createMokelayOrchestrationHandler({
      executeSql: async <T extends Record<string, unknown> = Record<string, unknown>>(
        _query: SQL,
        datasource: string,
        databaseType: DatabaseType,
      ) => {
        receivedDatasource = datasource
        return {
          databaseType,
          rows: [{ arbitrary_field: 'from-json-config' }] as unknown as T[],
        }
      },
      loadApiJson: async () => ({
        uuid: 'custom_table_list',
        method: 'POST',
        blocks: [{
          uuid: 'list',
          functionName: 'list',
          inputs: {
            datasource: 'Custom',
            table: 'custom_table',
            fields: ['arbitrary_field'],
          },
          outputs: ['datas'],
        }],
        response: {
          datas: { template: "{{blocks['list'].outputs.datas}}" },
        },
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/custom_table_list`, { method: 'POST' })
      const body = await readMokelayData<Record<string, unknown>>(response)

      expect(response.status).toBe(200)
      expect(body).toEqual({
        datas: [{ arbitrary_field: 'from-json-config' }],
      })
      expect(receivedDatasource).toBe('Custom')
    } finally {
      await server.close()
    }
  })

  it('generates MySQL-compatible SQL for all database blocks', async () => {
    process.env.BingX_DATABASE_URL = 'mysql://unit-test'
    const mysqlExecutor = new MysqlRecordingExecutor()
    const handler = createMokelayOrchestrationHandler({
      executeSql: mysqlExecutor.execute,
      loadApiJson: async () => ({
        uuid: 'mysql_blocks',
        method: 'POST',
        blocks: [
          {
            uuid: 'create_contract',
            functionName: 'create',
            inputs: {
              datasource: 'BingX',
              table: 'smart_contracts',
              idField: 'id',
              fields: {
                chain_id: 1,
                address: '0xabc',
                contract_standard: 'other',
                abi_json: { ok: true },
              },
            },
            outputs: ['uuid'],
          },
          {
            uuid: 'read_contract',
            functionName: 'read',
            inputs: {
              datasource: 'BingX',
              table: 'smart_contracts',
              fields: ['id', 'address', 'abi_json'],
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'id',
                fieldValue: { template: "{{blocks['create_contract'].outputs.uuid}}" },
              }],
            },
            outputs: ['data'],
          },
          {
            uuid: 'list_contracts',
            functionName: 'list',
            inputs: {
              datasource: 'BingX',
              table: 'smart_contracts',
              fields: ['id', 'address'],
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'id',
                fieldValue: { template: "{{blocks['create_contract'].outputs.uuid}}" },
              }],
            },
            outputs: ['datas'],
          },
          {
            uuid: 'count_contracts',
            functionName: 'count',
            inputs: {
              datasource: 'BingX',
              table: 'smart_contracts',
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'id',
                fieldValue: { template: "{{blocks['create_contract'].outputs.uuid}}" },
              }],
            },
            outputs: ['total'],
          },
          {
            uuid: 'page_contracts',
            functionName: 'page',
            inputs: {
              datasource: 'BingX',
              table: 'smart_contracts',
              fields: ['id', 'address'],
              page: 1,
              pageSize: 1,
              orderBy: [{ fieldName: 'id', direction: 'DESC' }],
            },
            outputs: ['datas', 'total', 'page', 'pageSize', 'hasNextPage'],
          },
          {
            uuid: 'update_contract',
            functionName: 'update',
            inputs: {
              datasource: 'BingX',
              table: 'smart_contracts',
              fields: {
                contract_name: 'Updated Contract',
                abi_json: { updated: true },
              },
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'id',
                fieldValue: { template: "{{blocks['create_contract'].outputs.uuid}}" },
              }],
            },
            outputs: ['affected'],
          },
          {
            uuid: 'upsert_contract',
            functionName: 'upsert',
            inputs: {
              datasource: 'BingX',
              table: 'smart_contracts',
              idField: 'id',
              fields: {
                id: { template: "{{blocks['create_contract'].outputs.uuid}}" },
                chain_id: 1,
                address: '0xabc',
                contract_name: 'Upserted Contract',
                abi_json: { upserted: true },
              },
            },
            outputs: ['uuid'],
          },
          {
            uuid: 'delete_contract',
            functionName: 'delete',
            inputs: {
              datasource: 'BingX',
              table: 'smart_contracts',
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'id',
                fieldValue: { template: "{{blocks['create_contract'].outputs.uuid}}" },
              }],
            },
            outputs: ['affected'],
          },
        ],
        response: {
          uuid: { template: "{{blocks['create_contract'].outputs.uuid}}" },
          read: { template: "{{blocks['read_contract'].outputs.data}}" },
          listed: { template: "{{blocks['list_contracts'].outputs.datas}}" },
          total: { template: "{{blocks['count_contracts'].outputs.total}}" },
          pageTotal: { template: "{{blocks['page_contracts'].outputs.total}}" },
          updateAffected: { template: "{{blocks['update_contract'].outputs.affected}}" },
          upsertUuid: { template: "{{blocks['upsert_contract'].outputs.uuid}}" },
          deleteAffected: { template: "{{blocks['delete_contract'].outputs.affected}}" },
        },
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/mysql_blocks`, { method: 'POST' })
      const body = await readMokelayData<Record<string, unknown>>(response)
      const sqlTexts = mysqlExecutor.queries.map((query) => query.sql)
      const insertQuery = mysqlExecutor.queries.find((query) => query.sql.startsWith('INSERT INTO `smart_contracts`'))
      const updateQuery = mysqlExecutor.queries.find((query) => query.sql.startsWith('UPDATE `smart_contracts`'))

      expect(response.status).toBe(200)
      expect(body).toMatchObject({
        uuid: 42,
        total: 1,
        pageTotal: 1,
        updateAffected: 1,
        upsertUuid: 42,
        deleteAffected: 1,
      })
      expect(mysqlExecutor.queries.every((query) => query.datasource === 'BingX')).toBe(true)
      expect(mysqlExecutor.queries.every((query) => query.databaseType === 'mysql')).toBe(true)
      expect(sqlTexts.every((queryText) => !queryText.includes('RETURNING'))).toBe(true)
      expect(sqlTexts.every((queryText) => !queryText.includes('::jsonb'))).toBe(true)
      expect(sqlTexts.some((queryText) => queryText.startsWith('SELECT count(*) AS total FROM `smart_contracts`'))).toBe(true)
      expect(insertQuery?.params).toContain(JSON.stringify({ ok: true }))
      expect(updateQuery?.params).toContain(JSON.stringify({ updated: true }))
      expect(sqlTexts.some((queryText) => queryText.includes('ON DUPLICATE KEY UPDATE'))).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('returns generated MySQL UUID defaults from create blocks', async () => {
    process.env.Mokelay_DATABASE_URL = 'mysql://unit-test'
    const queries: RecordedQuery[] = []
    let insertedPage: PageRow | undefined
    const handler = createMokelayOrchestrationHandler({
      executeSql: async <T extends Record<string, unknown> = Record<string, unknown>>(
        query: SQL,
        datasource: string,
        databaseType: DatabaseType,
      ): Promise<SqlExecutionResult<T>> => {
        const builtQuery = mysqlDialect.sqlToQuery(query)
        const queryText = builtQuery.sql.replace(/\s+/g, ' ').trim()
        const params = builtQuery.params

        queries.push({
          datasource,
          databaseType,
          sql: queryText,
          params,
        })

        if (queryText.startsWith('SELECT DATA_TYPE AS data_type')) {
          return {
            databaseType,
            rows: [{
              data_type: 'char',
              column_default: 'uuid()',
              extra: 'DEFAULT_GENERATED',
            }] as unknown as T[],
          }
        }

        if (queryText.startsWith('INSERT INTO `pages`')) {
          const uuid = params.at(-1)

          expect(uuid).toEqual(expect.stringMatching(uuidPattern))
          insertedPage = {
            uuid: uuid as string,
            name: params[0] as string,
            blocks: JSON.parse(params[1] as string) as unknown[],
            created_at: '2026-05-27T00:00:00.000Z',
            updated_at: '2026-05-27T00:00:00.000Z',
          }

          return {
            databaseType,
            rows: [] as T[],
            affectedRows: 1,
            insertId: 29,
          }
        }

        if (queryText.startsWith('SELECT')) {
          expect(params).toContain(insertedPage?.uuid)
          expect(params).not.toContain(29)

          return {
            databaseType,
            rows: [insertedPage] as unknown as T[],
          }
        }

        throw new Error(`Unsupported MySQL SQL in UUID default test fake: ${queryText}`)
      },
      loadApiJson: async () => ({
        uuid: 'mysql_create_page',
        method: 'POST',
        request: { body: ['name', 'blocks'], query: [], header: [] },
        blocks: [
          {
            uuid: 'create_page_block',
            functionName: 'create',
            inputs: {
              datasource: 'Mokelay',
              table: 'pages',
              idField: 'uuid',
              fields: {
                name: { template: '{{request.body.name}}' },
                blocks: { template: '{{request.body.blocks}}' },
              },
            },
            outputs: ['uuid'],
          },
          {
            uuid: 'read_page_block',
            functionName: 'read',
            inputs: {
              datasource: 'Mokelay',
              table: 'pages',
              fields: ['uuid', 'name', 'blocks', 'created_at', 'updated_at'],
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'uuid',
                fieldValue: { template: "{{blocks['create_page_block'].outputs.uuid}}" },
              }],
            },
            outputs: ['data'],
          },
        ],
        response: {
          page: { template: "{{blocks['read_page_block'].outputs.data}}" },
        },
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await postJson(server.baseUrl, 'mysql_create_page', {
        name: 'MySQL Page',
        blocks: [],
      })
      const body = await readMokelayData<{ page: PageRow }>(response)
      const insertQuery = queries.find((query) => query.sql.startsWith('INSERT INTO `pages`'))

      expect(response.status).toBe(200)
      expect(body.page).toMatchObject({
        uuid: expect.stringMatching(uuidPattern),
        name: 'MySQL Page',
        blocks: [],
      })
      expect(insertQuery?.sql).toContain('`uuid`')
      expect(insertQuery?.params.at(-1)).toBe(body.page.uuid)
      expect(queries.every((query) => query.datasource === 'Mokelay')).toBe(true)
      expect(queries.every((query) => query.databaseType === 'mysql')).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('maps MySQL duplicate key errors to the duplicate record block error', async () => {
    process.env.BingX_DATABASE_URL = 'mysql://unit-test'
    const duplicateError = Object.assign(new Error('Duplicate entry'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    })
    const handler = createMokelayOrchestrationHandler({
      executeSql: async <T extends Record<string, unknown> = Record<string, unknown>>(
        query: SQL,
        _datasource: string,
        databaseType: DatabaseType,
      ) => {
        const builtQuery = mysqlDialect.sqlToQuery(query)
        const queryText = builtQuery.sql.replace(/\s+/g, ' ').trim()

        if (queryText.startsWith('SELECT DATA_TYPE AS data_type')) {
          return {
            databaseType,
            rows: [{
              data_type: 'int',
              column_default: null,
              extra: 'auto_increment',
            }] as unknown as T[],
          }
        }

        throw duplicateError
      },
      loadApiJson: async () => ({
        uuid: 'mysql_duplicate',
        method: 'POST',
        blocks: [{
          uuid: 'create',
          functionName: 'create',
          inputs: {
            datasource: 'BingX',
            table: 'chains',
            idField: 'id',
            fields: {
              chain_id: 1,
              name: 'Duplicate',
              slug: 'duplicate',
              native_symbol: 'ETH',
            },
          },
        }],
        response: { ok: true },
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/mysql_duplicate`, { method: 'POST' })

      await expectMokelayError(response, 'BLOCK_DUPLICATE_RECORD', '记录已经存在。')
    } finally {
      await server.close()
    }
  })

  it('supports session blocks with an independent signed cookie', async () => {
    let sqlCalls = 0
    const handler = createMokelayOrchestrationHandler({
      executeSql: async <T extends Record<string, unknown> = Record<string, unknown>>(
        _query: SQL,
        _datasource: string,
        databaseType: DatabaseType,
      ) => {
        sqlCalls += 1
        return {
          databaseType,
          rows: [] as T[],
        }
      },
      loadApiJson: async (apiJsonUuid) => {
        if (apiJsonUuid === 'add_session') {
          return {
            uuid: 'add_session',
            method: 'POST',
            request: { body: ['profile'] },
            blocks: [{
              uuid: 'add',
              functionName: 'addSession',
              inputs: {
                key: 'profile',
                value: { template: '{{request.body.profile}}' },
              },
            }],
            response: { ok: true },
          }
        }

        if (apiJsonUuid === 'read_session') {
          return {
            uuid: 'read_session',
            method: 'GET',
            blocks: [{
              uuid: 'read',
              functionName: 'readSession',
              inputs: { key: 'profile' },
              outputs: ['value'],
            }],
            response: {
              profile: { template: "{{blocks['read'].outputs.value}}" },
            },
          }
        }

        return {
          uuid: 'remove_then_read_session',
          method: 'POST',
          blocks: [
            {
              uuid: 'remove',
              functionName: 'removeSession',
              inputs: { key: 'profile' },
            },
            {
              uuid: 'read',
              functionName: 'readSession',
              inputs: { key: 'profile' },
            },
          ],
          response: {
            value: { template: "{{blocks['read'].outputs.value}}" },
          },
        }
      },
    })
    const server = await startServer(handler)

    try {
      const profile = { name: 'Session Builder', flags: ['template-value'] }
      const addResponse = await postJson(server.baseUrl, 'add_session', { profile })

      expect(addResponse.status).toBe(200)
      expect(addResponse.headers.get('set-cookie')).toContain(`${orchestrationSessionCookieName}=`)
      expect(await readMokelaySuccess<{ ok: true }>(addResponse)).toEqual({
        ok: true,
        data: { ok: true },
      })

      const cookie = responseCookie(addResponse, orchestrationSessionCookieName)
      const readResponse = await fetch(`${server.baseUrl}/api/mokelay/read_session`, {
        headers: { cookie },
      })
      const readBody = await readMokelayData<Record<string, unknown>>(readResponse)

      expect(readResponse.status).toBe(200)
      expect(readBody).toEqual({ profile })

      const removedReadResponse = await fetch(`${server.baseUrl}/api/mokelay/remove_then_read_session`, {
        method: 'POST',
        headers: { cookie },
      })
      const removedReadBody = await readMokelayData<Record<string, unknown>>(removedReadResponse)

      expect(removedReadBody).toEqual({ value: null })
      expect(sqlCalls).toBe(0)
    } finally {
      await server.close()
    }
  })

  it('validates session block inputs, outputs, and missing keys', async () => {
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async (apiJsonUuid) => {
        if (apiJsonUuid === 'missing_session_key') {
          return {
            uuid: 'missing_session_key',
            method: 'POST',
            blocks: [{
              uuid: 'add',
              functionName: 'addSession',
              inputs: { value: 'missing key' },
            }],
            response: { ok: true },
          }
        }

        if (apiJsonUuid === 'invalid_read_session_output') {
          return {
            uuid: 'invalid_read_session_output',
            method: 'POST',
            blocks: [{
              uuid: 'read',
              functionName: 'readSession',
              inputs: { key: 'missing' },
              outputs: ['data'],
            }],
            response: { ok: true },
          }
        }

        if (apiJsonUuid === 'read_missing_session') {
          return {
            uuid: 'read_missing_session',
            method: 'POST',
            blocks: [{
              uuid: 'read',
              functionName: 'readSession',
              inputs: { key: 'missing' },
              outputs: ['value'],
            }],
            response: {
              value: { template: "{{blocks['read'].outputs.value}}" },
            },
          }
        }

        if (apiJsonUuid === 'remove_missing_session') {
          return {
            uuid: 'remove_missing_session',
            method: 'POST',
            blocks: [{
              uuid: 'remove',
              functionName: 'removeSession',
              inputs: { key: 'missing' },
            }],
            response: { ok: true },
          }
        }

        return { uuid: apiJsonUuid, method: 'POST', blocks: [], response: { ok: true } }
      },
    })
    const server = await startServer(handler)

    try {
      const missingKeyResponse = await fetch(`${server.baseUrl}/api/mokelay/missing_session_key`, { method: 'POST' })
      const invalidOutputResponse = await fetch(`${server.baseUrl}/api/mokelay/invalid_read_session_output`, { method: 'POST' })
      const removeMissingResponse = await fetch(`${server.baseUrl}/api/mokelay/remove_missing_session`, { method: 'POST' })
      const readMissingResponse = await fetch(`${server.baseUrl}/api/mokelay/read_missing_session`, { method: 'POST' })
      const readMissingBody = await readMokelayData<Record<string, unknown>>(readMissingResponse)

      await expectMokelayError(missingKeyResponse, 'BLOCK_SESSION_KEY_INVALID', 'key 必须是非空字符串。')
      await expectMokelayError(invalidOutputResponse, 'BLOCK_UNSUPPORTED_OUTPUT', 'Block readSession 不支持输出：data')
      expect(removeMissingResponse.status).toBe(200)
      expect(readMissingBody).toEqual({ value: null })
    } finally {
      await server.close()
    }
  })

  it('rejects invalid API JSON schemas', async () => {
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'invalid_schema',
        method: 'POST',
        blocks: [{ uuid: 'b1' }],
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/invalid_schema`, { method: 'POST' })

      await expectMokelayError(response, 'API_JSON_INVALID_SCHEMA', /API JSON invalid_schema 不符合规范/)
    } finally {
      await server.close()
    }
  })

  it('supports affected outputs on update blocks', async () => {
    const handler = createMokelayOrchestrationHandler({
      executeSql: fakeSqlExecutor.execute,
      loadApiJson: async () => ({
        uuid: 'update_affected_outputs',
        method: 'POST',
        blocks: [
          {
            uuid: 'create',
            functionName: 'create',
            inputs: {
              datasource: 'Mokelay',
              table: 'users',
              idField: 'id',
              fields: {
                name: 'Before Update',
                email: 'update-affected@mokelay.test',
                password_hash: 'hashed',
              },
            },
            outputs: ['uuid'],
          },
          {
            uuid: 'update',
            functionName: 'update',
            inputs: {
              datasource: 'Mokelay',
              table: 'users',
              fields: {
                name: 'After Update',
              },
              conditions: [{
                group: false,
                conditionType: 'EQ',
                fieldName: 'id',
                fieldValue: {
                  template: "{{blocks['create'].outputs.uuid}}",
                },
              }],
            },
            outputs: ['affected'],
          },
        ],
        response: {
          affected: { template: "{{blocks['update'].outputs.affected}}" },
        },
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/update_affected_outputs`, { method: 'POST' })
      const body = await readMokelayData<Record<string, unknown>>(response)

      expect(response.status).toBe(200)
      expect(body).toEqual({ affected: 1 })
    } finally {
      await server.close()
    }
  })

  it('rejects physical field names on create block outputs', async () => {
    const handler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'invalid_create_outputs',
        method: 'POST',
        blocks: [{
          uuid: 'create',
          functionName: 'create',
          inputs: {
            datasource: 'Mokelay',
            table: 'users',
            idField: 'id',
            fields: {
              name: 'Invalid Outputs',
              email: 'invalid-outputs@mokelay.test',
              password_hash: 'hashed',
            },
          },
          outputs: ['id'],
        }],
        response: { ok: true },
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/invalid_create_outputs`, { method: 'POST' })

      await expectMokelayError(response, 'BLOCK_UNSUPPORTED_OUTPUT', 'Block create 不支持输出：id')
    } finally {
      await server.close()
    }
  })

  it('rejects unknown block functions, invalid conditions, and missing template variables', async () => {
    const invalidFunctionHandler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'invalid_function',
        method: 'POST',
        blocks: [{
          uuid: 'b1',
          functionName: 'unknown',
          inputs: {},
        }],
        response: { ok: true },
      }),
    })
    const invalidFunctionServer = await startServer(invalidFunctionHandler)

    try {
      const response = await fetch(`${invalidFunctionServer.baseUrl}/api/mokelay/invalid_function`, { method: 'POST' })

      await expectMokelayError(response, 'BLOCK_UNSUPPORTED_FUNCTION', '不支持的 Block functionName：unknown')
    } finally {
      await invalidFunctionServer.close()
    }

    const invalidConditionHandler = createMokelayOrchestrationHandler({
      executeSql: fakeSqlExecutor.execute,
      loadApiJson: async () => ({
        uuid: 'invalid_condition',
        method: 'POST',
        blocks: [
          {
            uuid: 'create',
            functionName: 'create',
            inputs: {
              datasource: 'Mokelay',
              table: 'users',
              idField: 'id',
              fields: {
                name: 'Condition User',
                email: 'condition@mokelay.test',
                password_hash: 'hashed',
              },
            },
          },
          {
            uuid: 'list',
            functionName: 'list',
            inputs: {
              datasource: 'Mokelay',
              table: 'users',
              fields: ['id'],
              conditions: [{
                group: false,
                conditionType: 'IN',
                fieldName: 'id',
                fieldValue: 'not-an-array',
              }],
            },
          },
        ],
        response: { ok: true },
      }),
    })
    const invalidConditionServer = await startServer(invalidConditionHandler)

    try {
      const response = await fetch(`${invalidConditionServer.baseUrl}/api/mokelay/invalid_condition`, { method: 'POST' })

      await expectMokelayError(response, 'BLOCK_INVALID_CONDITION_VALUE', 'IN 条件的 fieldValue 必须是非空数组。')
    } finally {
      await invalidConditionServer.close()
    }

    const missingTemplateHandler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'missing_template',
        method: 'POST',
        request: { body: ['name'] },
        blocks: [],
        response: {
          name: { template: '{{request.body.name}}' },
          missing: { template: '{{request.body.email}}' },
        },
      }),
    })
    const missingTemplateServer = await startServer(missingTemplateHandler)

    try {
      const response = await fetch(`${missingTemplateServer.baseUrl}/api/mokelay/missing_template`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Template User' }),
      })

      await expectMokelayError(response, 'TEMPLATE_VARIABLE_NOT_FOUND', '模板变量不存在：request.body.email')
    } finally {
      await missingTemplateServer.close()
    }
  })

  it('supports page blocks and empty responses', async () => {
    const pageHandler = createMokelayOrchestrationHandler({
      executeSql: fakeSqlExecutor.execute,
      loadApiJson: async () => ({
        uuid: 'page_users',
        method: 'POST',
        blocks: [
          {
            uuid: 'first',
            functionName: 'create',
            inputs: {
              datasource: 'Mokelay',
              table: 'users',
              idField: 'id',
              fields: {
                name: 'Page First',
                email: 'page-first@mokelay.test',
                password_hash: 'hashed',
              },
            },
          },
          {
            uuid: 'second',
            functionName: 'create',
            inputs: {
              datasource: 'Mokelay',
              table: 'users',
              idField: 'id',
              fields: {
                name: 'Page Second',
                email: 'page-second@mokelay.test',
                password_hash: 'hashed',
              },
            },
          },
          {
            uuid: 'page',
            functionName: 'page',
            inputs: {
              datasource: 'Mokelay',
              table: 'users',
              fields: ['id', 'name'],
              page: 1,
              pageSize: 1,
            },
          },
        ],
        response: {
          datas: { template: "{{blocks['page'].outputs.datas}}" },
          total: { template: "{{blocks['page'].outputs.total}}" },
          totalPages: { template: "{{blocks['page'].outputs.totalPages}}" },
        },
      }),
    })
    const pageServer = await startServer(pageHandler)

    try {
      const response = await fetch(`${pageServer.baseUrl}/api/mokelay/page_users`, { method: 'POST' })
      const body = await readMokelayData<Record<string, unknown>>(response)

      expect(response.status).toBe(200)
      expect(body.total).toBe(2)
      expect(body.totalPages).toBe(2)
      expect(body.datas).toEqual([
        expect.objectContaining({ name: 'Page First' }),
      ])
    } finally {
      await pageServer.close()
    }

    const emptyResponseHandler = createMokelayOrchestrationHandler({
      loadApiJson: async () => ({
        uuid: 'empty_response',
        method: 'GET',
        request: { body: ['ignored_on_get'] },
        blocks: [],
      }),
    })
    const emptyResponseServer = await startServer(emptyResponseHandler)

    try {
      const response = await fetch(`${emptyResponseServer.baseUrl}/api/mokelay/empty_response`)

      expect(response.status).toBe(200)
      expect(await readMokelaySuccess<null>(response)).toEqual({
        ok: true,
        data: null,
      })
    } finally {
      await emptyResponseServer.close()
    }
  })
})
