import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import {
  deriveCanonicalPageGraph,
  extractEmbeddedPageReferences,
  PageReferenceGraphError,
  normalizeUserPageUuid,
  pageReferenceNodeKey,
  sharedUserPageUuidPattern,
  type SharedPageReference,
  type SharedPageSource,
} from './pageReferenceGraph'

export type PageSource = SharedPageSource

export type PageReference = SharedPageReference

export type PageGraphNode = {
  uuid: string
  source: PageSource
  blocks: unknown[]
}

export type CanonicalPageRelations = {
  dependencies: string[]
  quotes: string[]
  subPage: boolean
}

export type CanonicalPageGraph = Map<string, CanonicalPageRelations>

export const userPageUuidPattern = sharedUserPageUuidPattern

export function requireUserPageUuid(value: unknown, statusCode = 400) {
  const uuid = normalizeUserPageUuid(value)
  if (!uuid) {
    throw mokelayError(
      'BLOCK_PAGE_UUID_INVALID',
      '用户页面 uuid 必须是 1 到 128 位小写 Slug，只能包含字母、数字、下划线或连字符。',
      statusCode,
      undefined,
      { uuid: value },
    )
  }
  return uuid
}

function throwRuntimeGraphError(error: unknown): never {
  if (!(error instanceof PageReferenceGraphError)) throw error

  const mappings = {
    PAGE_BLOCKS_INVALID: ['API_JSON_INVALID_SCHEMA', '页面 blocks 必须是数组。', 400],
    PAGE_REFERENCE_AMBIGUOUS: ['BLOCK_PAGE_REFERENCE_DYNAMIC', '不能同时设置 pageUUID 与旧版 pageUuid。', 400],
    PAGE_REFERENCE_CYCLE: ['BLOCK_PAGE_REFERENCE_CYCLE', '页面引用不能形成环。', 409],
    PAGE_REFERENCE_DYNAMIC: ['BLOCK_PAGE_REFERENCE_DYNAMIC', '子页面引用必须使用固定的非空 pageUUID。', 400],
    PAGE_REFERENCE_INVALID: ['BLOCK_PAGE_REFERENCE_DYNAMIC', '子页面容器配置无效。', 400],
    PAGE_REFERENCE_NOT_FOUND: ['BLOCK_PAGE_REFERENCE_NOT_FOUND', '引用的页面不存在。', 400],
    PAGE_REFERENCE_SELF: ['BLOCK_PAGE_REFERENCE_SELF', '页面不能引用自身。', 409],
    PAGE_REFERENCE_SOURCE_INVALID: ['BLOCK_PAGE_REFERENCE_SOURCE_INVALID', 'pageSource 仅支持 user 或 system。', 400],
    PAGE_REFERENCE_SYSTEM_TO_USER: ['BLOCK_PAGE_REFERENCE_SOURCE_INVALID', '系统页面只能引用系统页面。', 400],
    PAGE_REFERENCE_UUID_INVALID: ['BLOCK_PAGE_UUID_INVALID', '页面引用 UUID 无效。', 400],
    PAGE_UUID_COLLISION: ['BLOCK_DUPLICATE_RECORD', '用户页面 UUID 与系统页面 UUID 重复。', 409],
    PAGE_UUID_DUPLICATE: ['BLOCK_DUPLICATE_RECORD', '页面 UUID 重复。', 409],
    PAGE_UUID_INVALID: ['BLOCK_PAGE_UUID_INVALID', '页面 UUID 无效。', 400],
  } as const
  const [code, message, statusCode] = mappings[error.code]
  throw mokelayError(code, message, statusCode, undefined, error.details)
}

/** Runtime adapter for the shared page-reference extractor. */
export function extractPageReferences(blocks: unknown): PageReference[] {
  try {
    const references = extractEmbeddedPageReferences(blocks)
    const unique = new Map<string, PageReference>()
    for (const reference of references) {
      const key = pageReferenceNodeKey(reference.source, reference.uuid)
      if (!unique.has(key)) unique.set(key, reference)
    }
    return [...unique.values()].sort((left, right) => (
      left.uuid.localeCompare(right.uuid) || left.source.localeCompare(right.source)
    ))
  }
  catch (error) {
    throwRuntimeGraphError(error)
  }
}

export function pageNodeKey(source: PageSource, uuid: string) {
  return pageReferenceNodeKey(source, uuid)
}

/** Runtime error adapter for the shared complete-graph validator/deriver. */
export function buildCanonicalPageGraph(nodes: PageGraphNode[]): CanonicalPageGraph {
  try {
    return deriveCanonicalPageGraph(nodes)
  }
  catch (error) {
    throwRuntimeGraphError(error)
  }
}

export function parseStringArray(value: unknown) {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  return [...new Set(parsed.filter((item): item is string => typeof item === 'string'))].sort()
}

export function sameStringArray(left: unknown, right: string[]) {
  const normalized = parseStringArray(left)
  return normalized.length === right.length && normalized.every((item, index) => item === right[index])
}

/** Exact persisted representation check used by audits; reads stay backwards-compatible. */
export function strictStoredStringArrayEquals(value: unknown, canonical: string[]) {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown
    }
    catch {
      return false
    }
  }
  if (
    !Array.isArray(parsed)
    || parsed.some(item => typeof item !== 'string' || !item.trim())
    || new Set(parsed).size !== parsed.length
    || parsed.length !== canonical.length
  ) return false
  return parsed.every((item, index) => item === canonical[index])
}
