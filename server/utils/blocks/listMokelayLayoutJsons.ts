import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import type { BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import {
  getMokelayApiAssetStorage,
  type MokelayApiAssetStorage,
} from './listMokelayApiJsons'

export type MokelayLayoutJsonRecord = {
  uuid: string
  name: string
  layoutJson: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

function layoutAssetFileName(key: string) {
  const normalizedKey = key.replaceAll('\\', '/').replaceAll(':', '/')
  const prefix = 'mokelay-layouts/'

  if (!normalizedKey.startsWith(prefix)) {
    return undefined
  }

  const fileName = normalizedKey.slice(prefix.length)

  if (!fileName.endsWith('.json') || fileName.includes('/')) {
    return undefined
  }

  return fileName
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function normalizeLayoutJsonRecord(layoutJson: Record<string, unknown>): MokelayLayoutJsonRecord {
  const uuid = readString(layoutJson.uuid) ?? ''
  const name = readString(layoutJson.name) ?? ''
  const createdAt = readString(layoutJson.createdAt) ?? readString(layoutJson.created_at)
  const updatedAt = readString(layoutJson.updatedAt) ?? readString(layoutJson.updated_at)

  return {
    uuid,
    name,
    layoutJson: {
      schemaVersion: 1,
      ...layoutJson,
      uuid,
      name,
      blocks: Array.isArray(layoutJson.blocks) ? layoutJson.blocks : [],
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    },
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  }
}

export function parseMokelayLayoutJsonAsset(fileName: string, value: unknown): MokelayLayoutJsonRecord {
  const layoutJsonUuid = fileName.slice(0, -'.json'.length)
  let layoutJson = value

  if (typeof value === 'string') {
    try {
      layoutJson = JSON.parse(value) as unknown
    } catch (error) {
      throw mokelayError('API_JSON_INVALID_JSON', `布局 JSON ${layoutJsonUuid} 不是合法 JSON。`, 400, error)
    }
  }

  if (typeof layoutJson !== 'object' || layoutJson === null || Array.isArray(layoutJson)) {
    throw mokelayError('API_JSON_INVALID_SCHEMA', `布局 JSON ${layoutJsonUuid} 必须是对象。`, 400)
  }

  const record = layoutJson as Record<string, unknown>

  if (record.uuid !== layoutJsonUuid) {
    throw mokelayError('API_JSON_UUID_MISMATCH', `布局 JSON ${layoutJsonUuid} 的 uuid 必须与文件名一致。`, 400)
  }

  if (typeof record.name !== 'string' || !Array.isArray(record.blocks)) {
    throw mokelayError('API_JSON_INVALID_SCHEMA', `布局 JSON ${layoutJsonUuid} 缺少 name 或 blocks。`, 400)
  }

  return normalizeLayoutJsonRecord(record)
}

export async function listMokelayLayoutJsons(storage?: MokelayApiAssetStorage) {
  const assetStorage = storage ?? await getMokelayApiAssetStorage()
  const keys = await assetStorage.getKeys('mokelay-layouts')
  const assetsByFileName = new Map<string, string>()

  for (const key of keys) {
    const fileName = layoutAssetFileName(key)

    if (fileName) {
      assetsByFileName.set(fileName, key)
    }
  }

  const fileNames = [...assetsByFileName.keys()].sort()
  const layouts = await Promise.all(fileNames.map(async (fileName) => {
    const key = assetsByFileName.get(fileName)!
    const value = await assetStorage.getItem(key)

    if (value === null || value === undefined) {
      throw mokelayError('API_JSON_NOT_FOUND', `布局 JSON 资产 ${fileName} 不存在。`, 404)
    }

    return parseMokelayLayoutJsonAsset(fileName, value)
  }))

  return {
    layouts,
    count: layouts.length,
  }
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "listMokelayLayoutJsons",
 *   "displayName": "列出系统布局 JSON",
 *   "category": "asset",
 *   "description": "从 Nitro server assets 的 mokelay-layouts 目录读取并校验系统布局 JSON 列表。",
 *   "inputs": [],
 *   "outputs": [
 *     { "key": "layouts", "type": "MokelayLayoutJsonRecord[]", "description": "已标准化的布局 JSON 数组。" },
 *     { "key": "count", "type": "number", "description": "布局 JSON 数量。" }
 *   ],
 *   "errors": [
 *     { "code": "API_JSON_INVALID_JSON", "description": "布局资产文件不是合法 JSON。" },
 *     { "code": "API_JSON_INVALID_SCHEMA", "description": "布局 JSON 缺少 name 或 blocks。" },
 *     { "code": "API_JSON_UUID_MISMATCH", "description": "布局 JSON uuid 与文件名不一致。" },
 *     { "code": "API_JSON_NOT_FOUND", "description": "读取到的资产 key 内容为空。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "source", "type": "string", "value": "assets:server/mokelay-layouts", "description": "通过 Nitro storage 读取打包后的服务端资产。" }
 *   ],
 *   "examples": [
 *     { "title": "列出系统布局", "block": { "uuid": "list_mokelay_layout_jsons_block", "functionName": "listMokelayLayoutJsons", "inputs": {}, "outputs": ["layouts", "count"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeListMokelayLayoutJsonsBlock: BlockExecutor = async () => {
  return await listMokelayLayoutJsons()
}
