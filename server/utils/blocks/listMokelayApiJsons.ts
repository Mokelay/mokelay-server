import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import { parseApiJson, type BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'

export type MokelayApiAssetStorage = {
  getKeys: (base?: string, options?: { maxDepth?: number }) => Promise<string[]>
  getItem: (key: string) => Promise<unknown>
}

function assetFileName(key: string) {
  const normalizedKey = key.replaceAll('\\', '/').replaceAll(':', '/')
  const prefix = 'mokelay-apis/'

  if (!normalizedKey.startsWith(prefix)) {
    return undefined
  }

  const fileName = normalizedKey.slice(prefix.length)

  if (!fileName.endsWith('.json') || fileName.includes('/')) {
    return undefined
  }

  return fileName
}

function parseAssetJson(fileName: string, value: unknown) {
  const apiJsonUuid = fileName.slice(0, -'.json'.length)
  let apiJson = value

  if (typeof value === 'string') {
    try {
      apiJson = JSON.parse(value) as unknown
    } catch (error) {
      throw mokelayError('API_JSON_INVALID_JSON', `API JSON ${apiJsonUuid} 不是合法 JSON。`, 400, error)
    }
  }

  parseApiJson(apiJsonUuid, apiJson)
  return apiJson
}

async function nitroAssetStorage() {
  const { useStorage } = await import('nitropack/runtime')
  return useStorage('assets:server') as unknown as MokelayApiAssetStorage
}

export async function listMokelayApiJsons(storage?: MokelayApiAssetStorage) {
  const assetStorage = storage ?? await nitroAssetStorage()
  const keys = await assetStorage.getKeys('mokelay-apis')
  const assetsByFileName = new Map<string, string>()

  for (const key of keys) {
    const fileName = assetFileName(key)

    if (fileName) {
      assetsByFileName.set(fileName, key)
    }
  }

  const fileNames = [...assetsByFileName.keys()].sort()
  const apis = await Promise.all(fileNames.map(async (fileName) => {
    const key = assetsByFileName.get(fileName)!
    const value = await assetStorage.getItem(key)

    if (value === null || value === undefined) {
      throw mokelayError('API_JSON_NOT_FOUND', `API JSON 资产 ${fileName} 不存在。`, 404)
    }

    return parseAssetJson(fileName, value)
  }))

  return {
    apis,
    count: apis.length,
  }
}

export const executeListMokelayApiJsonsBlock: BlockExecutor = async () => {
  return await listMokelayApiJsons()
}
