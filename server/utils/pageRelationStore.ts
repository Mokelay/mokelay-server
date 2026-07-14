import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { DatabaseType } from 'mokelay-server-core/utils/db'
import type { TransactionRunner } from 'mokelay-server-core/utils/db'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import type { SqlExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { isDuplicateRecordError } from 'mokelay-server-core/utils/blocks/shared'
import { listMokelayPageJsons } from './blocks/listMokelayPageJsons'
import {
  buildCanonicalPageGraph,
  extractPageReferences,
  pageNodeKey,
  parseStringArray,
  requireUserPageUuid,
  sameStringArray,
  strictStoredStringArrayEquals,
  type CanonicalPageGraph,
  type PageGraphNode,
} from './pageRelations'

type RawPageRow = Record<string, unknown>
const pageSelectFields = sql.join([
  'uuid', 'name', 'blocks', 'app_uuid', 'layout_uuid',
  'sub_page', 'quotes', 'dependencies', 'created_at', 'updated_at',
].map(field => sql.identifier(field)), sql`, `)

export type PageSaveInput = {
  mode: 'create' | 'update'
  uuid?: unknown
  name: unknown
  blocks: unknown
  dependencies?: unknown
  quotes?: unknown
  subPage?: unknown
}

export type NormalizedPage = {
  uuid: string
  name: string
  blocks: unknown[]
  appUuid: string | null
  layoutUuid: string | null
  subPage: boolean
  quotes: string[]
  dependencies: string[]
  createdAt?: string
  updatedAt?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  return undefined
}

function parseJson(value: unknown) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function parseBlocks(value: unknown, pageUuid = 'unknown') {
  const parsed = parseJson(value)
  if (!Array.isArray(parsed)) {
    throw mokelayError(
      'API_JSON_INVALID_SCHEMA',
      `数据库页面 ${pageUuid} 的 blocks 必须是合法 JSON 数组。`,
      500,
      undefined,
      { pageUuid },
    )
  }
  return parsed
}

function readBoolean(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function currentSqlTimestamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '+00:00')
}

export function normalizeUserPage(row: RawPageRow): NormalizedPage {
  const uuid = requireUserPageUuid(row.uuid, 500)
  return {
    uuid,
    name: readString(row.name) ?? '',
    blocks: parseBlocks(row.blocks, uuid),
    appUuid: readString(row.app_uuid) ?? null,
    layoutUuid: readString(row.layout_uuid) ?? null,
    subPage: readBoolean(row.sub_page),
    quotes: parseStringArray(row.quotes),
    dependencies: parseStringArray(row.dependencies),
    createdAt: readString(row.created_at),
    updatedAt: readString(row.updated_at),
  }
}

function systemNode(value: unknown): PageGraphNode {
  if (!isRecord(value) || typeof value.uuid !== 'string' || !Array.isArray(value.blocks)) {
    throw mokelayError('API_JSON_INVALID_SCHEMA', '系统页面资产结构无效。', 500)
  }
  return { source: 'system', uuid: value.uuid, blocks: value.blocks }
}

export async function loadSystemPageNodes() {
  const result = await listMokelayPageJsons()
  return result.pages.map(systemNode)
}

export async function readAllUserPageRows(executeSql: SqlExecutor) {
  const result = await executeSql(sql`
    SELECT ${pageSelectFields}
    FROM ${sql.identifier('pages')}
  `)
  return result.rows
}

function userNodes(rows: RawPageRow[]): PageGraphNode[] {
  return rows.map(row => {
    const rawUuid = readString(row.uuid)
    const uuid = requireUserPageUuid(rawUuid, 500)
    return {
      source: 'user' as const,
      uuid,
      blocks: parseBlocks(row.blocks, rawUuid),
    }
  })
}

export function buildGraphForRows(rows: RawPageRow[], systemNodes: PageGraphNode[]) {
  return buildCanonicalPageGraph([...systemNodes, ...userNodes(rows)])
}

function jsonSql(value: unknown, databaseType: DatabaseType) {
  const serialized = JSON.stringify(value)
  return databaseType === 'postgres' ? sql`${serialized}::jsonb` : sql`${serialized}`
}

