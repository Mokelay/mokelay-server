import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { PgDialect } from 'drizzle-orm/pg-core'
import { createApp, createRouter, toNodeListener, type EventHandler } from 'h3'
import orchestrationHandler from '../../server/routes/api/mokelay/[apiJsonUuid]'
import missingApiJsonUuidHandler from '../../server/routes/api/mokelay/index'
import { createMokelayOrchestrationHandler } from '../../server/utils/orchestration'
import type { MokelayErrorCode } from '../../server/utils/mokelay-error'
import { verifyPassword } from '../../server/utils/password'
import { orchestrationSessionCookieName } from '../../server/utils/session'
import type { DatabaseType, SqlExecutionResult } from '../../server/utils/db'

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

type PublicApi = {
  uuid: string
  name: string
  method: string
  status: string
  apiJson?: Record<string, unknown>
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const pgDialect = new PgDialect()
const mysqlDialect = new MySqlDialect()

type UserRow = {
  id: string
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

type ApiRow = {
  uuid: string
  name: string
  method: string
  status: string
  api_json: Record<string, unknown>
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

class FakeSqlExecutor {
  readonly users: UserRow[] = []
  readonly pages: PageRow[] = []
  readonly apis: ApiRow[] = []
  readonly apiSnapshots: ApiSnapshotRow[] = []
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

    if (queryText.startsWith('INSERT INTO "users"')) {
      return this.result(databaseType, this.insertUser<T>(queryText, params))
    }

    if (queryText.startsWith('INSERT INTO "pages"')) {
      return this.result(databaseType, this.insertPage<T>(queryText, params))
    }

    if (queryText.startsWith('INSERT INTO "apis"')) {
      return this.result(databaseType, this.upsertApi<T>(queryText, params))
    }

    if (queryText.startsWith('INSERT INTO "apis_snapshot"')) {
      return this.result(databaseType, this.insertApiSnapshot<T>(queryText, params))
    }

    if (queryText.startsWith('SELECT count(*)::int AS total FROM "users"')) {
      return this.result(databaseType, [{ total: this.filterUsers(queryText, params).length }] as unknown as T[])
    }

    if (queryText.startsWith('SELECT count(*)::int AS total FROM "pages"')) {
      return this.result(databaseType, [{ total: this.filterPages(queryText, params).length }] as unknown as T[])
    }

    if (queryText.startsWith('SELECT count(*)::int AS total FROM "apis"')) {
      return this.result(databaseType, [{ total: this.filterApis(queryText, params).length }] as unknown as T[])
    }

    if (queryText.startsWith('SELECT')) {
      if (queryText.includes('FROM "apis"')) {
        return this.result(databaseType, this.selectApis<T>(queryText, params))
      }

      if (queryText.includes('FROM "pages"')) {
        return this.result(databaseType, this.selectPages<T>(queryText, params))
      }

      return this.result(databaseType, this.selectUsers<T>(queryText, params))
    }

    if (queryText.startsWith('UPDATE "users"')) {
      return this.result(databaseType, this.updateUsers<T>(queryText, params))
    }

    if (queryText.startsWith('UPDATE "pages"')) {
      return this.result(databaseType, this.updatePages<T>(queryText, params))
    }

    if (queryText.startsWith('DELETE FROM "users"')) {
      return this.result(databaseType, this.deleteUsers<T>(queryText, params))
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

  private insertUser<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const columnMatch = /INSERT INTO "users" \((.*?)\) VALUES/.exec(queryText)
    const columns = columnMatch?.[1]?.match(/"([^"]+)"/g)?.map((column) => column.replaceAll('"', '')) ?? []
    const now = new Date().toISOString()
    const row: UserRow = {
      id: crypto.randomUUID(),
      name: '',
      email: '',
      password_hash: '',
      plan: 'free',
      created_at: now,
      updated_at: now,
    }

    columns.forEach((column, index) => {
      row[column as keyof UserRow] = params[index] as never
    })

    this.users.push(row)

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

  private upsertApi<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const columns = this.insertColumns(queryText, 'apis')
    const now = new Date().toISOString()
    const nextRow: ApiRow = {
      uuid: '',
      name: '',
      method: 'GET',
      status: 'draft',
      api_json: {},
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

  private selectUsers<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const fields = this.selectFields(queryText)
    const users = this.filterUsers(queryText, params)
    const rows = queryText.includes(' OFFSET ')
      ? users.slice(Number(params.at(-1) ?? 0), Number(params.at(-1) ?? 0) + Number(params.at(-2) ?? 1))
      : queryText.includes(' LIMIT 1')
        ? users.slice(0, 1)
        : users

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

  private updateUsers<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const setMatch = / SET (.*?) WHERE /.exec(queryText) ?? / SET (.*?) RETURNING /.exec(queryText)
    const setFields = setMatch?.[1]?.match(/"([^"]+)" =/g)?.map((field) => field.replace(/" =$/, '').replaceAll('"', '')) ?? []
    const setParamCount = setFields.length
    const users = this.filterUsers(queryText, params.slice(setParamCount))

    for (const user of users) {
      setFields.forEach((field, index) => {
        user[field as keyof UserRow] = params[index] as never
      })
    }

    return users.map(() => ({ affected_marker: 1 })) as unknown as T[]
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

  private deleteUsers<T extends Record<string, unknown>>(queryText: string, params: unknown[]) {
    const users = this.filterUsers(queryText, params)
    const ids = new Set(users.map((user) => user.id))

    for (let index = this.users.length - 1; index >= 0; index -= 1) {
      if (ids.has(this.users[index]?.id || '')) {
        this.users.splice(index, 1)
      }
    }

    return users.map(() => ({ affected_marker: 1 })) as unknown as T[]
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

  private filterUsers(queryText: string, params: unknown[]) {
    if (!queryText.includes(' WHERE ')) {
      return [...this.users]
    }

    if (queryText.includes('"id" =')) {
      const id = params.at(-1)
      return this.users.filter((user) => user.id === id)
    }

    if (queryText.includes('"plan" =')) {
      const plan = params.at(-1)
      return this.users.filter((user) => user.plan === plan)
    }

    if (queryText.includes('"email" =')) {
      const email = params.at(-1)
      return this.users.filter((user) => user.email === email)
    }

    if (queryText.includes('"name" =') && queryText.includes('"created_at" >=')) {
      const [name, createdAtBegin, createdAtEnd] = params

      return this.users.filter((user) => (
        user.name === name
        && user.created_at >= String(createdAtBegin)
        && user.created_at <= String(createdAtEnd)
      ))
    }

    if (queryText.includes('"id" IN')) {
      return this.users.filter((user) => params.includes(user.id))
    }

    return [...this.users]
  }

  private filterPages(queryText: string, params: unknown[]) {
    if (!queryText.includes(' WHERE ')) {
      return [...this.pages]
    }

    if (queryText.includes('"uuid" =')) {
      const uuid = params.at(-1)
      return this.pages.filter((page) => page.uuid === uuid)
    }

    return [...this.pages]
  }

  private filterApis(queryText: string, params: unknown[]) {
    if (!queryText.includes(' WHERE ')) {
      return [...this.apis]
    }

    if (queryText.includes('"uuid" =') && queryText.includes('"uuid" <>')) {
      const [uuid, ignoredUuid] = params
      return this.apis.filter((api) => api.uuid === uuid && api.uuid !== ignoredUuid)
    }

    if (queryText.includes('"uuid" =')) {
      const uuid = params.at(-1)
      return this.apis.filter((api) => api.uuid === uuid)
    }

    return [...this.apis]
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

async function createPage(baseUrl: string, input: { name: string, blocks: unknown[] }) {
  const response = await postJson(baseUrl, 'create_page', input)

  expect(response.status).toBe(200)
  return await readMokelayData<PageResponse>(response)
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
      name: '  Register User  ',
      email: '  register@mokelay.test  ',
      password: 'abc12345',
    })
    const body = await readMokelayData<RegisterResponse>(response)
    const row = fakeSqlExecutor.users.find((user) => user.email === 'register@mokelay.test')

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain(`${orchestrationSessionCookieName}=`)
    expect(body.user).toMatchObject({
      id: expect.stringMatching(uuidPattern),
      name: 'Register User',
      email: 'register@mokelay.test',
      plan: 'free',
    })
    expect(row).toBeDefined()
    expect(row?.name).toBe('Register User')
    expect(row?.password_hash).not.toBe('abc12345')
    expect(await verifyPassword(row?.password_hash || '', 'abc12345')).toBe(true)
  })

  it('stops stored register when the output processor detects a duplicate email', async () => {
    const firstResponse = await postJson(testServer.baseUrl, 'register', {
      name: 'First Register',
      email: 'duplicate@mokelay.test',
      password: 'abc12345',
    })

    expect(firstResponse.status).toBe(200)
    expect((await readMokelaySuccess<RegisterResponse>(firstResponse)).ok).toBe(true)

    const duplicateResponse = await postJson(testServer.baseUrl, 'register', {
      name: 'Duplicate Register',
      email: 'duplicate@mokelay.test',
      password: 'abc12345',
    })

    await expectMokelayError(duplicateResponse, 'PROCESSOR_VALIDATION_FAILED', /Processor eq/)
    expect(fakeSqlExecutor.users).toHaveLength(1)
  })

  it('executes the stored login API JSON and stores the public user in orchestration session', async () => {
    const registerResponse = await postJson(testServer.baseUrl, 'register', {
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
      name: 'Login User',
      email: 'login@mokelay.test',
      plan: 'free',
    }))
    expect(body.user).not.toHaveProperty('password_hash')
  })

  it('rejects stored login JSON for unknown users, wrong passwords, and invalid email', async () => {
    const registerResponse = await postJson(testServer.baseUrl, 'register', {
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
        body: { name: 'Invalid Email', email: 'not-email', password: 'abc12345' },
        message: /Processor email_check/,
      },
      {
        body: { name: 'Short Password', email: 'short-password@mokelay.test', password: 'a1' },
        message: /Processor min/,
      },
      {
        body: { name: 'Missing Digit', email: 'missing-digit@mokelay.test', password: 'abcdefgh' },
        message: /Processor regex/,
      },
      {
        body: { name: 'Missing Letter', email: 'missing-letter@mokelay.test', password: '12345678' },
        message: /Processor regex/,
      },
    ]

    for (const item of cases) {
      const response = await postJson(testServer.baseUrl, 'register', item.body)

      await expectMokelayError(response, 'PROCESSOR_VALIDATION_FAILED', item.message)
    }

    expect(fakeSqlExecutor.users).toHaveLength(0)
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
    expect(new Set(fakeSqlExecutor.datasources)).toEqual(new Set(['Mokelay']))
  })

  it('executes the stored API builder CRUD JSON definitions', async () => {
    const registerApiJson = {
      uuid: 'register_users',
      alias: 'users 注册接口',
      method: 'POST',
      blocks: [],
      response: null,
    }
    const loginApiJson = {
      uuid: 'login_users',
      alias: 'users 登录接口',
      method: 'POST',
      blocks: [],
      response: null,
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
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    expect(fakeSqlExecutor.apiSnapshots).toHaveLength(1)
    expect(fakeSqlExecutor.apiSnapshots[0]).toMatchObject({
      api_uuid: 'register_users',
      name: 'users 注册接口',
      method: 'POST',
      status: 'draft',
      api_json: registerApiJson,
      created_at: expect.any(String),
    })

    const secondSaveResponse = await postJson(testServer.baseUrl, 'save_api', {
      uuid: loginApiJson.uuid,
      name: 'users 登录接口',
      method: 'POST',
      status: 'published',
      apiJson: loginApiJson,
    })

    expect(secondSaveResponse.status).toBe(200)
    expect(fakeSqlExecutor.apiSnapshots).toHaveLength(2)
    expect(fakeSqlExecutor.apiSnapshots[1]).toMatchObject({
      api_uuid: 'login_users',
      name: 'users 登录接口',
      status: 'published',
      api_json: loginApiJson,
    })

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

  it('maps MySQL duplicate key errors to the duplicate record block error', async () => {
    process.env.BingX_DATABASE_URL = 'mysql://unit-test'
    const duplicateError = Object.assign(new Error('Duplicate entry'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    })
    const handler = createMokelayOrchestrationHandler({
      executeSql: async () => {
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
