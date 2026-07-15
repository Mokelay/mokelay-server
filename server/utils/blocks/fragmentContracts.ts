import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import { parseApiJson } from 'mokelay-server-core/utils/orchestration-schema'

export type ExecuteFragmentCall = {
  fragmentUuid: string
  params: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeJson(value: unknown) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  }
  catch {
    return undefined
  }
}

function processorName(value: unknown) {
  if (typeof value === 'string') return value
  return isRecord(value) && typeof value.processor === 'string' ? value.processor : undefined
}

export function executeFragmentCalls(apiJson: unknown) {
  if (!isRecord(apiJson) || !Array.isArray(apiJson.blocks)) return []
  const calls: ExecuteFragmentCall[] = []

  for (const block of apiJson.blocks) {
    if (!isRecord(block) || block.functionName !== 'executeFragment' || !isRecord(block.inputs)) continue
    if (typeof block.inputs.fragmentUuid !== 'string' || !isRecord(block.inputs.params)) continue
    calls.push({
      fragmentUuid: block.inputs.fragmentUuid,
      params: block.inputs.params,
    })
  }

  return calls
}

function fragmentParamContract(fragmentUuid: string, apiJson: unknown) {
  const parsed = parseApiJson(fragmentUuid, normalizeJson(apiJson))
  if (parsed.fragment !== true) {
    throw mokelayError('API_JSON_INVALID_FLOW', `${fragmentUuid} 不是 Fragment。`, 409)
  }

  const declared = new Set<string>()
  const required = new Set<string>()
  for (const declaration of parsed.params) {
    if (typeof declaration === 'string') {
      declared.add(declaration)
      required.add(declaration)
      continue
    }

    declared.add(declaration.key)
    if (declaration.processors.some(processor => processorName(processor) === 'is_not_null')) {
      required.add(declaration.key)
    }
  }

  return { declared, required }
}

export function assertFragmentCallParams(
  callerUuid: string,
  call: ExecuteFragmentCall,
  fragmentApiJson: unknown,
) {
  const contract = fragmentParamContract(call.fragmentUuid, fragmentApiJson)
  const mapped = new Set(Object.keys(call.params))
  const unknown = [...mapped].filter(key => !contract.declared.has(key)).sort()
  const missing = [...contract.required].filter(key => !mapped.has(key)).sort()

  if (unknown.length > 0 || missing.length > 0) {
    const details = [
      unknown.length > 0 ? `未声明参数：${unknown.join(', ')}` : '',
      missing.length > 0 ? `缺少必填参数：${missing.join(', ')}` : '',
    ].filter(Boolean).join('；')
    throw mokelayError(
      'API_JSON_INVALID_FLOW',
      `API ${callerUuid} 调用 Fragment ${call.fragmentUuid} 的 params 不符合契约（${details}）。`,
      409,
    )
  }
}
