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
 *   "description": "从 Nitro server assets 的 mokelay-schema 目录读取 JSON Prompt 规范资产。",
 *   "inputs": [
 *     { "key": "fileName", "type": "string", "required": true, "description": "mokelay-schema 目录下不含路径的安全 .json 文件名。" }
 *   ],
 *   "outputs": [
 *     { "key": "document", "type": "Record<string, unknown>", "description": "解析后的 JSON object。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_AI_INPUT_INVALID", "description": "fileName 非法；消息以 AI_DSL_PROMPT_ASSET_NAME_INVALID 开头。" },
 *     { "code": "BLOCK_AI_CONFIG_MISSING", "description": "资产缺失、JSON 非法或顶层不是 object；消息分别以对应的 AI_DSL_PROMPT_ASSET_* 原因开头。" }
 *   ],
 *   "config": [],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "source", "type": "string", "value": "assets:server/mokelay-schema", "description": "通过 Nitro storage 读取打包后的服务端资产。" }
 *   ],
 *   "examples": [
 *     { "title": "读取响应 Schema", "block": { "uuid": "read_generation_response_schema", "functionName": "readAiDslPromptAsset", "inputs": { "fileName": "generation-response.schema.json" }, "outputs": ["document"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeReadAiDslPromptAssetBlock: BlockExecutor = async ({ inputs }) => {
  return {
    document: await readAiDslPromptAsset(inputs.fileName),
  }
}
