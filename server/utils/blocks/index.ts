import type { BlockDefinition } from 'mokelay-server-core/utils/orchestration-schema'
import {
  executeAssertApiDefinitionsDeletableBlock,
  executeValidateApiDefinitionBlock,
} from './apiDefinitions'
import { executeReadAiDslPromptAssetBlock } from './readAiDslPromptAsset'
import { executeListMokelayApiJsonsBlock } from './listMokelayApiJsons'
import { executeListMokelayLayoutJsonsBlock } from './listMokelayLayoutJsons'
import { executeListMokelayPageJsonsBlock } from './listMokelayPageJsons'
import { executeReadMokelayApiJsonBlock } from './readMokelayApiJson'
import { executeReadMokelayLayoutJsonBlock } from './readMokelayLayoutJson'
import { executeReadMokelayPageJsonBlock } from './readMokelayPageJson'
import { executeResolveLayoutBundleBlock } from './resolveLayoutBundle'
import { executeSaveAiDslAssetsBlock } from './saveAiDslAssets'
import {
  executeDeletePageRelationsBlock,
  executeNormalizePageUuidBlock,
  executeNormalizePageRowsBlock,
  executeSavePageRelationsBlock,
} from './pageRelationBlocks'
import {
  executeReadImageFromR2Block,
  executeSaveImageToR2Block,
} from './r2Image'
import { executeRequireTenantContextBlock } from './tenantContext'

export const serverBlockDefinitions: Readonly<Record<string, BlockDefinition>> = {
  requireTenantContext: {
    executor: executeRequireTenantContextBlock,
    allowedOutputs: ['enterpriseUuid', 'appUuid'],
    requiresDatasource: true,
  },
  validateApiDefinition: {
    executor: executeValidateApiDefinitionBlock,
    allowedOutputs: ['method', 'fragment'],
    requiresDatasource: true,
  },
  assertApiDefinitionsDeletable: {
    executor: executeAssertApiDefinitionsDeletableBlock,
    allowedOutputs: [],
    requiresDatasource: true,
  },
  readAiDslPromptAsset: {
    executor: executeReadAiDslPromptAssetBlock,
    allowedOutputs: ['document'],
  },
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
    requiresDatasource: true,
  },
  readMokelayPageJson: {
    executor: executeReadMokelayPageJsonBlock,
    allowedOutputs: ['page'],
    requiresDatasource: true,
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
  saveAiDslAssets: {
    executor: executeSaveAiDslAssetsBlock,
    allowedOutputs: ['saveSummary'],
    requiresDatasource: true,
  },
  savePageRelations: {
    executor: executeSavePageRelationsBlock,
    allowedOutputs: ['affected', 'page'],
    requiresDatasource: true,
  },
  deletePageRelations: {
    executor: executeDeletePageRelationsBlock,
    allowedOutputs: ['affected'],
    requiresDatasource: true,
  },
  normalizePageRows: {
    executor: executeNormalizePageRowsBlock,
    allowedOutputs: ['pages', 'page', 'affected', 'pageSize', 'total', 'totalPages', 'hasPreviousPage', 'hasNextPage'],
  },
  normalizePageUuid: {
    executor: executeNormalizePageUuidBlock,
    allowedOutputs: ['uuid'],
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
