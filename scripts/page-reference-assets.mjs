import { readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  deriveCanonicalPageGraph,
  extractEmbeddedPageReferences as extractSharedPageReferences,
  PageReferenceGraphError,
  pageReferenceNodeKey,
  systemPageUuidPattern,
} from '../server/utils/pageReferenceGraph.ts'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_PAGE_ASSETS_DIR = path.resolve(SCRIPT_DIR, '../server/assets/mokelay-pages')

const RELATION_FIELDS = ['subPage', 'quotes', 'dependencies']

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function relationError(code, message, details = {}) {
  return Object.assign(new Error(`${code}: ${message}`), { code, details })
}

function assetGraphError(error) {
  if (!(error instanceof PageReferenceGraphError)) throw error
  const mappings = {
    PAGE_BLOCKS_INVALID: 'PAGE_REFERENCE_INVALID',
    PAGE_REFERENCE_SYSTEM_TO_USER: 'PAGE_ASSET_USER_DEPENDENCY_UNSUPPORTED',
    PAGE_REFERENCE_UUID_INVALID: 'PAGE_REFERENCE_INVALID',
    PAGE_UUID_COLLISION: 'PAGE_ASSET_UUID_DUPLICATE',
    PAGE_UUID_DUPLICATE: 'PAGE_ASSET_UUID_DUPLICATE',
    PAGE_UUID_INVALID: 'PAGE_ASSET_UUID_INVALID',
  }
  const code = mappings[error.code] ?? error.code
  throw relationError(code, error.message.replace(/^[A-Z_]+:\s*/, ''), error.details)
}

/**
 * Extract direct embedded-page references from arbitrary nested page blocks.
 * Navigation actions such as jump_url are intentionally ignored.
 */
export function extractEmbeddedPageReferences(value) {
  try {
    return extractSharedPageReferences(value, '').map(reference => ({
      uuid: reference.uuid,
      pageSource: reference.source,
      location: reference.path,
    }))
  }
  catch (error) {
    assetGraphError(error)
  }
}

function renderPageAsset(source, relation) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const scalarRelationLine = /^  "subPage":\s*(?:true|false),(?:\r?\n|$)/gm
  const arrayRelationField = new RegExp(
    `^  "(?:${RELATION_FIELDS.filter(field => field !== 'subPage').join('|')})":\\s*\\[[^\\]]*\\],(?:\\r?\\n|$)`,
    'gm',
  )
  const withoutRelations = source
    .replace(scalarRelationLine, '')
    .replace(arrayRelationField, '')
  const uuidLine = /^(  "uuid":\s*"[^"]+",\r?\n)/m
  if (!uuidLine.test(withoutRelations)) {
    throw relationError('PAGE_ASSET_UUID_LINE_INVALID', 'Expected a top-level two-space-indented uuid field')
  }

  const fields = [
    `  "subPage": ${relation.subPage},`,
    `  "quotes": ${JSON.stringify(relation.quotes)},`,
    `  "dependencies": ${JSON.stringify(relation.dependencies)},`,
  ].join(newline)

  return withoutRelations.replace(uuidLine, `$1${fields}${newline}`)
}

