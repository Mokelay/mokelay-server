import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { createApp, createRouter, toNodeListener, type EventHandler } from 'h3'
import orchestrationHandler from '../../server/routes/api/mokelay/[apiJsonUuid]'
import missingApiJsonUuidHandler from '../../server/routes/api/mokelay/index'
import { createMokelayOrchestrationHandler } from '../../server/utils/orchestration'

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const pgDialect = new PgDialect()

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

class FakeSqlExecutor {
  readonly users: UserRow[] = []
  readonly pages: PageRow[] = []

  execute = async <T extends Record<string, unknown> = Record<string, unknown>>(query: SQL) => {
    const builtQuery = pgDialect.sqlToQuery(query)
    const queryText = builtQuery.sql.replace(/\s+/g, ' ').trim()
    const params = builtQuery.params

    if (queryText.startsWith('INSERT INTO "users"')) {
      return this.insertUser<T>(queryText, params)
    }

    if (queryText.startsWith('INSERT INTO "pages"')) {
      return this.insertPage<T>(queryText, params)
    }

    if (queryText.startsWith('SELECT count(*)::int AS total FROM "users"')) {
      return [{ total: this.filterUsers(queryText, params).length }] as unknown as T[]
    }

    if (queryText.startsWith('SELECT count(*)::int AS total FROM "pages"')) {
      return [{ total: this.filterPages(queryText, params).length }] as unknown as T[]
    }

    if (queryText.startsWith('SELECT')) {
      if (queryText.includes('FROM "pages"')) {
        return this.selectPages<T>(queryText, params)
      }

      return this.selectUsers<T>(queryText, params)
    }

    if (queryText.startsWith('UPDATE "users"')) {
      return this.updateUsers<T>(queryText, params)
    }

    if (queryText.startsWith('UPDATE "pages"')) {
      return this.updatePages<T>(queryText, params)
    }

    if (queryText.startsWith('DELETE FROM "users"')) {
      return this.deleteUsers<T>(queryText, params)
    }

    throw new Error(`Unsupported SQL in test fake: ${queryText}`)
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
  return await readJson<CreateUserResponse>(response)
}

async function createPage(baseUrl: string, input: { name: string, blocks: unknown[] }) {
  const response = await postJson(baseUrl, 'create_page', input)

  expect(response.status).toBe(200)
  return await readJson<PageResponse>(response)
}

describe('mokelay orchestration API', () => {
  let testServer: TestServer
  let fakeSqlExecutor: FakeSqlExecutor
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    fakeSqlExecutor = new FakeSqlExecutor()
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgres://unit-test',
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
    const readBody = await readJson<ReadUserResponse>(readResponse)

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
    const updateBody = await readJson<Record<string, unknown>>(updateResponse)

    expect(updateResponse.status).toBe(200)
    expect(updateBody).toEqual({ update: true })

    const updatedReadResponse = await fetch(`${testServer.baseUrl}/api/mokelay/read_user_by_id?id=${created.id}`)
    const updatedReadBody = await readJson<ReadUserResponse>(updatedReadResponse)

    expect(updatedReadBody.user_info).toMatchObject({
      id: created.id,
      name: 'Alice Updated',
      email: 'alice.updated@mokelay.test',
    })

    await createUser(testServer.baseUrl, {
      name: 'Bob',
      email: 'bob@mokelay.test',
    })

    const listResponse = await postJson(testServer.baseUrl, 'read_user_list', {
      created_at_begin: '1970-01-01T00:00:00.000Z',
      created_at_end: '2999-12-31T23:59:59.999Z',
      name: 'Alice Updated',
    })
    const listBody = await readJson<UserListResponse>(listResponse)

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
    const deleteBody = await readJson<Record<string, unknown>>(deleteResponse)

    expect(deleteResponse.status).toBe(200)
    expect(deleteBody).toEqual({ message: '删除成功' })

    const missingReadResponse = await fetch(`${testServer.baseUrl}/api/mokelay/read_user_by_id?id=${created.id}`)
    const missingReadBody = await readJson<ReadUserResponse>(missingReadResponse)

    expect(missingReadResponse.status).toBe(200)
    expect(missingReadBody.user_info).toBeNull()
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
    const readBody = await readJson<PageResponse>(readResponse)

    expect(readResponse.status).toBe(200)
    expect(readBody.page).toEqual(firstPage)

    const updateResponse = await postJson(
      testServer.baseUrl,
      'update_page_blocks_by_uuid',
      {
        blocks: [{ type: 'text', value: 'Updated' }],
      },
      `?uuid=${firstPage?.uuid}`,
    )
    const updateBody = await readJson<PageResponse>(updateResponse)

    expect(updateResponse.status).toBe(200)
    expect(updateBody.page).toMatchObject({
      uuid: firstPage?.uuid,
      name: 'First Page',
      blocks: [{ type: 'text', value: 'Updated' }],
    })

    const listResponse = await fetch(`${testServer.baseUrl}/api/mokelay/list_pages?page=1&pageSize=1`)
    const listBody = await readJson<PageListResponse>(listResponse)

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
    const secondPageBody = await readJson<PageListResponse>(secondPageResponse)

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
  })

