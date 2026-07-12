import type { BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import {
  getMokelayApiAssetStorage,
  type MokelayApiAssetStorage,
} from './listMokelayApiJsons'

const assetDirectory = 'mokelay-schema'
const jsonFileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeFileName(value: unknown) {
  const fileName = typeof value === 'string' ? value.trim() : ''

  if (
    !fileName
    || fileName.length > 128
    || !jsonFileNamePattern.test(fileName)
    || fileName.includes('..')
    || fileName.includes('/')
    || fileName.includes('\\')
  ) {
    throw mokelayError(
      'BLOCK_AI_INPUT_INVALID',
      'AI_DSL_PROMPT_ASSET_NAME_INVALID: fileName 必须是安全的 .json 文件名。',
      400,
    )
  }

  return fileName
}

export async function readAiDslPromptAsset(
  fileNameValue: unknown,
  storage?: MokelayApiAssetStorage,
) {
  const fileName = normalizeFileName(fileNameValue)
  const assetStorage = storage ?? await getMokelayApiAssetStorage()
  let value: unknown

  try {
    value = await assetStorage.getItem(`${assetDirectory}/${fileName}`)
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined

    if (code !== 'ENOENT') {
      throw error
    }
  }

  if (value === null || value === undefined) {
    throw mokelayError(
      'BLOCK_AI_CONFIG_MISSING',
      `AI_DSL_PROMPT_ASSET_NOT_FOUND: 资产 ${fileName} 不存在。`,
      500,
    )
  }

  let document: unknown = value

  if (typeof value === 'string') {
    try {
      document = JSON.parse(value) as unknown
    } catch (error) {
      throw mokelayError(
        'BLOCK_AI_CONFIG_MISSING',
        `AI_DSL_PROMPT_ASSET_INVALID_JSON: 资产 ${fileName} 不是合法 JSON。`,
        500,
        error,
      )
    }
  }

  if (!isRecord(document)) {
    throw mokelayError(
      'BLOCK_AI_CONFIG_MISSING',
      `AI_DSL_PROMPT_ASSET_INVALID_DOCUMENT: 资产 ${fileName} 的 JSON 顶层必须是 object。`,
      500,
    )
  }

  return document
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "readAiDslPromptAsset",
 *   "displayName": "读取 AI DSL Prompt 资产",
 *   "category": "asset",
 *   "description": "从 Nitro assets:server 的固定 mokelay-schema 目录安全读取单个 JSON Prompt/Schema 资产。Block 接受已经解析的 object 或 JSON string，统一返回 object；不允许子目录和路径穿越，供 ai-generate-dsl 在调用模型前注入 Page/API DSL 与响应 Schema。",
 *   "inputs": [
 *     { "key": "fileName", "type": "string", "required": true, "description": "mokelay-schema 目录下不含路径的 .json 文件名；trim 后长度 1 到 128，以字母或数字开头，只允许字母、数字、点、下划线、连字符，并拒绝 ..、/ 和反斜杠。" }
 *   ],
 *   "outputs": [
 *     { "key": "document", "type": "Record<string, unknown>", "description": "解析并校验顶层类型后的 JSON object。返回值保留 Schema 的 $id、$defs、$ref 和扩展关键字，不做业务 Schema 校验。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_AI_INPUT_INVALID", "description": "fileName 为空、超过 128 字符、扩展名非法或包含不安全路径；消息以 AI_DSL_PROMPT_ASSET_NAME_INVALID 开头，HTTP 状态为 400。" },
 *     { "code": "BLOCK_AI_CONFIG_MISSING", "description": "资产不存在；消息以 AI_DSL_PROMPT_ASSET_NOT_FOUND 开头，HTTP 状态为 500。" },
 *     { "code": "BLOCK_AI_CONFIG_MISSING", "description": "资产 string 不是合法 JSON；消息以 AI_DSL_PROMPT_ASSET_INVALID_JSON 开头，HTTP 状态为 500。" },
 *     { "code": "BLOCK_AI_CONFIG_MISSING", "description": "解析结果顶层不是非数组 object；消息以 AI_DSL_PROMPT_ASSET_INVALID_DOCUMENT 开头，HTTP 状态为 500。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "source", "type": "string", "value": "assets:server/mokelay-schema", "description": "通过 Nitro storage 读取随服务端构建打包的本地资产，不访问 R2 或数据库。" },
 *     { "key": "async", "type": "boolean", "value": true, "description": "异步读取 Nitro storage。" },
 *     { "key": "pathIsolation", "type": "boolean", "value": true, "description": "目录固定为 mokelay-schema，调用方只能选择安全文件名。" },
 *     { "key": "schemaValidation", "type": "boolean", "value": false, "description": "只校验 JSON 可解析且顶层为 object，不编译或执行 JSON Schema。" }
 *   ],
 *   "examples": [
 *     { "title": "读取响应 Schema", "block": { "uuid": "read_generation_response_schema", "functionName": "readAiDslPromptAsset", "inputs": { "fileName": "generation-response.schema.json" }, "outputs": ["document"], "nextBlock": null } },
 *     { "title": "读取 Page/API DSL Schema", "block": { "uuid": "read_page_api_dsl_schema", "functionName": "readAiDslPromptAsset", "inputs": { "fileName": "page-api-dsl.schema.json" }, "outputs": ["document"], "nextBlock": "read_generation_response_schema" } }
 *   ]
 * }
 */
export const executeReadAiDslPromptAssetBlock: BlockExecutor = async ({ inputs }) => {
  return {
    document: await readAiDslPromptAsset(inputs.fileName),
  }
}