export async function analyzeSystemPageAssets(directory = DEFAULT_PAGE_ASSETS_DIR) {
  const fileNames = (await readdir(directory))
    .filter(fileName => fileName.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))

  const assets = []
  const byUuid = new Map()
  for (const fileName of fileNames) {
    const filePath = path.join(directory, fileName)
    const source = await readFile(filePath, 'utf8')
    let page
    try {
      page = JSON.parse(source)
    }
    catch (error) {
      throw relationError('PAGE_ASSET_INVALID_JSON', `${fileName} is not valid JSON`, { fileName, cause: error })
    }

    if (!isRecord(page) || typeof page.uuid !== 'string' || !systemPageUuidPattern.test(page.uuid)) {
      throw relationError('PAGE_ASSET_UUID_INVALID', `${fileName} has an invalid system page UUID`, { fileName })
    }
    if (typeof page.name !== 'string' || !page.name.trim() || page.name.trim().length > 120) {
      throw relationError('PAGE_ASSET_NAME_INVALID', `${fileName} must have a 1 to 120 character name`, {
        fileName,
        name: page.name,
      })
    }
    if (fileName !== `${page.uuid}.json`) {
      throw relationError('PAGE_ASSET_UUID_MISMATCH', `${fileName} does not match UUID ${page.uuid}`, {
        fileName,
        uuid: page.uuid,
      })
    }
    if (byUuid.has(page.uuid)) {
      throw relationError('PAGE_ASSET_UUID_DUPLICATE', `Duplicate system page UUID ${page.uuid}`, { uuid: page.uuid })
    }

    const asset = { fileName, filePath, source, page }
    assets.push(asset)
    byUuid.set(page.uuid, asset)
  }

  let graph
  try {
    graph = deriveCanonicalPageGraph(assets.map(asset => ({
      source: 'system',
      uuid: asset.page.uuid,
      blocks: asset.page.blocks,
    })))
  }
  catch (error) {
    assetGraphError(error)
  }

  const relations = new Map(assets.map(asset => [
    asset.page.uuid,
    graph.get(pageReferenceNodeKey('system', asset.page.uuid)),
  ]))

  const rendered = assets.map(asset => ({
    ...asset,
    relation: relations.get(asset.page.uuid),
    expectedSource: renderPageAsset(asset.source, relations.get(asset.page.uuid)),
  }))
  const dependencyCount = [...relations.values()].reduce((total, relation) => total + relation.dependencies.length, 0)

  return {
    assets: rendered,
    relations,
    summary: {
      pageCount: assets.length,
      dependencyCount,
      parentCount: [...relations.values()].filter(relation => relation.dependencies.length > 0).length,
      subPageCount: [...relations.values()].filter(relation => relation.subPage).length,
      mainPageCount: [...relations.values()].filter(relation => !relation.subPage).length,
      multiQuotedPageCount: [...relations.values()].filter(relation => relation.quotes.length > 1).length,
      changedFileCount: rendered.filter(asset => asset.source !== asset.expectedSource).length,
    },
  }
}

export async function writeSystemPageRelations(directory = DEFAULT_PAGE_ASSETS_DIR) {
  const analysis = await analyzeSystemPageAssets(directory)
  await writeChangedAssets(analysis.assets)
  return analysis.summary
}

async function writeChangedAssets(assets) {
  const staged = assets
    .filter(asset => asset.source !== asset.expectedSource)
    .map((asset, index) => ({
      ...asset,
      temporaryPath: `${asset.filePath}.${process.pid}.${index}.tmp`,
    }))

  try {
    await Promise.all(staged.map(asset => writeFile(asset.temporaryPath, asset.expectedSource, 'utf8')))
    for (const asset of staged) await rename(asset.temporaryPath, asset.filePath)
  }
  finally {
    await Promise.all(staged.map(asset => unlink(asset.temporaryPath).catch(() => undefined)))
  }
}

async function main() {
  const mode = process.argv[2] ?? '--check'
  if (mode !== '--check' && mode !== '--write') {
    throw new Error('Usage: tsx scripts/page-reference-assets.mjs [--check|--write] [directory]')
  }
  const directory = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_PAGE_ASSETS_DIR
  const analysis = await analyzeSystemPageAssets(directory)

  if (mode === '--write') {
    await writeChangedAssets(analysis.assets)
  }
  else if (analysis.summary.changedFileCount > 0) {
    const changedFiles = analysis.assets
      .filter(asset => asset.source !== asset.expectedSource)
      .map(asset => asset.fileName)
    throw relationError(
      'PAGE_ASSET_RELATIONS_STALE',
      `${changedFiles.length} page assets have stale relation metadata: ${changedFiles.join(', ')}`,
      { changedFiles },
    )
  }

  const verb = mode === '--write' ? 'updated' : 'validated'
  console.log(JSON.stringify({ status: verb, ...analysis.summary, changedFileCount: mode === '--write' ? 0 : analysis.summary.changedFileCount }))
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