async function readGraphVersion(executeSql: SqlExecutor, lock: boolean) {
  const result = lock
    ? await executeSql(sql`
        SELECT id, version FROM ${sql.identifier('page_reference_graph_state')}
        WHERE id = ${1}
        FOR UPDATE
      `)
    : await executeSql(sql`
        SELECT id, version FROM ${sql.identifier('page_reference_graph_state')}
        WHERE id = ${1}
      `)
  return result.rows[0] ? Number(result.rows[0].version) : Number.NaN
}

async function lockGraph(executeSql: SqlExecutor, requireReady = true) {
  const version = await readGraphVersion(executeSql, true)
  if (!Number.isFinite(version) || (requireReady && version !== 1)) {
    throw mokelayError(
      'BLOCK_PAGE_GRAPH_NOT_READY',
      '页面关系图尚未完成回填，写入暂不可用。',
      503,
      undefined,
      { version: Number.isFinite(version) ? version : null },
    )
  }
  return version
}

async function bumpGraphRevision(executeSql: SqlExecutor) {
  await executeSql(sql`
    UPDATE ${sql.identifier('page_reference_graph_state')}
    SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${1}
  `)
}

function assertPageInput(name: unknown, blocks: unknown) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
    throw mokelayError('REQUEST_INVALID_BODY', '页面 name 必须是 1 到 120 个字符。', 400)
  }
  if (!Array.isArray(blocks)) {
    throw mokelayError('REQUEST_INVALID_BODY', '页面 blocks 必须是数组。', 400)
  }
  return { name: name.trim(), blocks }
}

function assertRelationAssertions(input: PageSaveInput, graph: CanonicalPageGraph, uuid: string) {
  const relations = graph.get(pageNodeKey('user', uuid))!
  const mismatches: Record<string, unknown> = {}
  const strictArray = (value: unknown, field: 'dependencies' | 'quotes') => {
    if (
      !Array.isArray(value)
      || value.some(item => typeof item !== 'string' || !item.trim())
      || new Set(value).size !== value.length
    ) {
      mismatches[field] = {
        expected: relations[field],
        received: value,
        reason: 'must be an array of unique non-empty strings',
      }
      return undefined
    }
    return [...value].sort()
  }

  if (input.dependencies !== undefined) {
    const received = strictArray(input.dependencies, 'dependencies')
    if (received && !sameStringArray(received, relations.dependencies)) {
      mismatches.dependencies = { expected: relations.dependencies, received: input.dependencies }
    }
  }
  if (input.quotes !== undefined) {
    const received = strictArray(input.quotes, 'quotes')
    if (received && !sameStringArray(received, relations.quotes)) {
      mismatches.quotes = { expected: relations.quotes, received: input.quotes }
    }
  }
  if (input.subPage !== undefined && (typeof input.subPage !== 'boolean' || input.subPage !== relations.subPage)) {
    mismatches.subPage = { expected: relations.subPage, received: input.subPage }
  }
  if (Object.keys(mismatches).length) {
    throw mokelayError(
      'BLOCK_PAGE_REFERENCE_ASSERTION_MISMATCH',
      '请求中的页面关系字段与服务端计算结果不一致。',
      409,
      undefined,
      { pageUuid: uuid, mismatches },
    )
  }
}

async function persistRelations(
  executeSql: SqlExecutor,
  databaseType: DatabaseType,
  rows: RawPageRow[],
  graph: CanonicalPageGraph,
) {
  for (const row of rows) {
    const rawUuid = readString(row.uuid)
    if (!rawUuid) continue
    const uuid = rawUuid.toLowerCase()
    const relations = graph.get(pageNodeKey('user', uuid))
    if (!relations) continue
    if (databaseType === 'mysql') {
      await executeSql(sql`
        UPDATE ${sql.identifier('pages')}
        SET
          ${sql.identifier('sub_page')} = ${relations.subPage},
          ${sql.identifier('quotes')} = ${jsonSql(relations.quotes, databaseType)},
          ${sql.identifier('dependencies')} = ${jsonSql(relations.dependencies, databaseType)},
          ${sql.identifier('updated_at')} = ${sql.identifier('updated_at')}
        WHERE ${sql.identifier('uuid')} = ${rawUuid}
      `)
    } else {
      await executeSql(sql`
        UPDATE ${sql.identifier('pages')}
        SET
          ${sql.identifier('sub_page')} = ${relations.subPage},
          ${sql.identifier('quotes')} = ${jsonSql(relations.quotes, databaseType)},
          ${sql.identifier('dependencies')} = ${jsonSql(relations.dependencies, databaseType)}
        WHERE ${sql.identifier('uuid')} = ${rawUuid}
      `)
    }
  }
}

