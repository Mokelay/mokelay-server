import { describe, expect, it } from 'vitest'
import {
  listMokelayApiJsons,
  type MokelayApiAssetStorage,
} from '../../server/utils/blocks/listMokelayApiJsons'

function apiJson(uuid: string, alias: string) {
  return {
    uuid,
    alias,
    method: 'GET',
    blocks: [{ uuid: 'starter', nextBlock: null }],
  }
}

function storage(keys: string[], values: Record<string, unknown>): MokelayApiAssetStorage {
  return {
    getKeys: async () => keys,
    getItem: async (key) => values[key],
  }
}

describe('listMokelayApiJsons', () => {
  it('reads top-level JSON assets, preserves raw objects, and sorts by file name', async () => {
    const alpha = apiJson('alpha', 'Alpha API')
    const zeta = apiJson('zeta', 'Zeta API')
    const result = await listMokelayApiJsons(storage([
      'mokelay-apis:zeta.json',
      'mokelay-apis:nested/ignored.json',
      'mokelay-apis:notes.txt',
      'other:outside.json',
      'mokelay-apis:alpha.json',
    ], {
      'mokelay-apis:zeta.json': JSON.stringify(zeta),
      'mokelay-apis:alpha.json': alpha,
    }))

    expect(result).toEqual({
      apis: [alpha, zeta],
      count: 2,
    })
    expect(result.apis[0]).not.toHaveProperty('request')
    expect(result.apis[0]).not.toHaveProperty('response')
  })

  it('fails the whole operation when an asset is invalid JSON', async () => {
    await expect(listMokelayApiJsons(storage(
      ['mokelay-apis:broken.json'],
      { 'mokelay-apis:broken.json': '{not-json' },
    ))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_JSON' },
      statusCode: 400,
    })
  })

  it('fails the whole operation when an asset has an invalid DSL schema', async () => {
    await expect(listMokelayApiJsons(storage(
      ['mokelay-apis:broken.json'],
      {
        'mokelay-apis:broken.json': {
          uuid: 'broken',
          blocks: [{ uuid: 'starter', nextBlock: null }],
        },
      },
    ))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_SCHEMA' },
      statusCode: 400,
    })
  })

  it('fails the whole operation when the file name and DSL UUID differ', async () => {
    await expect(listMokelayApiJsons(storage(
      ['mokelay-apis:expected.json'],
      { 'mokelay-apis:expected.json': apiJson('different', 'Different API') },
    ))).rejects.toMatchObject({
      data: { code: 'API_JSON_UUID_MISMATCH' },
      statusCode: 400,
    })
  })
})
