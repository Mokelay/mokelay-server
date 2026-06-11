import type { BlockDefinition } from 'mokelay-server-core/utils/orchestration-schema'
import { executeListMokelayApiJsonsBlock } from './listMokelayApiJsons'
import { executeReadMokelayApiJsonBlock } from './readMokelayApiJson'

export const serverBlockDefinitions: Readonly<Record<string, BlockDefinition>> = {
  listMokelayApiJsons: {
    executor: executeListMokelayApiJsonsBlock,
    allowedOutputs: ['apis', 'count'],
  },
  readMokelayApiJson: {
    executor: executeReadMokelayApiJsonBlock,
    allowedOutputs: ['api'],
  },
}