async function readUserPage(uuid: string, executeSql: SqlExecutor) {
  const result = await executeSql(sql`
    SELECT ${pageSelectFields}
    FROM ${sql.identifier('pages')}
    WHERE ${sql.identifier('uuid')} = ${uuid}
    LIMIT 1
  `)
  return result.rows[0] ? normalizeUserPage(result.rows[0]) : null
}

export async function savePageWithRelations(
  input: PageSaveInput,
  databaseType: DatabaseType,
  withTransaction: TransactionRunner,
  providedSystemNodes?: PageGraphNode[],
) {
  const result = await savePageBatchWithRelations(
    [input],
    databaseType,
    withTransaction,
    providedSystemNodes,
  )
  return { affected: result.affected, page: result.pages[0] ?? null }
}

export async function savePageBatchWithRelations(
  inputs: PageSaveInput[],
  databaseType: DatabaseType,
  withTransaction: TransactionRunner,
  providedSystemNodes?: PageGraphNode[],
) {
  if (inputs.length === 0) return { affected: 0, pages: [] as NormalizedPage[] }
  const systemNodes = providedSystemNodes ?? await loadSystemPageNodes()
  const candidates = inputs.map(input => {
    const normalized = assertPageInput(input.name, input.blocks)
    const uuid = input.mode === 'create' && input.uuid === undefined
      ? randomUUID()
      : requireUserPageUuid(input.uuid)
    return { input, uuid, ...normalized }
  })
  if (new Set(candidates.map(candidate => candidate.uuid)).size !== candidates.length) {
    throw mokelayError(
      'BLOCK_DUPLICATE_RECORD',
      '同一页面批次不能包含重复 UUID。',
      409,
      undefined,
      { uuids: candidates.map(candidate => candidate.uuid), conflictSource: 'user' },
    )
  }

  try {
    return await withTransaction(async (executeSql) => {
      await lockGraph(executeSql)
      const rows = await readAllUserPageRows(executeSql)
      const finalRows = [...rows]

      for (const candidate of candidates) {
        const existingIndex = finalRows.findIndex(row => (
          requireUserPageUuid(readString(row.uuid), 500) === candidate.uuid
        ))
        if (candidate.input.mode === 'create' && existingIndex >= 0) {
          throw mokelayError(
            'BLOCK_DUPLICATE_RECORD',
            `页面 ${candidate.uuid} 已存在。`,
            409,
            undefined,
            { uuid: candidate.uuid, conflictSource: 'user' },
          )
        }
        if (candidate.input.mode === 'update' && existingIndex < 0) {
          throw mokelayError(
            'BLOCK_PAGE_NOT_FOUND',
            `页面 ${candidate.uuid} 不存在。`,
            404,
            undefined,
            { pageUuid: candidate.uuid },
          )
        }
        const candidateRow: RawPageRow = existingIndex >= 0
          ? { ...finalRows[existingIndex], uuid: candidate.uuid, name: candidate.name, blocks: candidate.blocks }
          : { uuid: candidate.uuid, name: candidate.name, blocks: candidate.blocks }
        if (existingIndex >= 0) finalRows[existingIndex] = candidateRow
        else finalRows.push(candidateRow)
      }

      // Validate after every candidate is present so AI batches may reference a
      // page declared later in the same generation response.
      const graph = buildGraphForRows(finalRows, systemNodes)
      for (const candidate of candidates) {
        assertRelationAssertions(candidate.input, graph, candidate.uuid)
      }

      for (const candidate of candidates) {
        const relations = graph.get(pageNodeKey('user', candidate.uuid))!
        if (candidate.input.mode === 'create') {
          await executeSql(sql`
            INSERT INTO ${sql.identifier('pages')}
              (${sql.identifier('uuid')}, ${sql.identifier('name')}, ${sql.identifier('blocks')}, ${sql.identifier('sub_page')}, ${sql.identifier('quotes')}, ${sql.identifier('dependencies')})
            VALUES (
              ${candidate.uuid},
              ${candidate.name},
              ${jsonSql(candidate.blocks, databaseType)},
              ${relations.subPage},
              ${jsonSql(relations.quotes, databaseType)},
              ${jsonSql(relations.dependencies, databaseType)}
            )
          `)
        } else {
          await executeSql(sql`
            UPDATE ${sql.identifier('pages')}
            SET
              ${sql.identifier('name')} = ${candidate.name},
              ${sql.identifier('blocks')} = ${jsonSql(candidate.blocks, databaseType)},
              ${sql.identifier('updated_at')} = ${currentSqlTimestamp()}
            WHERE ${sql.identifier('uuid')} = ${candidate.uuid}
          `)
        }
      }

      await persistRelations(executeSql, databaseType, finalRows, graph)
      await bumpGraphRevision(executeSql)
      const pages = await Promise.all(candidates.map(candidate => readUserPage(candidate.uuid, executeSql)))
      return {
        affected: candidates.length,
        pages: pages.filter((page): page is NormalizedPage => page !== null),
      }
    }, { isolationLevel: 'serializable', retries: 2 })
  }
  catch (error) {
    if (isDuplicateRecordError(error)) {
      throw mokelayError(
        'BLOCK_DUPLICATE_RECORD',
        '页面 UUID 已存在。',
        409,
        error,
        { uuids: candidates.map(candidate => candidate.uuid), conflictSource: 'user' },
      )
    }
    throw error
  }
}

