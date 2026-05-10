import { getRouterParam } from 'h3'
import { defineOrchestrationApiRoute } from '../../../../../utils/orchestration-api-route'
import { assertOrchestrationApiUuid, getApiDetail } from '../../../../../utils/orchestration-api-store'
import { mokelayError } from '../../../../../utils/mokelay-error'

export default defineOrchestrationApiRoute(async (event) => {
  const uuid = assertOrchestrationApiUuid(getRouterParam(event, 'apiUuid'))
  const api = await getApiDetail(uuid)

  if (!api) {
    throw mokelayError('API_MANAGEMENT_NOT_FOUND', 'API JSON not found.', 404)
  }

  return {
    versions: api.versions,
  }
})
