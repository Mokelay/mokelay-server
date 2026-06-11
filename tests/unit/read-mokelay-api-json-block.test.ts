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

    await expect(readMokelayApiJson('alpha', storage({
      'mokelay-apis/alpha.json': JSON.stringify(expected),
    }))).resolves.toEqual(expected)
  })

  it('rejects an invalid UUID', async () => {
    await expect(readMokelayApiJson('../alpha', storage({}))).rejects.toMatchObject({
      data: { code: 'API_JSON_UUID_INVALID' },
      statusCode: 400,
    })
  })

  it('returns not found when the asset does not exist', async () => {
    await expect(readMokelayApiJson('missing', storage({}))).rejects.toMatchObject({
      data: { code: 'API_JSON_NOT_FOUND' },
      statusCode: 404,
    })
  })
})
