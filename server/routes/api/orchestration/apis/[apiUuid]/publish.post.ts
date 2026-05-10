import { getRouterParam } from 'h3'
import { assertDangerAccepted, normalizeApiBuilderPayload, readRecordBody } from '../../../../../utils/orchestration-api-management'
import { defineOrchestrationApiRoute } from '../../../../../utils/orchestration-api-route'
import { assertOrchestrationApiUuid, getApiDetail, publishApiDraft } from '../../../../../utils/orchestration-api-store'

export default defineOrchestrationApiRoute(async (event) => {
  const uuid = assertOrchestrationApiUuid(getRouterParam(event, 'apiUuid'))
  const body = await readRecordBody(event)
  const payload = normalizeApiBuilderPayload(uuid, body)

  assertDangerAccepted(payload.apiJson, body.dangerAccepted)

  const version = await publishApiDraft({
    uuid,
    ...payload,
    changeNote: typeof body.changeNote === 'string' ? body.changeNote : '',
  })

  return {
    version,
    api: await getApiDetail(uuid),
  }
})
