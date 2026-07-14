import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import type { TransactionRunner } from 'mokelay-server-core/utils/db'
import type { SqlExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import {
  auditPageRelations,
  rebuildPageRelations,
  savePageBatchWithRelations,
} from '../../server/utils/pageRelationStore'

const dialect = new PgDialect()
const parentUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const childUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const secondParentUuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function rows() {
  return [
    {
      uuid: parentUuid,
      name: 'Parent',
      blocks: [{ type: 'MTabs', data: { tabs: [{ pageUUID: childUuid }] } }],
      sub_page: false,
      quotes: [],
      dependencies: [],
    },
    {
      uuid: childUuid,
      name: 'Child',
      blocks: [],
      sub_page: false,
      quotes: [],
      dependencies: [],
    },
  ]
}

function executor(pageRows: Array<Record<string, unknown>> = rows()) {
  const statements: string[] = []
  const executeSql = vi.fn(async (query: SQL) => {
    const statement = dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim()
    statements.push(statement)
    if (statement.startsWith('SELECT id, version')) {
      return { databaseType: 'postgres' as const, rows: [{ id: 1, version: 0 }] }
    }
    if (statement.includes('FROM "pages"') && statement.startsWith('SELECT')) {
      return { databaseType: 'postgres' as const, rows: pageRows }
    }
    return { databaseType: 'postgres' as const, rows: [] }
  }) as unknown as SqlExecutor
  return { executeSql, statements }
}

describe('page relation backfill', () => {
  it('audits without writes and reports canonical direct edges', async () => {
    const { executeSql, statements } = executor()
    const report = await auditPageRelations(executeSql, [])

    expect(report).toMatchObject({ graphVersion: 0, ready: false })
    expect(report.changedCount).toBe(2)
    expect(report.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ uuid: parentUuid, uuidAfter: parentUuid, dependencies: [childUuid] }),
      expect.objectContaining({ uuid: childUuid, subPage: true, quotes: [parentUuid] }),
    ]))
    expect(statements.every(statement => statement.startsWith('SELECT'))).toBe(true)
  })

  it('locks version zero, persists all relations and promotes version one atomically', async () => {
    const { executeSql, statements } = executor()
    const withTransaction: TransactionRunner = async callback => await callback(executeSql)
    const report = await rebuildPageRelations('postgres', withTransaction, [])

    expect(report).toMatchObject({ previousVersion: 0, version: 1, pageCount: 2, changedCount: 2 })
    expect(statements.some(statement => statement.includes('FOR UPDATE'))).toBe(true)
    expect(statements.some(statement => statement.startsWith('UPDATE "pages" SET "uuid"'))).toBe(false)
    expect(statements.filter(statement => statement.startsWith('UPDATE "pages" SET "sub_page"'))).toHaveLength(2)
    expect(statements.some(statement => statement.includes('SET version ='))).toBe(true)
  })

  it('fails closed on malformed persisted blocks before writing', async () => {
    const { executeSql, statements } = executor([{
      ...rows()[0],
      blocks: '{broken-json',
    }])
    const withTransaction: TransactionRunner = async callback => await callback(executeSql)

    await expect(rebuildPageRelations('postgres', withTransaction, [])).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_SCHEMA' },
    })
    expect(statements.every(statement => statement.startsWith('SELECT'))).toBe(true)
  })

  it('reports noncanonical stored slugs as blocking audit drift without writing', async () => {
    const { executeSql, statements } = executor([{
      uuid: ' Customer_Orders ',
      name: 'Customer Orders',
      blocks: [],
      sub_page: false,
      quotes: [],
      dependencies: [],
    }])

    const report = await auditPageRelations(executeSql, [])
    expect(report.changes).toEqual([expect.objectContaining({
      uuid: ' Customer_Orders ',
      uuidAfter: 'customer_orders',
      changedFields: ['uuid'],
    })])
    expect(statements.every(statement => statement.startsWith('SELECT'))).toBe(true)
  })

  it('refuses to rename noncanonical stored slugs during relation rebuild', async () => {
    const { executeSql, statements } = executor([{
      uuid: ' Customer_Orders ',
      name: 'Customer Orders',
      blocks: [],
      sub_page: false,
      quotes: [],
      dependencies: [],
    }])
    const withTransaction: TransactionRunner = async callback => await callback(executeSql)

    await expect(rebuildPageRelations('postgres', withTransaction, [])).rejects.toMatchObject({
      statusCode: 409,
      data: {
        code: 'BLOCK_PAGE_UUID_INVALID',
        details: { pages: [{ uuid: ' Customer_Orders ', normalizedUuid: 'customer_orders' }] },
      },
    })
    expect(statements.some(statement => statement.startsWith('UPDATE'))).toBe(false)
  })

  it('validates forward references against the final page batch graph', async () => {
    const { executeSql, statements } = executor([])
    // Writes require the promoted graph state.
    const readyExecutor = (async (query: SQL) => {
      const statement = dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim()
      if (statement.startsWith('SELECT id, version')) {
        statements.push(statement)
        return { databaseType: 'postgres', rows: [{ id: 1, version: 1 }] }
      }
      return await executeSql(query)
    }) as unknown as SqlExecutor
    const withTransaction: TransactionRunner = async callback => await callback(readyExecutor)
    const result = await savePageBatchWithRelations([
      {
        mode: 'create',
        uuid: parentUuid,
        name: 'Parent',
        blocks: [{ type: 'MTabs', data: { tabs: [{ pageUUID: childUuid }] } }],
      },
      { mode: 'create', uuid: childUuid, name: 'Child', blocks: [] },
    ], 'postgres', withTransaction, [])

    expect(result.affected).toBe(2)
    expect(statements.filter(statement => statement.startsWith('INSERT INTO "pages"'))).toHaveLength(2)
  })

  it('rejects malformed explicit relation assertions instead of treating them as empty arrays', async () => {
    const { executeSql } = executor([])
    const readyExecutor = (async (query: SQL) => {
      const statement = dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim()
      if (statement.startsWith('SELECT id, version')) {
        return { databaseType: 'postgres' as const, rows: [{ id: 1, version: 1 }] }
      }
      return await executeSql(query)
    }) as unknown as SqlExecutor
    const withTransaction: TransactionRunner = async callback => await callback(readyExecutor)

    await expect(savePageBatchWithRelations([{
      mode: 'create',
      uuid: childUuid,
      name: 'Child',
      blocks: [],
      dependencies: {},
    }], 'postgres', withTransaction, [])).rejects.toMatchObject({
      data: { code: 'BLOCK_PAGE_REFERENCE_ASSERTION_MISMATCH' },
    })
  })

  it.each([
    ['out-of-order', JSON.stringify([secondParentUuid, parentUuid.toLowerCase()])],
    ['duplicate', JSON.stringify([parentUuid.toLowerCase(), parentUuid.toLowerCase(), secondParentUuid])],
    ['non-string', JSON.stringify([parentUuid.toLowerCase(), 7, secondParentUuid])],
  ])('reports %s persisted relation arrays as drift', async (_case, storedQuotes) => {
    const pageRows = [
      {
        uuid: parentUuid.toLowerCase(),
        name: 'Parent',
        blocks: [{ type: 'MTabs', data: { tabs: [{ pageUUID: childUuid }] } }],
        sub_page: false,
        quotes: [],
        dependencies: [childUuid],
      },
      {
        uuid: secondParentUuid,
        name: 'Second Parent',
        blocks: [{ type: 'MTabs', data: { tabs: [{ pageUUID: childUuid }] } }],
        sub_page: false,
        quotes: [],
        dependencies: [childUuid],
      },
      {
        uuid: childUuid,
        name: 'Child',
        blocks: [],
        sub_page: true,
        quotes: storedQuotes,
        dependencies: [],
      },
    ]
    const { executeSql, statements } = executor(pageRows)
    const report = await auditPageRelations(executeSql, [])

    expect(report.changes).toContainEqual(expect.objectContaining({
      uuid: childUuid,
      changedFields: ['quotes'],
    }))
    expect(statements.every(statement => statement.startsWith('SELECT'))).toBe(true)
  })
})