export async function deletePagesWithRelations(
  rawUuids: unknown,
  databaseType: DatabaseType,
  withTransaction: TransactionRunner,
  providedSystemNodes?: PageGraphNode[],
) {
  const systemNodes = providedSystemNodes ?? await loadSystemPageNodes()
  if (!Array.isArray(rawUuids) || rawUuids.length === 0) {
    throw mokelayError('REQUEST_INVALID_BODY', 'uuids 必须是非空数组。', 400)
  }
  const uuids = [...new Set(rawUuids.map(uuid => requireUserPageUuid(uuid)))]
  return await withTransaction(async (executeSql) => {
    await lockGraph(executeSql)
    const rows = await readAllUserPageRows(executeSql)
    const existing = new Set(rows.map(row => requireUserPageUuid(readString(row.uuid), 500)))
    const actualSelected = new Set(uuids.filter(uuid => existing.has(uuid)))
    const missing = uuids.filter(uuid => !actualSelected.has(uuid))
    if (missing.length) {
      throw mokelayError(
        'BLOCK_PAGE_NOT_FOUND',
        '部分待删除页面不存在。',
        404,
        undefined,
        { pageUuids: missing },
      )
    }
    const externalParents = new Map<string, Set<string>>()

    for (const row of rows) {
      const parentUuid = requireUserPageUuid(readString(row.uuid), 500)
      if (actualSelected.has(parentUuid)) continue
      for (const reference of extractPageReferences(parseBlocks(row.blocks, parentUuid))) {
        if (reference.source === 'user' && actualSelected.has(reference.uuid)) {
          const parents = externalParents.get(reference.uuid) ?? new Set<string>()
          parents.add(parentUuid)
          externalParents.set(reference.uuid, parents)
        }
      }
    }

    if (externalParents.size) {
      const details = [...externalParents].map(([pageUuid, parents]) => ({
        pageUuid,
        quotes: [...parents].sort(),
      }))
      throw mokelayError(
        'BLOCK_PAGE_DELETE_REFERENCED',
        '页面仍被批次外的页面引用，不能删除。',
        409,
        undefined,
        { pages: details },
      )
    }

    const survivingRows = rows.filter(row => {
      const uuid = requireUserPageUuid(readString(row.uuid), 500)
      return !actualSelected.has(uuid)
    })
    const graph = buildGraphForRows(survivingRows, systemNodes)

    if (actualSelected.size) {
      await executeSql(sql`
        DELETE FROM ${sql.identifier('pages')}
        WHERE ${sql.identifier('uuid')} IN (${sql.join([...actualSelected].map(uuid => sql`${uuid}`), sql`, `)})
      `)
    }
    await persistRelations(executeSql, databaseType, survivingRows, graph)
    await bumpGraphRevision(executeSql)
    return { affected: actualSelected.size }
  }, { isolationLevel: 'serializable', retries: 2 })
}

