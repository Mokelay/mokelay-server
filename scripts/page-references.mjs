import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { closeDatasourceConnection } from 'mokelay-server-core/utils/db'
import {
  analyzeSystemPageAssets,
  DEFAULT_PAGE_ASSETS_DIR,
  writeSystemPageRelations,
} from './page-reference-assets.mjs'
import { runDatabasePageRelationCommand } from './page-reference-database.ts'

const commands = new Set(['check', 'assets-write', 'db-check', 'db-apply'])

function option(args, name) {
  const prefix = `--${name}=`
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function usage() {
  return [
    'Usage: tsx scripts/page-references.mjs <command> [options]',
    '  check [directory|--directory=...]   Validate system assets without writes',
    '  assets-write [directory|--directory=...]  Rewrite static system relations',
    '  db-check [--datasource=Mokelay]     Audit database graph without writes',
    '  db-apply [--datasource=Mokelay]     Atomically backfill and promote graph v1',
  ].join('\n')
}

async function runAssets(command, args) {
  const positionalDirectory = args.find(value => !value.startsWith('--'))
  const directory = path.resolve(option(args, 'directory') ?? positionalDirectory ?? DEFAULT_PAGE_ASSETS_DIR)

  if (command === 'assets-write') {
    const summary = await writeSystemPageRelations(directory)
    return {
      status: 'updated',
      ...summary,
      updatedFileCount: summary.changedFileCount,
      changedFileCount: 0,
    }
  }

  const analysis = await analyzeSystemPageAssets(directory)
  if (analysis.summary.changedFileCount > 0) {
    const changedFiles = analysis.assets
      .filter(asset => asset.source !== asset.expectedSource)
      .map(asset => asset.fileName)
    throw new Error(
      `PAGE_ASSET_RELATIONS_STALE: ${changedFiles.length} page assets have stale relation metadata: ${changedFiles.join(', ')}`,
    )
  }
  return { status: 'validated', ...analysis.summary }
}

export async function runPageReferencesCli(command, args = []) {
  if (!commands.has(command)) throw new Error(usage())
  if (command === 'check' || command === 'assets-write') {
    return await runAssets(command, args)
  }

  const datasource = option(args, 'datasource') || 'Mokelay'
  return await runDatabasePageRelationCommand(command === 'db-apply' ? 'apply' : 'check', datasource)
}

async function main() {
  const [command = '', ...args] = process.argv.slice(2)
  const databaseCommand = command === 'db-check' || command === 'db-apply'
  const datasource = option(args, 'datasource') || 'Mokelay'

  try {
    const report = await runPageReferencesCli(command, args)
    console.log(JSON.stringify(report, null, 2))
    if (
      command === 'db-check'
      && 'ready' in report
      && (!report.ready || report.changedCount > 0)
    ) process.exitCode = 2
  } finally {
    if (databaseCommand) await closeDatasourceConnection(datasource)
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
