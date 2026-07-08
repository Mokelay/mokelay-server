import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import type { BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import {
  getMokelayApiAssetStorage,
  type MokelayApiAssetStorage,
} from './listMokelayApiJsons'

function pageAssetFileName(key: string) {
  const normalizedKey = key.replaceAll('\\', '/').replaceAll(':', '/')
  const prefix = 'mokelay-pages/'

  if (!normalizedKey.startsWith(prefix)) {
    return undefined
  }

  const fileName = normalizedKey.slice(prefix.length)

  if (!fileName.endsWith('.json') || fileName.includes('/')) {
    return undefined
  }

  return fileName
}

export function parseMokelayPageJsonAsset(fileName: string, value: unknown) {
  const pageJsonUuid = fileName.slice(0, -'.json'.length)
  let pageJson = value

  if (typeof value === 'string') {
    try {
      pageJson = JSON.parse(value) as unknown
    } catch (error) {
      throw mokelayError('API_JSON_INVALID_JSON', `页面 JSON ${pageJsonUuid} 不是合法 JSON。`, 400, error)
    }
  }

  if (typeof pageJson !== 'object' || pageJson === null || Array.isArray(pageJson)) {
    throw mokelayError('API_JSON_INVALID_SCHEMA', `页面 JSON ${pageJsonUuid} 必须是对象。`, 400)
  }

  const record = pageJson as Record<string, unknown>

  if (record.uuid !== pageJsonUuid) {
    throw mokelayError('API_JSON_UUID_MISMATCH', `页面 JSON ${pageJsonUuid} 的 uuid 必须与文件名一致。`, 400)
  }

  if (typeof record.name !== 'string' || !Array.isArray(record.blocks)) {
    throw mokelayError('API_JSON_INVALID_SCHEMA', `页面 JSON ${pageJsonUuid} 缺少 name 或 blocks。`, 400)
  }

  return pageJson
}

export async function listMokelayPageJsons(storage?: MokelayApiAssetStorage) {
  const assetStorage = storage ?? await getMokelayApiAssetStorage()
  const keys = await assetStorage.getKeys('mokelay-pages')
  const assetsByFileName = new Map<string, string>()

  for (const key of keys) {
    const fileName = pageAssetFileName(key)

    if (fileName) {
      assetsByFileName.set(fileName, key)
    }
  }

  const fileNames = [...assetsByFileName.keys()].sort()
  const pages = await Promise.all(fileNames.map(async (fileName) => {
    const key = assetsByFileName.get(fileName)!
    const value = await assetStorage.getItem(key)

    if (value === null || value === undefined) {
      throw mokelayError('API_JSON_NOT_FOUND', `页面 JSON 资产 ${fileName} 不存在。`, 404)
    }

    return parseMokelayPageJsonAsset(fileName, value)
  }))

  return {
    pages,
    count: pages.length,
  }
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "listMokelayPageJsons",
 *   "displayName": "列出系统页面 JSON",
 *   "category": "asset",
 *   "description": "从 Nitro server assets 的 mokelay-pages 目录读取并校验系统页面 JSON 列表。",
 *   "inputs": [],
 *   "outputs": [
 *     { "key": "pages", "type": "PageJson[]", "description": "已解析并校验的页面 JSON 数组。" },
 *     { "key": "count", "type": "number", "description": "页面 JSON 数量。" }
 *   ],
 *   "errors": [
 *     { "code": "API_JSON_INVALID_JSON", "description": "页面资产文件不是合法 JSON。" },
 *     { "code": "API_JSON_INVALID_SCHEMA", "description": "页面 JSON 缺少 name 或 blocks。" },
 *     { "code": "API_JSON_UUID_MISMATCH", "description": "页面 JSON uuid 与文件名不一致。" },
 *     { "code": "API_JSON_NOT_FOUND", "description": "读取到的资产 key 内容为空。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "source", "type": "string", "value": "assets:server/mokelay-pages", "description": "通过 Nitro storage 读取打包后的服务端资产。" }
 *   ],
 *   "examples": [
 *     { "title": "列出系统页面", "block": { "uuid": "list_mokelay_page_jsons_block", "functionName": "listMokelayPageJsons", "inputs": {}, "outputs": ["pages", "count"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeListMokelayPageJsonsBlock: BlockExecutor = async () => {
  return await listMokelayPageJsons()
}
