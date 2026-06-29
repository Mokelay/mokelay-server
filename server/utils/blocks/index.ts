import type { BlockDefinition } from 'mokelay-server-core/utils/orchestration-schema'
import { executeListMokelayApiJsonsBlock } from './listMokelayApiJsons'
import { executeListMokelayLayoutJsonsBlock } from './listMokelayLayoutJsons'
import { executeListMokelayPageJsonsBlock } from './listMokelayPageJsons'
import { executeReadMokelayApiJsonBlock } from './readMokelayApiJson'
import { executeReadMokelayLayoutJsonBlock } from './readMokelayLayoutJson'
import { executeReadMokelayPageJsonBlock } from './readMokelayPageJson'
import { executeResolveLayoutBundleBlock } from './resolveLayoutBundle'
import {
  executeReadImageFromR2Block,
  executeSaveImageToR2Block,
} from './r2Image'

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
  listMokelayLayoutJsons: {
    executor: executeListMokelayLayoutJsonsBlock,
    allowedOutputs: ['layouts', 'count'],
  },
  readMokelayLayoutJson: {
    executor: executeReadMokelayLayoutJsonBlock,
    allowedOutputs: ['layout'],
  },
  resolveLayoutBundle: {
    executor: executeResolveLayoutBundleBlock,
    allowedOutputs: ['page', 'layout'],
    requiresDatasource: true,
  },
  saveImageToR2: {
    executor: executeSaveImageToR2Block,
    allowedOutputs: ['key', 'directory', 'fileName', 'bucket', 'size', 'mimeType', 'url', 'dataUrl', 'etag'],
  },
  readImageFromR2: {
    executor: executeReadImageFromR2Block,
    allowedOutputs: ['key', 'directory', 'fileName', 'bucket', 'size', 'mimeType', 'url', 'dataUrl', 'etag'],
  },
}
