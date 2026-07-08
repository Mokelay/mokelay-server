import { assertApiJsonUuid, type BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import {
  getMokelayApiAssetStorage,
  type MokelayApiAssetStorage,
} from './listMokelayApiJsons'
import { parseMokelayLayoutJsonAsset } from './listMokelayLayoutJsons'

export async function readMokelayLayoutJson(uuid: unknown, storage?: MokelayApiAssetStorage) {
  const layoutJsonUuid = assertApiJsonUuid(typeof uuid === 'string' ? uuid : undefined)
  const fileName = `${layoutJsonUuid}.json`
  const assetStorage = storage ?? await getMokelayApiAssetStorage()
  let value: unknown

  try {
    value = await assetStorage.getItem(`mokelay-layouts/${fileName}`)
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined

    if (code !== 'ENOENT') {
      throw error
    }
  }

  if (value === null || value === undefined) {
    throw mokelayError('API_JSON_NOT_FOUND', `布局 JSON 资产 ${fileName} 不存在。`, 404)
  }

  return parseMokelayLayoutJsonAsset(fileName, value)
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "readMokelayLayoutJson",
 *   "displayName": "读取系统布局 JSON",
 *   "category": "asset",
 *   "description": "按 uuid 从 Nitro server assets 的 mokelay-layouts 目录读取并校验单个系统布局 JSON。",
 *   "inputs": [
 *     { "key": "uuid", "type": "string", "required": true, "description": "布局 JSON uuid，同时对应 mokelay-layouts/{uuid}.json。" }
 *   ],
 *   "outputs": [
 *     { "key": "layout", "type": "MokelayLayoutJsonRecord", "description": "已标准化的布局 JSON 记录。" }
 *   ],
 *   "errors": [
 *     { "code": "API_JSON_UUID_INVALID", "description": "uuid 为空或包含非法字符。" },
 *     { "code": "API_JSON_NOT_FOUND", "description": "布局 JSON 资产不存在。" },
 *     { "code": "API_JSON_INVALID_JSON", "description": "布局资产文件不是合法 JSON。" },
 *     { "code": "API_JSON_INVALID_SCHEMA", "description": "布局 JSON 缺少 name 或 blocks。" },
 *     { "code": "API_JSON_UUID_MISMATCH", "description": "布局 JSON uuid 与文件名不一致。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "source", "type": "string", "value": "assets:server/mokelay-layouts", "description": "通过 Nitro storage 读取打包后的服务端资产。" }
 *   ],
 *   "examples": [
 *     { "title": "读取系统布局", "block": { "uuid": "read_mokelay_layout_json_block", "functionName": "readMokelayLayoutJson", "inputs": { "uuid": { "template": "{{request.query.uuid}}" } }, "outputs": ["layout"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeReadMokelayLayoutJsonBlock: BlockExecutor = async ({ inputs }) => {
  return {
    layout: await readMokelayLayoutJson(inputs.uuid),
  }
}
