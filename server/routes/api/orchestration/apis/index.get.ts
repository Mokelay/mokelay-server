import { listApiSummaries } from '../../../../utils/orchestration-api-store'
import { defineOrchestrationApiRoute } from '../../../../utils/orchestration-api-route'

export default defineOrchestrationApiRoute(async () => {
  const apis = await listApiSummaries()

  return { apis }
})
