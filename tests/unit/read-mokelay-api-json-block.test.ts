import { describe, expect, it } from 'vitest'
import {
  readMokelayApiJson,
} from '../../server/utils/blocks/readMokelayApiJson'
import type { MokelayApiAssetStorage } from '../../server/utils/blocks/listMokelayApiJsons'

function apiJson(uuid: string) {
  return {
    uuid,
    alias: `${uuid} API`,
    method: 'GET',
    blocks: [{ uuid: 'starter', nextBlock: null }],
  }
}

function storage(values: Record<string, unknown>): MokelayApiAssetStorage {
  return {
    getKeys: async () => Object.keys(values),
    getItem: async (key) => values[key],
  }
}

describe('readMokelayApiJson', () => {
  it('reads and validates a built-in API DSL by UUID', async () => {
    const expected = apiJson('alpha')

    await expect(readMokelayApiJson('alpha', false, storage({
      'mokelay-apis/alpha.json': JSON.stringify(expected),
    }))).resolves.toEqual(expected)
  })

  it('reads and validates a built-in Fragment from the nested directory', async () => {
    const expected = {
      uuid: 'shared_logic',
      fragment: true,
      params: ['name'],
      blocks: [{ uuid: 'starter', nextBlock: null }],
      response: { name: { template: '{{params.name}}' } },
    }

    await expect(readMokelayApiJson('shared_logic', true, storage({
      'mokelay-apis/fragment/shared_logic.json': expected,
    }))).resolves.toEqual(expected)
  })

  it('keeps root API and nested Fragment selectors isolated when they share a UUID', async () => {
    const endpoint = apiJson('same_name')
    const fragment = {
      uuid: 'same_name',
      fragment: true,
      params: [],
      blocks: [{ uuid: 'starter', nextBlock: null }],
      response: { source: 'fragment' },
    }
    const assetStorage = storage({
      'mokelay-apis/same_name.json': endpoint,
      'mokelay-apis/fragment/same_name.json': fragment,
    })

    await expect(readMokelayApiJson('same_name', false, assetStorage)).resolves.toEqual(endpoint)
    await expect(readMokelayApiJson('same_name', true, assetStorage)).resolves.toEqual(fragment)
  })

  it('rejects an invalid UUID', async () => {
    await expect(readMokelayApiJson('../alpha', false, storage({}))).rejects.toMatchObject({
      data: { code: 'API_JSON_UUID_INVALID' },
      statusCode: 400,
    })
  })

  it('returns not found when the asset does not exist', async () => {
    await expect(readMokelayApiJson('missing', false, storage({}))).rejects.toMatchObject({
      data: { code: 'API_JSON_NOT_FOUND' },
      statusCode: 404,
    })
  })
})
