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

export const executeListMokelayPageJsonsBlock: BlockExecutor = async () => {
  return await listMokelayPageJsons()
}
