import { defineEventHandler, getRouterParam } from 'h3'
import { createMokelayOrchestrationHandler } from 'mokelay-server-core/utils/orchestration'
import { serverBlockDefinitions } from '../../../utils/blocks'

export default defineEventHandler(event => createMokelayOrchestrationHandler({
  assetApp: getRouterParam(event, 'app'),
  blockDefinitions: serverBlockDefinitions,
})(event))
