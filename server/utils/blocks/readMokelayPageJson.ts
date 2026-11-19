import { assertApiJsonUuid, type BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import {
  type MokelayApiAssetStorage,
} from './listMokelayApiJsons'
import { listMokelayPageJsons } from './listMokelayPageJsons'

export async function readMokelayPageJson(uuid: unknown, storage?: MokelayApiAssetStorage) {
  const pageJsonUuid = assertApiJsonUuid(typeof uuid === 'string' ? uuid : undefined)
  const { pages } = await listMokelayPageJsons(storage)
  const page = pages.find(page => page.uuid === pageJsonUuid)
  if (!page) throw mokelayError('API_JSON_NOT_FOUND', `页面 JSON 资产 ${pageJsonUuid}.json 不存在。`, 404)
  return page
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "readMokelayPageJson",
 *   "displayName": "读取系统页面 JSON",
 *   "category": "asset",
 *   "description": "按 uuid 从 Nitro server assets 的 {app}/pages 目录读取并校验单个系统页面 JSON。",
 *   "inputs": [
 *     { "key": "datasource", "type": "string", "required": true, "description": "Mokelay 数据源，用于合并用户页面对系统页面的动态引用。" },
 *     { "key": "uuid", "type": "string", "required": true, "description": "页面 JSON uuid，同时对应 {app}/pages/{uuid}.json。" }
 *   ],
 *   "outputs": [
 *     { "key": "page", "type": "PageJson", "description": "已解析并校验、附带 assetApp 的页面 JSON。" }
 *   ],
 *   "errors": [
 *     { "code": "API_JSON_UUID_INVALID", "description": "uuid 为空或包含非法字符。" },
 *     { "code": "API_JSON_NOT_FOUND", "description": "页面 JSON 资产不存在。" },
 *     { "code": "API_JSON_INVALID_JSON", "description": "页面资产文件不是合法 JSON。" },
 *     { "code": "API_JSON_INVALID_SCHEMA", "description": "页面 JSON 缺少 name 或 blocks。" },
 *     { "code": "API_JSON_UUID_MISMATCH", "description": "页面 JSON uuid 与文件名不一致。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": true, "description": "读取用户页面依赖并合并动态 quotes。" },
 *     { "key": "source", "type": "string", "value": "assets:server/{app}/pages", "description": "通过 Nitro storage 读取打包后的服务端资产。" }
 *   ],
 *   "examples": [
 *     { "title": "读取系统页面", "block": { "uuid": "read_mokelay_page_json_block", "functionName": "readMokelayPageJson", "inputs": { "uuid": { "template": "{{request.query.uuid}}" } }, "outputs": ["page"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeReadMokelayPageJsonBlock: BlockExecutor = async ({ inputs, executeSql }) => {
  const page = await readMokelayPageJson(inputs.uuid)
  const { mergeSystemPageRelations } = await import('../pageRelationStore')
  return {
    page: (await mergeSystemPageRelations([page as Record<string, unknown>], executeSql))[0],
  }
}
