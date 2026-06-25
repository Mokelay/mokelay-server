import { sql } from 'drizzle-orm'
import type { BlockExecutor, SqlExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import {
  identifierSql,
  isRecord,
  requireDatabaseType,
} from 'mokelay-server-core/utils/blocks/shared'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import { readMokelayPageJson } from './readMokelayPageJson'

type LayoutBundleRow = Record<string, unknown>

function readRequiredString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('REQUEST_PARAMETER_MISSING', `${name} 必须是非空字符串。`, 400)
  }

  return value.trim()
}

function readString(value: unknown) {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  return undefined
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function normalizeBlocks(value: unknown) {
  const parsed = parseJsonValue(value)
  return Array.isArray(parsed) ? parsed : []
}

function normalizeLayoutJson(value: unknown) {
  const parsed = parseJsonValue(value)
  return isRecord(parsed) ? parsed : {}
}

function normalizeLayout(
  row: LayoutBundleRow,
  prefix: 'page_layout' | 'app_layout',
) {
  const uuid = readString(row[`${prefix}_uuid`])

  if (!uuid) {
    return null
  }

  const layoutJson = normalizeLayoutJson(row[`${prefix}_json`])
  const name = readString(row[`${prefix}_name`]) ?? readString(layoutJson.name) ?? ''
  const blocks = Array.isArray(layoutJson.blocks) ? layoutJson.blocks : []
  const schemaVersion = typeof layoutJson.schemaVersion === 'number' ? layoutJson.schemaVersion : 1

  return {
    ...layoutJson,
    schemaVersion,
    uuid,
    name,
    blocks,
    createdAt: readString(row[`${prefix}_created_at`]) ?? readString(layoutJson.createdAt),
    updatedAt: readString(row[`${prefix}_updated_at`]) ?? readString(layoutJson.updatedAt),
  }
}

function normalizePage(row: LayoutBundleRow) {
  const uuid = readString(row.page_uuid)

  if (!uuid) {
    return null
  }

  return {
    uuid,
    name: readString(row.page_name) ?? '',
    blocks: normalizeBlocks(row.page_blocks),
    appUuid: readString(row.page_app_uuid) ?? null,
    layoutUuid: readString(row.page_layout_uuid_value) ?? null,
    createdAt: readString(row.page_created_at),
    updatedAt: readString(row.page_updated_at),
  }
}

async function resolveUserPageBundle(pageUuid: string, executeSql: SqlExecutor) {
  const pagesTable = identifierSql('pages', 'table', 'BLOCK_INVALID_TABLE')
  const appsTable = identifierSql('apps', 'table', 'BLOCK_INVALID_TABLE')
  const layoutsTable = identifierSql('layouts', 'table', 'BLOCK_INVALID_TABLE')

  const pageResult = await executeSql(sql`
    SELECT
      ${identifierSql('uuid', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_uuid')},
      ${identifierSql('name', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_name')},
      ${identifierSql('blocks', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_blocks')},
      ${identifierSql('app_uuid', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_app_uuid')},
      ${identifierSql('layout_uuid', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_layout_uuid_value')},
      ${identifierSql('created_at', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_created_at')},
      ${identifierSql('updated_at', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('page_updated_at')}
    FROM ${pagesTable}
    WHERE ${identifierSql('uuid', 'fields', 'BLOCK_INVALID_FIELDS')} = ${pageUuid}
    LIMIT 1
  `)
  const row = pageResult.rows[0] ?? {}
  const page = normalizePage(row)

  if (!page) {
    return { page: null, layout: null }
  }

  const pageLayout = await readLayoutByUuid(page.layoutUuid, 'page_layout', layoutsTable, executeSql)
  if (pageLayout) {
    return { page, layout: pageLayout }
  }

  const appDefaultLayoutUuid = await readAppDefaultLayoutUuid(page.appUuid, appsTable, executeSql)
  const appLayout = await readLayoutByUuid(appDefaultLayoutUuid, 'app_layout', layoutsTable, executeSql)

  return { page, layout: appLayout }
}

async function resolveSystemPageBundle(pageUuid: string, executeSql: SqlExecutor) {
  const page = await readMokelayPageJson(pageUuid)
  const layoutsTable = identifierSql('layouts', 'table', 'BLOCK_INVALID_TABLE')
  const layoutUuid = readPageLayoutUuid(page)
  const layout = await readLayoutByUuid(layoutUuid, 'page_layout', layoutsTable, executeSql)

  return { page, layout }
}

function readPageLayoutUuid(page: unknown) {
  if (!isRecord(page)) return null
  return readString(page.layoutUuid) ?? readString(page.layout_uuid) ?? null
}

async function readAppDefaultLayoutUuid(
  appUuid: string | null,
  appsTable: ReturnType<typeof identifierSql>,
  executeSql: SqlExecutor,
) {
  if (!appUuid) return null

  const result = await executeSql(sql`
    SELECT
      ${identifierSql('default_layout_uuid', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier('app_default_layout_uuid')}
    FROM ${appsTable}
    WHERE ${identifierSql('uuid', 'fields', 'BLOCK_INVALID_FIELDS')} = ${appUuid}
    LIMIT 1
  `)

  return readString(result.rows[0]?.app_default_layout_uuid) ?? null
}

async function readLayoutByUuid(
  layoutUuid: string | null,
  prefix: 'page_layout' | 'app_layout',
  layoutsTable: ReturnType<typeof identifierSql>,
  executeSql: SqlExecutor,
) {
  if (!layoutUuid) return null

  const result = await executeSql(sql`
    SELECT
      ${identifierSql('uuid', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier(`${prefix}_uuid`)},
      ${identifierSql('name', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier(`${prefix}_name`)},
      ${identifierSql('layout_json', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier(`${prefix}_json`)},
      ${identifierSql('created_at', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier(`${prefix}_created_at`)},
      ${identifierSql('updated_at', 'fields', 'BLOCK_INVALID_FIELDS')} AS ${sql.identifier(`${prefix}_updated_at`)}
    FROM ${layoutsTable}
    WHERE ${identifierSql('uuid', 'fields', 'BLOCK_INVALID_FIELDS')} = ${layoutUuid}
    LIMIT 1
  `)

  return normalizeLayout(result.rows[0] ?? {}, prefix)
}

export const executeResolveLayoutBundleBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  requireDatabaseType(databaseType)

  const pageUuid = readRequiredString(inputs.uuid, 'uuid')
  const source = typeof inputs.source === 'string' && inputs.source.trim() ? inputs.source.trim() : 'user'

  if (source === 'system') {
    return await resolveSystemPageBundle(pageUuid, executeSql)
  }

  return await resolveUserPageBundle(pageUuid, executeSql)
}
