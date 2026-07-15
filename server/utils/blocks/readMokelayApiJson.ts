import { assertApiJsonUuid, type BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import {
  listMokelayApiJsons,
  type MokelayApiAssetStorage,
} from './listMokelayApiJsons'

export async function readMokelayApiJson(uuid: unknown, fragment: unknown = false, storage?: MokelayApiAssetStorage) {
  const apiJsonUuid = assertApiJsonUuid(typeof uuid === 'string' ? uuid : undefined)
  const { apis } = await listMokelayApiJsons(fragment, storage)
  const api = apis.find(value => typeof value === 'object' && value !== null && 'uuid' in value && value.uuid === apiJsonUuid)
  if (api) return api
  throw mokelayError('API_JSON_NOT_FOUND', `API JSON 资产 ${apiJsonUuid}.json 不存在。`, 404)
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "readMokelayApiJson",
 *   "displayName": "读取系统 API JSON",
 *   "category": "asset",
 *   "description": "按 uuid 从 Nitro server assets 的 mokelay-apis 根目录或 fragment 子目录读取并校验单个内置 API/Fragment JSON。",
 *   "inputs": [
 *     { "key": "uuid", "type": "string", "required": true, "description": "API JSON uuid。" },
 *     { "key": "fragment", "type": "boolean", "required": false, "defaultValue": false, "description": "false 从 mokelay-apis 根目录读取；true 从 mokelay-apis/fragment 读取。" }
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
 *     { "key": "source", "type": "string", "value": "assets:server/mokelay-apis + mokelay-apis/fragment", "description": "通过 Nitro storage 读取打包后的服务端资产。" }
 *   ],
 *   "examples": [
 *     { "title": "读取系统 API", "block": { "uuid": "read_mokelay_api_json_block", "functionName": "readMokelayApiJson", "inputs": { "uuid": { "template": "{{request.query.uuid}}" } }, "outputs": ["api"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeReadMokelayApiJsonBlock: BlockExecutor = async ({ inputs }) => {
  return {
    api: await readMokelayApiJson(inputs.uuid, inputs.fragment),
  }
}
