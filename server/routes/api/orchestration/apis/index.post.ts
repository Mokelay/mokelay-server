import { readRecordBody, normalizeApiBuilderPayload } from '../../../../utils/orchestration-api-management'
import { defineOrchestrationApiRoute } from '../../../../utils/orchestration-api-route'
import { assertOrchestrationApiUuid, getApiDetail, readBundledApiJson, saveApiDraft } from '../../../../utils/orchestration-api-store'
import { mokelayError } from '../../../../utils/mokelay-error'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createDefaultApiJson(uuid: string, body: Record<string, unknown>) {
  return {
    uuid,
    alias: typeof body.alias === 'string' ? body.alias : '',
    method: typeof body.method === 'string' ? body.method.toUpperCase() : 'GET',
    request: {
      header: [],
      query: [],
      body: [],
    },
    blocks: [],
    response: null,
  }
}

export default defineOrchestrationApiRoute(async (event) => {
  const body = await readRecordBody(event)
  const uuid = assertOrchestrationApiUuid(typeof body.uuid === 'string' ? body.uuid : undefined)
  const sourceUuid = typeof body.sourceUuid === 'string' ? body.sourceUuid : ''
  const sourceApiJson = sourceUuid ? await readBundledApiJson(sourceUuid) : undefined
  const apiJsonInput = isRecord(body.apiJson)
    ? body.apiJson
    : sourceApiJson
      ? { ...sourceApiJson, uuid }
      : createDefaultApiJson(uuid, body)

  if (sourceUuid && !sourceApiJson) {
    throw mokelayError('API_MANAGEMENT_NOT_FOUND', 'Source API JSON not found.', 404)
  }

  const payload = normalizeApiBuilderPayload(uuid, {
    apiJson: apiJsonInput,
    builderState: isRecord(body.builderState) ? body.builderState : { apiJson: apiJsonInput },
  })
  await saveApiDraft({ uuid, ...payload })

  return {
    api: await getApiDetail(uuid),
  }
})
