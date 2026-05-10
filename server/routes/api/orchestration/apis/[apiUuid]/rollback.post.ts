import { getRouterParam } from 'h3'
import { readRecordBody } from '../../../../../utils/orchestration-api-management'
import { defineOrchestrationApiRoute } from '../../../../../utils/orchestration-api-route'
import { assertOrchestrationApiUuid, getApiDetail, rollbackApiVersion } from '../../../../../utils/orchestration-api-store'
import { mokelayError } from '../../../../../utils/mokelay-error'

export default defineOrchestrationApiRoute(async (event) => {
  const uuid = assertOrchestrationApiUuid(getRouterParam(event, 'apiUuid'))
  const body = await readRecordBody(event)
  const version = typeof body.version === 'number' ? body.version : Number(body.version)

  if (!Number.isSafeInteger(version) || version <= 0) {
    throw mokelayError('API_MANAGEMENT_INVALID_REQUEST', 'version 必须是正整数。', 400)
  }

  await rollbackApiVersion(uuid, version)

  return {
    api: await getApiDetail(uuid),
  }
})
