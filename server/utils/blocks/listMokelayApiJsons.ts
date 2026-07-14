import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import { parseApiJson, type BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

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

export function parseMokelayApiJsonAsset(fileName: string, value: unknown) {
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

export async function getMokelayApiAssetStorage() {
  try {
    const { useStorage } = await import('nitropack/runtime')
    return useStorage('assets:server') as unknown as MokelayApiAssetStorage
  } catch {
    const assetsRoot = resolve(process.cwd(), 'server/assets')
    return {
      async getKeys(base = '') {
        const directory = resolve(assetsRoot, base)
        if (directory !== assetsRoot && !directory.startsWith(`${assetsRoot}${sep}`)) return []
        try {
          return (await readdir(directory, { withFileTypes: true }))
            .filter(entry => entry.isFile())
            .map(entry => `${base}:${entry.name}`)
        } catch {
          return []
        }
      },
      async getItem(key: string) {
        const normalized = key.replaceAll(':', '/')
        const filePath = resolve(assetsRoot, normalized)
        if (!filePath.startsWith(`${assetsRoot}${sep}`)) return undefined
        try {
          return await readFile(filePath, 'utf8')
        } catch {
          return undefined
        }
      },
    }
  }
}

export async function listMokelayApiJsons(storage?: MokelayApiAssetStorage) {
  const assetStorage = storage ?? await getMokelayApiAssetStorage()
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

    return parseMokelayApiJsonAsset(fileName, value)
  }))

  return {
    apis,
    count: apis.length,
  }
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "listMokelayApiJsons",
 *   "displayName": "列出系统 API JSON",
 *   "category": "asset",
 *   "description": "从 Nitro server assets 的 mokelay-apis 目录读取并校验系统 API JSON 列表。",
 *   "inputs": [],
 *   "outputs": [
 *     { "key": "apis", "type": "ApiJson[]", "description": "已解析并校验的 API JSON 数组。" },
 *     { "key": "count", "type": "number", "description": "API JSON 数量。" }
 *   ],
 *   "errors": [
 *     { "code": "API_JSON_INVALID_JSON", "description": "资产文件不是合法 JSON。" },
 *     { "code": "API_JSON_INVALID_SCHEMA", "description": "API JSON 不符合编排 schema。" },
 *     { "code": "API_JSON_UUID_MISMATCH", "description": "API JSON uuid 与文件名不一致。" },
 *     { "code": "API_JSON_NOT_FOUND", "description": "读取到的资产 key 内容为空。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "source", "type": "string", "value": "assets:server/mokelay-apis", "description": "通过 Nitro storage 读取打包后的服务端资产。" }
 *   ],
 *   "examples": [
 *     { "title": "列出系统 API", "block": { "uuid": "list_mokelay_api_jsons_block", "functionName": "listMokelayApiJsons", "inputs": {}, "outputs": ["apis", "count"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeListMokelayApiJsonsBlock: BlockExecutor = async () => {
  return await listMokelayApiJsons()
}