export async function canonicalGraphForRead(executeSql: SqlExecutor, providedSystemNodes?: PageGraphNode[]) {
  const systemNodes = providedSystemNodes ?? await loadSystemPageNodes()
  const rows = await readAllUserPageRows(executeSql)
  return buildGraphForRows(rows, systemNodes)
}

export type PageRelationAuditChange = {
  uuid: string
  uuidAfter: string
  subPage: boolean
  quotes: string[]
  dependencies: string[]
  changedFields: string[]
}

function auditRows(rows: RawPageRow[], graph: CanonicalPageGraph) {
  const changes: PageRelationAuditChange[] = []
  for (const row of rows) {
    const rawUuid = readString(row.uuid) ?? ''
    const uuid = requireUserPageUuid(rawUuid, 500)
    const relations = graph.get(pageNodeKey('user', uuid))
    if (!relations) continue
    const changedFields: string[] = []
    if (rawUuid !== uuid) changedFields.push('uuid')
    if (readBoolean(row.sub_page) !== relations.subPage) changedFields.push('subPage')
    if (!strictStoredStringArrayEquals(row.quotes, relations.quotes)) changedFields.push('quotes')
    if (!strictStoredStringArrayEquals(row.dependencies, relations.dependencies)) changedFields.push('dependencies')
    if (changedFields.length) {
      changes.push({ uuid: rawUuid, uuidAfter: uuid, ...relations, changedFields })
    }
  }
  return changes
}

export async function auditPageRelations(
  executeSql: SqlExecutor,
  providedSystemNodes?: PageGraphNode[],
) {
  const systemNodes = providedSystemNodes ?? await loadSystemPageNodes()
  const graphVersion = await readGraphVersion(executeSql, false)
  if (!Number.isFinite(graphVersion)) {
    throw mokelayError('BLOCK_PAGE_GRAPH_NOT_READY', '页面关系图状态未初始化。', 503)
  }
  const rows = await readAllUserPageRows(executeSql)
  const graph = buildGraphForRows(rows, systemNodes)
  const changes = auditRows(rows, graph)
  return { graphVersion, ready: graphVersion === 1, pageCount: rows.length, changedCount: changes.length, changes }
}

/** Rebuilds every stored direct/reverse edge and atomically promotes graph version 1. */
export async function rebuildPageRelations(
  databaseType: DatabaseType,
  withTransaction: TransactionRunner,
  providedSystemNodes?: PageGraphNode[],
) {
  const systemNodes = providedSystemNodes ?? await loadSystemPageNodes()
  return await withTransaction(async (executeSql) => {
    const previousVersion = await lockGraph(executeSql, false)
    const rows = await readAllUserPageRows(executeSql)
    const graph = buildGraphForRows(rows, systemNodes)
    const changes = auditRows(rows, graph)

    const nonCanonicalUuids = changes
      .filter(change => change.changedFields.includes('uuid'))
      .map(change => ({ uuid: change.uuid, normalizedUuid: change.uuidAfter }))
    if (nonCanonicalUuids.length) {
      throw mokelayError(
        'BLOCK_PAGE_UUID_INVALID',
        '存量页面标识不是规范化小写 Slug；关系回填不会自动重命名页面。',
        409,
        undefined,
        { pages: nonCanonicalUuids },
      )
    }

    await persistRelations(executeSql, databaseType, rows, graph)
    await executeSql(sql`
      UPDATE ${sql.identifier('page_reference_graph_state')}
      SET version = ${1}, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${1}
    `)

    return {
      previousVersion,
      version: 1,
      pageCount: rows.length,
      changedCount: changes.length,
      changes,
    }
  }, { isolationLevel: 'serializable', retries: 2 })
}

export async function mergeSystemPageRelations<T extends Record<string, unknown>>(
  pages: T[],
  executeSql: SqlExecutor,
) {
  const systemNodes = pages.map(systemNode)
  // list/read callers can provide a subset, so validation needs every system page.
  const allSystemNodes = systemNodes.length === (await listMokelayPageJsons()).count
    ? systemNodes
    : await loadSystemPageNodes()
  const graph = await canonicalGraphForRead(executeSql, allSystemNodes)
  return pages.map(page => {
    const uuid = readString(page.uuid) ?? ''
    const relations = graph.get(pageNodeKey('system', uuid))
    return relations ? { ...page, ...relations } : page
  })
}
