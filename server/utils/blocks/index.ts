import type { BlockDefinition } from 'mokelay-server-core/utils/orchestration-schema'
import { executeListMokelayApiJsonsBlock } from './listMokelayApiJsons'
import { executeListMokelayPageJsonsBlock } from './listMokelayPageJsons'
import { executeReadMokelayApiJsonBlock } from './readMokelayApiJson'
import { executeReadMokelayPageJsonBlock } from './readMokelayPageJson'
import { executeResolveLayoutBundleBlock } from './resolveLayoutBundle'

export const serverBlockDefinitions: Readonly<Record<string, BlockDefinition>> = {
  listMokelayApiJsons: {
    executor: executeListMokelayApiJsonsBlock,
    allowedOutputs: ['apis', 'count'],
  },
  readMokelayApiJson: {
    executor: executeReadMokelayApiJsonBlock,
    allowedOutputs: ['api'],
  },
  listMokelayPageJsons: {
    executor: executeListMokelayPageJsonsBlock,
    allowedOutputs: ['pages', 'count'],
  },
  readMokelayPageJson: {
    executor: executeReadMokelayPageJsonBlock,
    allowedOutputs: ['page'],
  },
  resolveLayoutBundle: {
    executor: executeResolveLayoutBundleBlock,
    allowedOutputs: ['page', 'layout'],
    requiresDatasource: true,
  },
}
