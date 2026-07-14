import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql, type SQL } from 'drizzle-orm'
import {
  executeDatasourceSql,
  executeDatasourceTransaction,
  useDatasourceConnection,
  type DatabaseType,
  type TransactionRunner,
} from 'mokelay-server-core/utils/db'
import type { SqlExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import {
  createAiDslAssetSqlStore,
  saveAiDslAssets,
} from '../../server/utils/blocks/saveAiDslAssets'
import {
  deletePagesWithRelations,
  savePageBatchWithRelations,
  savePageWithRelations,
  type PageSaveInput,
} from '../../server/utils/pageRelationStore'

const pageA = '11111111-1111-4111-8111-111111111111'
const pageB = '22222222-2222-4222-8222-222222222222'
const pageC = '33333333-3333-4333-8333-333333333333'

type DialectSpec = {
  name: string
  databaseType: DatabaseType
  datasource: string
  url?: string
  createStatements: string[]
}

const postgresUrl = process.env.PAGE_REFERENCE_TEST_POSTGRES_URL
const mysqlUrl = process.env.PAGE_REFERENCE_TEST_MYSQL_URL

const dialects: DialectSpec[] = [
  {
    name: 'PostgreSQL',
    databaseType: 'postgres',
    datasource: 'PageReferenceTestPostgres',
    url: postgresUrl,
    createStatements: [
      'DROP TABLE IF EXISTS page_reference_graph_state',
      'DROP TABLE IF EXISTS pages',
      `CREATE TABLE pages (
        uuid varchar(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name varchar(120) NOT NULL UNIQUE,
        blocks jsonb NOT NULL,
        app_uuid varchar(128),
        layout_uuid varchar(128),
        sub_page boolean NOT NULL DEFAULT false,
        quotes jsonb NOT NULL DEFAULT '[]'::jsonb,
        dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pages_uuid_slug_check CHECK (
          char_length(uuid) BETWEEN 1 AND 128 AND uuid !~ '[^a-z0-9_-]'
        )
      )`,
      `CREATE TABLE page_reference_graph_state (
        id integer PRIMARY KEY CHECK (id = 1),
        revision bigint NOT NULL DEFAULT 0,
        version integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      'INSERT INTO page_reference_graph_state (id, revision, version) VALUES (1, 0, 1)',
    ],
  },
  {
    name: 'MySQL',
    databaseType: 'mysql',
    datasource: 'PageReferenceTestMysql',
    url: mysqlUrl,
    createStatements: [
      'DROP TABLE IF EXISTS page_reference_graph_state',
      'DROP TABLE IF EXISTS pages',
      `CREATE TABLE pages (
        uuid varchar(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY DEFAULT (UUID()),
        name varchar(120) NOT NULL UNIQUE,
        blocks json NOT NULL,
        app_uuid varchar(128),
        layout_uuid varchar(128),
        sub_page tinyint(1) NOT NULL DEFAULT 0,
        quotes json NOT NULL,
        dependencies json NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        CONSTRAINT chk_pages_uuid_slug CHECK (
          CHAR_LENGTH(uuid) BETWEEN 1 AND 128
          AND REGEXP_LIKE(uuid, _ascii'^[a-z0-9_-]+$', 'c')
        )
      ) ENGINE=InnoDB`,
      `CREATE TABLE page_reference_graph_state (
        id tinyint unsigned PRIMARY KEY,
        revision bigint unsigned NOT NULL DEFAULT 0,
        version int unsigned NOT NULL DEFAULT 1,
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
      ) ENGINE=InnoDB`,
      'INSERT INTO page_reference_graph_state (id, revision, version) VALUES (1, 0, 1)',
    ],
  },
]

function tabs(targetUuid: string) {
  return [{
    type: 'MTabs',
    data: { tabs: [{ pageUUID: targetUuid, pageSource: 'user' }] },
  }]
}

function relationArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[]
  if (typeof value !== 'string') return []
  return JSON.parse(value) as string[]
}

for (const dialect of dialects) {
  const dialectDescribe = dialect.url ? describe.sequential : describe.skip

  dialectDescribe(`${dialect.name} page relation transactions`, () => {
    const executeSql: SqlExecutor = async <T extends Record<string, unknown> = Record<string, unknown>>(
      query: SQL,
    ) => await executeDatasourceSql<T>(query, dialect.datasource)
    const withTransaction: TransactionRunner = (callback, options) => (
      executeDatasourceTransaction(dialect.datasource, callback, options)
    )

    async function executeRaw(statement: string) {
      await executeDatasourceSql(sql.raw(statement), dialect.datasource)
    }

    async function resetGraph() {
      await executeRaw('DELETE FROM pages')
      await executeRaw('UPDATE page_reference_graph_state SET revision = 0, version = 1')
    }

    async function rows() {
      return (await executeDatasourceSql<Record<string, unknown>>(sql`
        SELECT uuid, name, blocks, sub_page, quotes, dependencies
        FROM ${sql.identifier('pages')}
        ORDER BY uuid
      `, dialect.datasource)).rows
    }

    async function row(uuid: string) {
      return (await executeDatasourceSql<Record<string, unknown>>(sql`
        SELECT uuid, name, blocks, sub_page, quotes, dependencies
        FROM ${sql.identifier('pages')}
        WHERE uuid = ${uuid}
        LIMIT 1
      `, dialect.datasource)).rows[0]
    }

    async function save(inputs: PageSaveInput[]) {
      return await savePageBatchWithRelations(
        inputs,
        dialect.databaseType,
        withTransaction,
        [],
      )
    }

    beforeAll(async () => {
      process.env[`${dialect.datasource}_DATABASE_URL`] = dialect.url
      for (const statement of dialect.createStatements) await executeRaw(statement)
    })

    beforeEach(resetGraph)

    afterAll(async () => {
      try {
        await executeRaw('DROP TABLE IF EXISTS page_reference_graph_state')
        await executeRaw('DROP TABLE IF EXISTS pages')
      } finally {
        const connection = useDatasourceConnection(dialect.datasource) as unknown as {
          client: { end: () => Promise<unknown> }
        }
        await connection.client.end()
        delete process.env[`${dialect.datasource}_DATABASE_URL`]
      }
    })

    it('accepts a 128-character slug and lets the database CHECK reject invalid characters', async () => {
      const maxSlug = 'a'.repeat(128)
      await expect(save([{
        mode: 'create',
        uuid: maxSlug,
        name: 'Max Slug',
        blocks: [],
      }])).resolves.toMatchObject({ affected: 1 })
      expect((await row(maxSlug))?.uuid).toBe(maxSlug)

      await resetGraph()
      const emptyJson = dialect.databaseType === 'postgres'
        ? sql`${'[]'}::jsonb`
        : sql`${'[]'}`
      await expect(executeSql(sql`
        INSERT INTO ${sql.identifier('pages')}
          (${sql.identifier('uuid')}, ${sql.identifier('name')}, ${sql.identifier('blocks')}, ${sql.identifier('quotes')}, ${sql.identifier('dependencies')})
        VALUES (${'invalid.slug'}, ${'Invalid Slug'}, ${emptyJson}, ${emptyJson}, ${emptyJson})
      `)).rejects.toBeDefined()
      expect(await rows()).toEqual([])
    })

    it('serializes concurrent creates of the same canonical slug so only one succeeds', async () => {
      const results = await Promise.allSettled([
        savePageWithRelations(
          { mode: 'create', uuid: ' Customer_Orders ', name: 'Customer Orders A', blocks: [] },
          dialect.databaseType,
          withTransaction,
          [],
        ),
        savePageWithRelations(
          { mode: 'create', uuid: 'customer_orders', name: 'Customer Orders B', blocks: [] },
          dialect.databaseType,
          withTransaction,
          [],
        ),
      ])

      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find(result => result.status === 'rejected')
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: { statusCode: 409, data: { code: 'BLOCK_DUPLICATE_RECORD' } },
      })
      expect((await rows()).map(item => item.uuid)).toEqual(['customer_orders'])
    })

    it('serializes concurrent A->B and B->A updates so only one edge commits', async () => {
      await save([
        { mode: 'create', uuid: pageA, name: 'Page A', blocks: [] },
        { mode: 'create', uuid: pageB, name: 'Page B', blocks: [] },
      ])

      const results = await Promise.allSettled([
        savePageWithRelations(
          { mode: 'update', uuid: pageA, name: 'Page A', blocks: tabs(pageB) },
          dialect.databaseType,
          withTransaction,
          [],
        ),
        savePageWithRelations(
          { mode: 'update', uuid: pageB, name: 'Page B', blocks: tabs(pageA) },
          dialect.databaseType,
          withTransaction,
          [],
        ),
      ])

      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
      const stored = await rows()
      const dependencies = stored.map(item => relationArray(item.dependencies))
      expect(dependencies.filter(value => value.length === 1)).toHaveLength(1)
      expect(dependencies.filter(value => value.length === 0)).toHaveLength(1)
    })

    it('leaves no dangling edge after a concurrent parent create and child delete', async () => {
      await save([{ mode: 'create', uuid: pageB, name: 'Child', blocks: [] }])

      const results = await Promise.allSettled([
        savePageWithRelations(
          { mode: 'create', uuid: pageA, name: 'Parent', blocks: tabs(pageB) },
          dialect.databaseType,
          withTransaction,
          [],
        ),
        deletePagesWithRelations([pageB], dialect.databaseType, withTransaction, []),
      ])

      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
      const parent = await row(pageA)
      const child = await row(pageB)
      expect(parent ? Boolean(child) : !child).toBe(true)
    })

    it('maintains multiple quotes and clears subPage after the last parent removes its edge', async () => {
      await save([
        { mode: 'create', uuid: pageA, name: 'Parent A', blocks: tabs(pageC) },
        { mode: 'create', uuid: pageB, name: 'Parent B', blocks: tabs(pageC) },
        { mode: 'create', uuid: pageC, name: 'Child', blocks: [] },
      ])

      expect(relationArray((await row(pageC))?.quotes)).toEqual([pageA, pageB])
      await savePageWithRelations(
        { mode: 'update', uuid: pageA, name: 'Parent A', blocks: [] },
        dialect.databaseType,
        withTransaction,
        [],
      )
      expect(relationArray((await row(pageC))?.quotes)).toEqual([pageB])
      await savePageWithRelations(
        { mode: 'update', uuid: pageB, name: 'Parent B', blocks: [] },
        dialect.databaseType,
        withTransaction,
        [],
      )
      const child = await row(pageC)
      expect(relationArray(child?.quotes)).toEqual([])
      expect(child?.sub_page === true || child?.sub_page === 1).toBe(false)
    })

    it('deletes a parent and its internally referenced child as one atomic batch', async () => {
      await save([
        { mode: 'create', uuid: pageA, name: 'Parent', blocks: tabs(pageB) },
        { mode: 'create', uuid: pageB, name: 'Child', blocks: [] },
      ])

      await expect(deletePagesWithRelations(
        [pageB, pageA],
        dialect.databaseType,
        withTransaction,
        [],
      )).resolves.toEqual({ affected: 2 })
      expect(await rows()).toEqual([])
    })

    it('supports AI page-batch forward references', async () => {
      const aiParent = 'ai_customer_orders'
      const aiChild = 'ai_order_detail'
      const store = createAiDslAssetSqlStore(executeSql, dialect.databaseType, undefined, async entries => {
        await save(entries.map(({ page, mode }) => ({
          mode,
          uuid: page.uuid,
          name: page.name,
          blocks: page.blocks,
          subPage: page.subPage,
          quotes: page.quotes,
          dependencies: page.dependencies,
        })))
      })

      const result = await saveAiDslAssets({
        generationResult: {
          pages: [
            {
              uuid: aiParent,
              name: 'Parent',
              blocks: tabs(aiChild),
              subPage: false,
              quotes: [],
              dependencies: [aiChild],
            },
            {
              uuid: aiChild,
              name: 'Child',
              blocks: [],
              subPage: true,
              quotes: [aiParent],
              dependencies: [],
            },
          ],
          apis: [],
        },
      }, store)

      expect(result.status).toBe('complete')
      expect(result.savedCount).toBe(2)
      expect(relationArray((await row(aiChild))?.quotes)).toEqual([aiParent])
    })

    it('rolls back the complete AI page batch when a later SQL statement fails', async () => {
      const store = createAiDslAssetSqlStore(executeSql, dialect.databaseType, undefined, async entries => {
        await save(entries.map(({ page, mode }) => ({
          mode,
          uuid: page.uuid,
          name: page.name,
          blocks: page.blocks,
          subPage: page.subPage,
          quotes: page.quotes,
          dependencies: page.dependencies,
        })))
      })

      const result = await saveAiDslAssets({
        generationResult: {
          pages: [
            {
              uuid: pageA,
              name: 'Parent',
              blocks: tabs(pageB),
              subPage: false,
              quotes: [],
              dependencies: [pageB],
            },
            {
              uuid: pageB,
              name: 'Parent',
              blocks: [],
              subPage: true,
              quotes: [pageA],
              dependencies: [],
            },
          ],
          apis: [],
        },
      }, store)

      expect(result.status).toBe('error')
      expect(result.failedCount).toBe(2)
      expect(await rows()).toEqual([])
    })
  })
}
