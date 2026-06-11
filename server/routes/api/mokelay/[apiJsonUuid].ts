import { createMokelayOrchestrationHandler } from 'mokelay-server-core/utils/orchestration'
import { serverBlockDefinitions } from '../../../utils/blocks'

export default createMokelayOrchestrationHandler({
  blockDefinitions: serverBlockDefinitions,
})
