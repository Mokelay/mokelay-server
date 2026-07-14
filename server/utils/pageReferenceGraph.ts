export type SharedPageSource = 'user' | 'system'

export type SharedPageReference = {
  uuid: string
  source: SharedPageSource
  path: string
}

export type SharedPageGraphNode = {
  uuid: string
  source: SharedPageSource
  blocks: unknown
}

export type SharedPageRelations = {
  dependencies: string[]
  quotes: string[]
  subPage: boolean
}

export type PageReferenceGraphErrorCode =
  | 'PAGE_BLOCKS_INVALID'
  | 'PAGE_REFERENCE_AMBIGUOUS'
  | 'PAGE_REFERENCE_CYCLE'
  | 'PAGE_REFERENCE_DYNAMIC'
  | 'PAGE_REFERENCE_INVALID'
  | 'PAGE_REFERENCE_NOT_FOUND'
  | 'PAGE_REFERENCE_SELF'
  | 'PAGE_REFERENCE_SOURCE_INVALID'
  | 'PAGE_REFERENCE_SYSTEM_TO_USER'
  | 'PAGE_REFERENCE_UUID_INVALID'
  | 'PAGE_UUID_COLLISION'
  | 'PAGE_UUID_DUPLICATE'
  | 'PAGE_UUID_INVALID'

export class PageReferenceGraphError extends Error {
  readonly code: PageReferenceGraphErrorCode
  readonly details: Record<string, unknown>

  constructor(
    code: PageReferenceGraphErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(`${code}: ${message}`)
    this.name = 'PageReferenceGraphError'
    this.code = code
    this.details = details
  }
}

export const sharedUserPageUuidPattern = /^[a-z0-9_-]{1,128}$/
export const systemPageUuidPattern = /^[A-Za-z0-9_-]{1,128}$/

/** Canonical user-page identifier shared by graph, CRUD and AI save paths. */
export function normalizeUserPageUuid(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const uuid = value.trim().toLowerCase()
  return sharedUserPageUuidPattern.test(uuid) ? uuid : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pointerSegment(value: string | number) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1')
}

function childPath(path: string, value: string | number) {
  return `${path}/${pointerSegment(value)}`
}

function fail(
  code: PageReferenceGraphErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new PageReferenceGraphError(code, message, details)
}

function readReference(container: unknown, path: string): SharedPageReference {
  if (!isRecord(container)) {
    fail('PAGE_REFERENCE_INVALID', `${path} must be an object`, { path })
  }

  const hasCanonical = Object.prototype.hasOwnProperty.call(container, 'pageUUID')
  const hasLegacy = Object.prototype.hasOwnProperty.call(container, 'pageUuid')
  if (hasCanonical && hasLegacy) {
    fail('PAGE_REFERENCE_AMBIGUOUS', `${path} cannot contain both pageUUID and pageUuid`, { path })
  }

  const field = hasCanonical ? 'pageUUID' : hasLegacy ? 'pageUuid' : 'pageUUID'
  const value = container[field]
  const valuePath = childPath(path, field)
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.includes('{{')
    || value.includes('}}')
  ) {
    fail('PAGE_REFERENCE_DYNAMIC', `${valuePath} must be a non-empty literal string`, {
      path: valuePath,
      value,
    })
  }

  const rawSource = container.pageSource
  const source = rawSource === undefined ? 'user' : rawSource
  const sourcePath = childPath(path, 'pageSource')
  if (typeof source === 'string' && (source.includes('{{') || source.includes('}}'))) {
    fail('PAGE_REFERENCE_DYNAMIC', `${sourcePath} must be a literal string`, {
      path: sourcePath,
      value: rawSource,
    })
  }
  if (source !== 'user' && source !== 'system') {
    fail('PAGE_REFERENCE_SOURCE_INVALID', `${sourcePath} must be user or system`, {
      path: sourcePath,
      value: rawSource,
    })
  }

  const rawUuid = value.trim()
  const userUuid = source === 'user' ? normalizeUserPageUuid(value) : undefined
  if (source === 'user' && !userUuid) {
    fail('PAGE_REFERENCE_UUID_INVALID', `${valuePath} must be a valid user page slug`, {
      path: valuePath,
      uuid: rawUuid,
    })
  }
  if (source === 'system' && !systemPageUuidPattern.test(rawUuid)) {
    fail('PAGE_REFERENCE_UUID_INVALID', `${valuePath} must be a valid system page slug`, {
      path: valuePath,
      uuid: rawUuid,
    })
  }

  return {
    uuid: source === 'user' ? userUuid! : rawUuid,
    source,
    path: valuePath,
  }
}

