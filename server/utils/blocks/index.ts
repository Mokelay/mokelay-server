import { type BlockExecutor } from '../orchestration-schema'
import { executeAddSessionBlock } from './addSession'
import { executeAssertUniqueBlock } from './assertUnique'
import { executeCountBlock } from './count'
import { executeCreateBlock } from './create'
import { executeDeleteBlock } from './delete'
import { executeListBlock } from './list'
import { executePageBlock } from './page'
import { executeReadBlock } from './read'
import { executeReadSessionBlock } from './readSession'
import { executeRemoveSessionBlock } from './removeSession'
import { executeSaveJsonToR2Block } from './saveJsonToR2'
import { executeUpdateBlock } from './update'
import { executeUpsertBlock } from './upsert'

export const allowedBlockOutputs: Record<string, readonly string[]> = {
  list: ['datas'],
  page: ['datas', 'total', 'totalPages', 'page', 'pageSize', 'hasPreviousPage', 'hasNextPage'],
  count: ['total'],
  read: ['data'],
  delete: ['affected'],
  create: ['uuid'],
  upsert: ['uuid'],
  assertUnique: [],
  update: ['affected'],
  addSession: [],
  removeSession: [],
  readSession: ['value'],
  saveJsonToR2: ['key', 'directory', 'fileName', 'bucket', 'size', 'etag', 'skipped'],
}

export const databaseBlockFunctions = new Set([
  'list',
  'page',
  'count',
  'read',
  'delete',
  'create',
  'upsert',
  'assertUnique',
  'update',
])

export const blockExecutors: Record<string, BlockExecutor> = {
  list: executeListBlock,
  page: executePageBlock,
  count: executeCountBlock,
  read: executeReadBlock,
  delete: executeDeleteBlock,
  create: executeCreateBlock,
  upsert: executeUpsertBlock,
  assertUnique: executeAssertUniqueBlock,
  update: executeUpdateBlock,
  addSession: executeAddSessionBlock,
  removeSession: executeRemoveSessionBlock,
  readSession: executeReadSessionBlock,
  saveJsonToR2: executeSaveJsonToR2Block,
}
