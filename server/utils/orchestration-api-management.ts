import { readBody, type H3Event } from 'h3'
import { executeApiJson, parseApiJson, type OrchestrationTrace } from './orchestration'
import { mokelayError, toMokelayErrorResponse } from './mokelay-error'

export type ApiBuilderPayload = {
  apiJson: Record<string, unknown>
  builderState: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export async function readRecordBody(event: H3Event) {
  const body = await readBody(event)

  if (!isRecord(body)) {
    throw mokelayError('API_MANAGEMENT_INVALID_REQUEST', '请求 body 必须是 JSON 对象。', 400)
  }

  return body
}

export function normalizeApiBuilderPayload(uuid: string, value: unknown): ApiBuilderPayload {
  const body = asRecord(value)
  const rawApiJson = asRecord(body.apiJson ?? body)
  const apiJson = {
    ...rawApiJson,
    uuid,
    method: typeof rawApiJson.method === 'string' && rawApiJson.method.trim()
      ? rawApiJson.method.trim().toUpperCase()
      : 'GET',
  }
  const parsed = parseApiJson(uuid, apiJson) as unknown as Record<string, unknown>
  const builderState = isRecord(body.builderState)
    ? body.builderState
    : { apiJson: parsed }

  return {
    apiJson: parsed,
    builderState,
  }
}

export function findDangerousBlocks(apiJson: Record<string, unknown>) {
  const blocks = Array.isArray(apiJson.blocks) ? apiJson.blocks : []

  return blocks
    .filter(isRecord)
    .filter((block) => {
      if (block.functionName !== 'update' && block.functionName !== 'delete') {
        return false
      }

      const inputs = asRecord(block.inputs)
      return !Array.isArray(inputs.conditions) || inputs.conditions.length === 0
    })
    .map((block) => ({
      uuid: typeof block.uuid === 'string' ? block.uuid : '',
      functionName: typeof block.functionName === 'string' ? block.functionName : '',
      alias: typeof block.alias === 'string' ? block.alias : '',
    }))
}

export function assertDangerAccepted(apiJson: Record<string, unknown>, dangerAccepted: unknown) {
  const dangerousBlocks = findDangerousBlocks(apiJson)

  if (dangerousBlocks.length > 0 && dangerAccepted !== true) {
    throw mokelayError(
      'API_DANGEROUS_BLOCKS',
      '存在无条件 update/delete block，发布或测试前需要确认危险操作。',
      400,
    )
  }
}

export async function executeApiJsonTest(
  event: H3Event,
  uuid: string,
  apiJson: Record<string, unknown>,
  request: unknown,
) {
  const trace: OrchestrationTrace = { blocks: [] }

  try {
    const response = await executeApiJson(event, apiJson, {
      apiJsonUuid: uuid,
      method: typeof apiJson.method === 'string' ? apiJson.method : 'GET',
      request: asRecord(request),
      trace,
    })

    return {
      response,
      trace,
    }
  } catch (error) {
    return {
      response: toMokelayErrorResponse(error),
      trace,
    }
  }
}
