import { getRouterParam } from 'h3'
import { assertDangerAccepted, executeApiJsonTest, normalizeApiBuilderPayload, readRecordBody } from '../../../../../utils/orchestration-api-management'
import { defineOrchestrationApiRoute } from '../../../../../utils/orchestration-api-route'
import { assertOrchestrationApiUuid, getApiDetail } from '../../../../../utils/orchestration-api-store'
import { mokelayError } from '../../../../../utils/mokelay-error'

export default defineOrchestrationApiRoute(async (event) => {
  const uuid = assertOrchestrationApiUuid(getRouterParam(event, 'apiUuid'))
  const body = await readRecordBody(event)
  const apiDetail = await getApiDetail(uuid)
  const rawApiJson = body.apiJson ?? apiDetail?.draftJson

  if (!rawApiJson) {
    throw mokelayError('API_MANAGEMENT_NOT_FOUND', 'API JSON not found.', 404)
  }

  const payload = normalizeApiBuilderPayload(uuid, { apiJson: rawApiJson })
  assertDangerAccepted(payload.apiJson, body.dangerAccepted)

  return await executeApiJsonTest(event, uuid, payload.apiJson, body.request)
})
