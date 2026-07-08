import { assertApiJsonUuid, type BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import {
  getMokelayApiAssetStorage,
  parseMokelayApiJsonAsset,
  type MokelayApiAssetStorage,
} from './listMokelayApiJsons'

export async function readMokelayApiJson(uuid: unknown, storage?: MokelayApiAssetStorage) {
  const apiJsonUuid = assertApiJsonUuid(typeof uuid === 'string' ? uuid : undefined)
  const fileName = `${apiJsonUuid}.json`
  const assetStorage = storage ?? await getMokelayApiAssetStorage()
  let value: unknown

  try {
    value = await assetStorage.getItem(`mokelay-apis/${fileName}`)
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined

    if (code !== 'ENOENT') {
      throw error
    }
  }

  if (value === null || value === undefined) {
    throw mokelayError('API_JSON_NOT_FOUND', `API JSON 资产 ${fileName} 不存在。`, 404)
  }

  return parseMokelayApiJsonAsset(fileName, value)
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "readMokelayApiJson",
 *   "displayName": "读取系统 API JSON",
 *   "category": "asset",
 *   "description": "按 uuid 从 Nitro server assets 的 mokelay-apis 目录读取并校验单个系统 API JSON。",
 *   "inputs": [
 *     { "key": "uuid", "type": "string", "required": true, "description": "API JSON uuid，同时对应 mokelay-apis/{uuid}.json。" }
 *   ],
 *   "outputs": [
 *     { "key": "api", "type": "ApiJson", "description": "已解析并校验的 API JSON。" }
 *   ],
 *   "errors": [
 *     { "code": "API_JSON_UUID_INVALID", "description": "uuid 为空或包含非法字符。" },
 *     { "code": "API_JSON_NOT_FOUND", "description": "API JSON 资产不存在。" },
 *     { "code": "API_JSON_INVALID_JSON", "description": "资产文件不是合法 JSON。" },
 *     { "code": "API_JSON_INVALID_SCHEMA", "description": "API JSON 不符合编排 schema。" },
 *     { "code": "API_JSON_UUID_MISMATCH", "description": "API JSON uuid 与文件名不一致。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "source", "type": "string", "value": "assets:server/mokelay-apis", "description": "通过 Nitro storage 读取打包后的服务端资产。" }
 *   ],
 *   "examples": [
 *     { "title": "读取系统 API", "block": { "uuid": "read_mokelay_api_json_block", "functionName": "readMokelayApiJson", "inputs": { "uuid": { "template": "{{request.query.uuid}}" } }, "outputs": ["api"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeReadMokelayApiJsonBlock: BlockExecutor = async ({ inputs }) => {
  return {
    api: await readMokelayApiJson(inputs.uuid),
  }
}
