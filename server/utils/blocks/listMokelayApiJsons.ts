import { assertAssetApp } from 'mokelay-server-core/utils/app-assets'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import { parseApiJson, type BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { assertFragmentCallParams, executeFragmentCalls } from './fragmentContracts'

export type MokelayApiAssetStorage = {
  getKeys: (base?: string, options?: { maxDepth?: number }) => Promise<string[]>
  getItem: (key: string) => Promise<unknown>
}

type MokelayApiAssetEntry = {
  key: string
  assetApp: string
  relativePath: string
  uuid: string
  fragment: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assetEntry(key: string): MokelayApiAssetEntry | undefined {
  const normalizedKey = key.replaceAll('\\', '/').replaceAll(':', '/')
  const match = /^([a-z][a-z0-9_-]{0,63})\/apis\/(?:(fragment)\/)?([A-Za-z0-9_-]{1,128})\.json$/.exec(normalizedKey)
  const uuid = match?.[3]
  if (!uuid) return undefined
  if (match[1] === 'mokelay-schema') return undefined
  const fragment = match[2] === 'fragment'
  return {
    key,
    assetApp: match[1]!,
    relativePath: fragment ? `fragment/${uuid}.json` : `${uuid}.json`,
    uuid,
    fragment,
  }
}

export function parseMokelayApiJsonAsset(relativePath: string, value: unknown) {
  const entry = assetEntry(`mokelay/apis/${relativePath}`)
  if (!entry) {
    throw mokelayError('API_JSON_UUID_INVALID', `API JSON 资产路径 ${relativePath} 无效。`, 400)
  }
  const apiJsonUuid = entry.uuid
  let apiJson = value

  if (typeof value === 'string') {
    try {
      apiJson = JSON.parse(value) as unknown
    } catch (error) {
      throw mokelayError('API_JSON_INVALID_JSON', `API JSON ${apiJsonUuid} 不是合法 JSON。`, 400, error)
    }
  }

  parseApiJson(apiJsonUuid, apiJson)
  if (!isRecord(apiJson) || (apiJson.fragment === true) !== entry.fragment) {
    throw mokelayError(
      'API_JSON_INVALID_SCHEMA',
      entry.fragment
        ? `内置 Fragment ${apiJsonUuid} 必须配置 fragment=true 并保存在应用的 apis/fragment 目录。`
        : `内置 API ${apiJsonUuid} 不能在应用的 apis 根目录声明为 Fragment。`,
      400,
    )
  }
  return apiJson
}

function assertBuiltInFragmentReferences(
  assets: Array<{ entry: MokelayApiAssetEntry, apiJson: unknown }>,
) {
  const fragments = new Map(
    assets.filter(asset => asset.entry.fragment).map(asset => [`${asset.entry.assetApp}/${asset.entry.uuid}`, asset.apiJson]),
  )
  for (const asset of assets) {
    if (asset.entry.fragment) continue
    for (const call of executeFragmentCalls(asset.apiJson)) {
      const fragment = fragments.get(`${asset.entry.assetApp}/${call.fragmentUuid}`)
      if (!fragment) {
        throw mokelayError(
          'API_JSON_INVALID_FLOW',
          `内置 API ${asset.entry.uuid} 只能引用 ${asset.entry.assetApp}/apis/fragment 中的内置 Fragment：${call.fragmentUuid}。`,
          409,
        )
      }
      assertFragmentCallParams(asset.entry.uuid, call, fragment)
    }
  }
}

function fragmentSelector(value: unknown) {
  if (value === undefined || value === null || value === '') return false
  if (typeof value === 'boolean') return value
  throw mokelayError('API_JSON_INVALID_SCHEMA', '内置 API 列表的 fragment 必须是 boolean。', 400)
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
          const walk = async (dir: string, prefix: string): Promise<string[]> => {
            const entries = await readdir(dir, { withFileTypes: true })
            return (await Promise.all(entries.map(entry => {
              const key = prefix ? `${prefix}/${entry.name}` : entry.name
              return entry.isDirectory() ? walk(resolve(dir, entry.name), key) : entry.isFile() ? [key] : []
            }))).flat()
          }
          return await walk(directory, base)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
          throw error
        }
      },
      async getItem(key: string) {
        const normalized = key.replaceAll(':', '/')
        const filePath = resolve(assetsRoot, normalized)
        if (!filePath.startsWith(`${assetsRoot}${sep}`)) return undefined
        try {
          return await readFile(filePath, 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
          throw error
        }
      },
    }
  }
}

export async function listMokelayApiJsons(fragment: unknown = false, storage?: MokelayApiAssetStorage, assetApp?: string) {
  if (assetApp !== undefined) assertAssetApp(assetApp)
  const selectedFragment = fragmentSelector(fragment)
  const assetStorage = storage ?? await getMokelayApiAssetStorage()
  const keys = await assetStorage.getKeys(assetApp ? `${assetApp}/apis` : '')
  const assetsByPath = new Map<string, MokelayApiAssetEntry>()

  for (const key of keys) {
    const entry = assetEntry(key)
    if (entry && (!assetApp || entry.assetApp === assetApp)) assetsByPath.set(`${entry.assetApp}/${entry.relativePath}`, entry)
  }

  const entries = [...assetsByPath.values()].sort((left, right) => (
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  ))
  const assets = await Promise.all(entries.map(async (entry) => {
    const value = await assetStorage.getItem(entry.key)

    if (value === null || value === undefined) {
      throw mokelayError('API_JSON_NOT_FOUND', `API JSON 资产 ${entry.relativePath} 不存在。`, 404)
    }

    return {
      entry,
      apiJson: parseMokelayApiJsonAsset(entry.relativePath, value),
    }
  }))
  assertBuiltInFragmentReferences(assets)
  const apis = assets
    .filter(asset => asset.entry.fragment === selectedFragment)
    .map(asset => ({ ...(asset.apiJson as Record<string, unknown>), assetApp: asset.entry.assetApp }))

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
 *   "description": "从 Nitro server assets 的各应用 apis 目录读取内置 API 与 fragment 子目录中的内置 Fragment，并校验引用不会跨到数据库命名空间。",
 *   "inputs": [
 *     { "key": "assetApp", "type": "string", "required": false, "description": "内置资产所属应用目录。列表省略时列出全部应用，读取详情省略时为 mokelay。" },
 *     { "key": "fragment", "type": "boolean", "required": false, "defaultValue": false, "description": "false 仅列出根目录内置 API；true 仅列出 fragment 子目录内置 Fragment。" }
 *   ],
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
 *     { "key": "source", "type": "string", "value": "assets:server/{app}/apis + {app}/apis/fragment", "description": "通过 Nitro storage 读取打包后的服务端资产。" }
 *   ],
 *   "examples": [
 *     { "title": "列出系统 API", "block": { "uuid": "list_mokelay_api_jsons_block", "functionName": "listMokelayApiJsons", "inputs": {}, "outputs": ["apis", "count"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeListMokelayApiJsonsBlock: BlockExecutor = async ({ inputs }) => {
  return await listMokelayApiJsons(inputs.fragment, undefined, inputs.assetApp as string | undefined)
}
