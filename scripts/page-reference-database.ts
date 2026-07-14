import 'dotenv/config'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { type SQL } from 'drizzle-orm'
import {
  closeDatasourceConnection,
  datasourceDatabaseType,
  executeDatasourceSql,
  executeDatasourceTransaction,
  type TransactionRunner,
} from 'mokelay-server-core/utils/db'
import {
  auditPageRelations,
  rebuildPageRelations,
} from '../server/utils/pageRelationStore'

export async function runDatabasePageRelationCommand(
  mode: 'check' | 'apply',
  datasource = 'Mokelay',
) {
  const databaseType = datasourceDatabaseType(datasource)
  const executeSql = <T extends Record<string, unknown> = Record<string, unknown>>(query: SQL) => (
    executeDatasourceSql<T>(query, datasource)
  )

  if (mode === 'apply') {
    const withTransaction: TransactionRunner = (callback, options) => (
      executeDatasourceTransaction(datasource, callback, options)
    )
    const report = await rebuildPageRelations(databaseType, withTransaction)
    return { mode, datasource, ...report }
  }

  const report = await auditPageRelations(executeSql)
  return { mode, datasource, ...report }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const apply = args.has('--apply')
  const explicitlyCheck = args.has('--check') || args.has('--dry-run')
  if (apply && explicitlyCheck) {
    throw new Error('Use either --check/--dry-run or --apply, not both.')
  }
  const datasourceArg = process.argv.slice(2).find(value => value.startsWith('--datasource='))
  const datasource = datasourceArg?.slice('--datasource='.length) || 'Mokelay'
  try {
    const report = await runDatabasePageRelationCommand(apply ? 'apply' : 'check', datasource)
    console.log(JSON.stringify(report, null, 2))
    if (report.mode === 'check' && (!report.ready || report.changedCount > 0)) process.exitCode = 2
  } finally {
    await closeDatasourceConnection(datasource)
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
