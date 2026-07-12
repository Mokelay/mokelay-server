import { describe, expect, it } from 'vitest'
import type { MokelayApiAssetStorage } from '../../server/utils/blocks/listMokelayApiJsons'
import { readAiDslPromptAsset } from '../../server/utils/blocks/readAiDslPromptAsset'

function storage(values: Record<string, unknown>): MokelayApiAssetStorage {
  return {
    getKeys: async () => Object.keys(values),
    getItem: async (key) => values[key],
  }
}

describe('readAiDslPromptAsset', () => {
  it('reads JSON string and object assets from the mokelay-schema directory', async () => {
    const pageApiSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'urn:mokelay:schema:page-api-dsl:1',
    }
    const responseSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'urn:mokelay:schema:ai-dsl-generation-response:1',
    }
    const assetStorage = storage({
      'mokelay-schema/page-api-dsl.schema.json': JSON.stringify(pageApiSchema),
      'mokelay-schema/generation-response.schema.json': responseSchema,
    })

    await expect(readAiDslPromptAsset('page-api-dsl.schema.json', assetStorage))
      .resolves.toEqual(pageApiSchema)
    await expect(readAiDslPromptAsset('generation-response.schema.json', assetStorage))
      .resolves.toEqual(responseSchema)
  })

  it.each([
    '',
    '../schema.json',
    'nested/schema.json',
    'nested\\schema.json',
    'schema..json',
    'schema.txt',
  ])('rejects the unsafe file name %j', async (fileName) => {
    await expect(readAiDslPromptAsset(fileName, storage({}))).rejects.toMatchObject({
      data: { code: 'BLOCK_AI_INPUT_INVALID' },
      message: expect.stringContaining('AI_DSL_PROMPT_ASSET_NAME_INVALID'),
      statusCode: 400,
    })
  })

  it('returns a distinct error when the asset is missing', async () => {
    await expect(readAiDslPromptAsset('missing.json', storage({}))).rejects.toMatchObject({
      data: { code: 'BLOCK_AI_CONFIG_MISSING' },
      message: expect.stringContaining('AI_DSL_PROMPT_ASSET_NOT_FOUND'),
      statusCode: 500,
    })
  })

  it('returns a distinct error when the asset contains invalid JSON', async () => {
    await expect(readAiDslPromptAsset('invalid.json', storage({
      'mokelay-schema/invalid.json': '{invalid',
    }))).rejects.toMatchObject({
      data: { code: 'BLOCK_AI_CONFIG_MISSING' },
      message: expect.stringContaining('AI_DSL_PROMPT_ASSET_INVALID_JSON'),
      statusCode: 500,
    })
  })

  it('returns a distinct error when the JSON top level is not an object', async () => {
    await expect(readAiDslPromptAsset('array.json', storage({
      'mokelay-schema/array.json': '[]',
    }))).rejects.toMatchObject({
      data: { code: 'BLOCK_AI_CONFIG_MISSING' },
      message: expect.stringContaining('AI_DSL_PROMPT_ASSET_INVALID_DOCUMENT'),
      statusCode: 500,
    })
  })
})