  it('returns 400 when API_JSON_UUID is missing', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/mokelay`)

    expect(response.status).toBe(400)
  })

  it('returns 404 for unknown API JSON definitions', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/mokelay/not_found`)

    expect(response.status).toBe(404)
  })

  it('stops orchestration when DATABASE_URL is missing', async () => {
    process.env.DATABASE_URL = ''

    const response = await postJson(testServer.baseUrl, 'create_user_info', {
      name: 'No Database',
      email: 'no-database@mokelay.test',
      password_hash: 'hashed',
    })

    expect(response.status).toBe(500)

    process.env.DATABASE_URL = 'postgres://unit-test'
  })

  it('rejects method mismatches and missing declared parameters', async () => {
    const methodMismatchResponse = await fetch(`${testServer.baseUrl}/api/mokelay/create_user_info`)

    expect(methodMismatchResponse.status).toBe(400)

    const missingBodyFieldResponse = await postJson(testServer.baseUrl, 'create_user_info', {
      name: 'Missing Password',
      email: 'missing-password@mokelay.test',
    })

    expect(missingBodyFieldResponse.status).toBe(400)
  })

  it('does not require tables or fields to be predeclared in server code', async () => {
    const handler = createMokelayOrchestrationHandler({
      executeSql: async <T extends Record<string, unknown> = Record<string, unknown>>() => (
        [{ arbitrary_field: 'from-json-config' }] as unknown as T[]
      ),
      loadApiJson: async () => ({
        uuid: 'custom_table_list',
        method: 'POST',
        blocks: [{
          uuid: 'list',
          functionName: 'list',
          inputs: {
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
      const body = await readJson<Record<string, unknown>>(response)

      expect(response.status).toBe(200)
      expect(body).toEqual({
        datas: [{ arbitrary_field: 'from-json-config' }],
      })
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

      expect(response.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('rejects outputs on update blocks', async () => {
    const handler = createMokelayOrchestrationHandler({
      executeSql: fakeSqlExecutor.execute,
      loadApiJson: async () => ({
        uuid: 'invalid_update_outputs',
        method: 'POST',
        blocks: [{
          uuid: 'update',
          functionName: 'update',
          inputs: {
            table: 'users',
            fields: {
              name: 'Should Not Return',
            },
          },
          outputs: ['id'],
        }],
        response: { ok: true },
      }),
    })
    const server = await startServer(handler)

    try {
      const response = await fetch(`${server.baseUrl}/api/mokelay/invalid_update_outputs`, { method: 'POST' })

      expect(response.status).toBe(400)
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

      expect(response.status).toBe(400)
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
              table: 'users',
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

      expect(response.status).toBe(400)
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

      expect(response.status).toBe(400)
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
              table: 'users',
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
              table: 'users',
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
      const body = await readJson<Record<string, unknown>>(response)

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

      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
    } finally {
      await emptyResponseServer.close()
    }
  })
})
