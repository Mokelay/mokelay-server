import { getRouterParam } from 'h3'
import { normalizeApiBuilderPayload, readRecordBody } from '../../../../../utils/orchestration-api-management'
import { defineOrchestrationApiRoute } from '../../../../../utils/orchestration-api-route'
import { assertOrchestrationApiUuid, getApiDetail, saveApiDraft } from '../../../../../utils/orchestration-api-store'

export default defineOrchestrationApiRoute(async (event) => {
  const uuid = assertOrchestrationApiUuid(getRouterParam(event, 'apiUuid'))
  const body = await readRecordBody(event)
  const payload = normalizeApiBuilderPayload(uuid, body)

  await saveApiDraft({ uuid, ...payload })

  return {
    api: await getApiDetail(uuid),
  }
})