/**
 * Extract all direct embedded-page references from arbitrary nested page DSL.
 * Navigation actions (including every jump_url variant) are intentionally ignored.
 */
export function extractEmbeddedPageReferences(
  blocks: unknown,
  rootPath = '/blocks',
): SharedPageReference[] {
  const references: SharedPageReference[] = []
  const visited = new Set<object>()

  const visit = (value: unknown, path: string) => {
    if (typeof value !== 'object' || value === null || visited.has(value)) return
    visited.add(value)

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, childPath(path, index)))
      return
    }

    const record = value as Record<string, unknown>
    if (record.type === 'MTabs') {
      const tabsPath = childPath(childPath(path, 'data'), 'tabs')
      if (!isRecord(record.data) || !Array.isArray(record.data.tabs)) {
        fail('PAGE_REFERENCE_INVALID', `${tabsPath} must be an array`, { path: tabsPath })
      }
      for (let index = 0; index < record.data.tabs.length; index += 1) {
        references.push(readReference(record.data.tabs[index], childPath(tabsPath, index)))
      }
    }

    if (record.action === 'open_dialog') {
      references.push(readReference(record.inputs, childPath(path, 'inputs')))
    }

    for (const [key, child] of Object.entries(record)) {
      visit(child, childPath(path, key))
    }
  }

  visit(blocks, rootPath)
  return references
}

export function pageReferenceNodeKey(source: SharedPageSource, uuid: string) {
  return `${source}:${source === 'user' ? uuid.trim().toLowerCase() : uuid}`
}

function crossSourceUuidKey(uuid: string) {
  return uuid.toLowerCase()
}

function canonicalNodeUuid(node: SharedPageGraphNode) {
  if (node.source !== 'user' && node.source !== 'system') {
    fail('PAGE_REFERENCE_SOURCE_INVALID', 'Page source must be user or system', {
      uuid: node.uuid,
      value: node.source,
    })
  }
  if (typeof node.uuid !== 'string' || !node.uuid.trim()) {
    fail('PAGE_UUID_INVALID', 'Page UUID must be a non-empty string', { uuid: node.uuid })
  }

  const rawUuid = node.uuid.trim()
  const userUuid = node.source === 'user' ? normalizeUserPageUuid(node.uuid) : undefined
  if (node.source === 'user' && !userUuid) {
    fail('PAGE_UUID_INVALID', 'User page UUID must be a valid slug', { uuid: rawUuid })
  }
  if (node.source === 'system' && !systemPageUuidPattern.test(rawUuid)) {
    fail('PAGE_UUID_INVALID', 'System page UUID must be a valid slug', { uuid: rawUuid })
  }
  return node.source === 'user' ? userUuid! : rawUuid
}

function findCycle(adjacency: Map<string, string[]>) {
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []

  const visit = (node: string): string[] | undefined => {
    state.set(node, 1)
    stack.push(node)
    for (const target of adjacency.get(node) ?? []) {
      const targetState = state.get(target) ?? 0
      if (targetState === 0) {
        const cycle = visit(target)
        if (cycle) return cycle
      }
      else if (targetState === 1) {
        const start = stack.indexOf(target)
        return [...stack.slice(start), target]
      }
    }
    stack.pop()
    state.set(node, 2)
    return undefined
  }

  for (const node of [...adjacency.keys()].sort()) {
    if ((state.get(node) ?? 0) === 0) {
      const cycle = visit(node)
      if (cycle) return cycle
    }
  }
  return undefined
}

function uuidFromNodeKey(key: string) {
  return key.slice(key.indexOf(':') + 1)
}

/**
 * Validate the complete page graph and derive canonical direct dependencies,
 * reverse quotes and subPage for every user/system node.
 */
export function deriveCanonicalPageGraph(
  nodes: SharedPageGraphNode[],
): Map<string, SharedPageRelations> {
  const nodesByKey = new Map<string, SharedPageGraphNode>()
  const sourceByUuid = new Map<string, SharedPageSource>()

  for (const inputNode of nodes) {
    const uuid = canonicalNodeUuid(inputNode)
    if (!Array.isArray(inputNode.blocks)) {
      fail('PAGE_BLOCKS_INVALID', 'Page blocks must be an array', {
        pageUuid: uuid,
        path: '/blocks',
      })
    }
    const node = { ...inputNode, uuid, blocks: inputNode.blocks }
    const key = pageReferenceNodeKey(node.source, uuid)
    if (nodesByKey.has(key)) {
      fail('PAGE_UUID_DUPLICATE', `Duplicate page ${key}`, { uuid, source: node.source })
    }
    const sourceUuidKey = crossSourceUuidKey(uuid)
    const existingSource = sourceByUuid.get(sourceUuidKey)
    if (existingSource && existingSource !== node.source) {
      fail('PAGE_UUID_COLLISION', `Page UUID ${uuid} exists in both sources`, {
        uuid,
        sources: ['system', 'user'],
        conflictSource: 'system',
      })
    }
    nodesByKey.set(key, node)
    sourceByUuid.set(sourceUuidKey, node.source)
  }

  const adjacency = new Map<string, string[]>()
  const dependencyUuids = new Map<string, string[]>()
  const quotes = new Map<string, Set<string>>()

  for (const [key, node] of nodesByKey) {
    let references: SharedPageReference[]
    try {
      references = extractEmbeddedPageReferences(node.blocks)
    }
    catch (error) {
      if (!(error instanceof PageReferenceGraphError)) throw error
      throw new PageReferenceGraphError(error.code, error.message.replace(/^[A-Z_]+:\s*/, ''), {
        ...error.details,
        pageUuid: node.uuid,
        pageSource: node.source,
      })
    }
    const targetsByKey = new Map<string, SharedPageReference>()
    for (const reference of references) {
      if (node.source === 'system' && reference.source === 'user') {
        fail('PAGE_REFERENCE_SYSTEM_TO_USER', 'System pages cannot reference user pages', {
          pageUuid: node.uuid,
          path: reference.path,
          targetUuid: reference.uuid,
          targetSource: reference.source,
        })
      }

      const targetKey = pageReferenceNodeKey(reference.source, reference.uuid)
      if (targetKey === key) {
        fail('PAGE_REFERENCE_SELF', `Page ${node.uuid} cannot reference itself`, {
          pageUuid: node.uuid,
          path: reference.path,
          targetUuid: reference.uuid,
        })
      }
      if (!nodesByKey.has(targetKey)) {
        fail('PAGE_REFERENCE_NOT_FOUND', `Referenced page ${reference.uuid} does not exist`, {
          pageUuid: node.uuid,
          path: reference.path,
          targetUuid: reference.uuid,
          targetSource: reference.source,
        })
      }
      if (!targetsByKey.has(targetKey)) targetsByKey.set(targetKey, reference)
    }

    const targetKeys = [...targetsByKey.keys()].sort()
    adjacency.set(key, targetKeys)
    dependencyUuids.set(key, [...targetsByKey.values()].map(reference => reference.uuid).sort())
    for (const targetKey of targetKeys) {
      const targetQuotes = quotes.get(targetKey) ?? new Set<string>()
      targetQuotes.add(node.uuid)
      quotes.set(targetKey, targetQuotes)
    }
  }

  const cycle = findCycle(adjacency)
  if (cycle) {
    fail('PAGE_REFERENCE_CYCLE', 'Page references cannot form a cycle', {
      cycle: cycle.map(uuidFromNodeKey),
    })
  }

  const graph = new Map<string, SharedPageRelations>()
  for (const key of nodesByKey.keys()) {
    const parentUuids = [...(quotes.get(key) ?? [])].sort()
    graph.set(key, {
      dependencies: dependencyUuids.get(key) ?? [],
      quotes: parentUuids,
      subPage: parentUuids.length > 0,
    })
  }
  return graph
}
