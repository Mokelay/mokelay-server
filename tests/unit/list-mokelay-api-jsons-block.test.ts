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

function fragmentJson(uuid: string) {
  return {
    uuid,
    alias: `${uuid} Fragment`,
    fragment: true,
    params: ['name'],
    blocks: [{ uuid: 'starter', nextBlock: null }],
    response: { name: { template: '{{params.name}}' } },
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
    const result = await listMokelayApiJsons(false, storage([
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

  it('includes nested built-in Fragments and preserves fragment metadata', async () => {
    const endpoint = {
      ...apiJson('calls_shared_logic', 'Caller'),
      blocks: [
        { uuid: 'starter', nextBlock: 'call_shared_logic' },
        {
          uuid: 'call_shared_logic',
          functionName: 'executeFragment',
          inputs: { fragmentUuid: 'shared_logic', params: { name: 'Mokelay' } },
          outputs: ['result'],
          nextBlock: null,
        },
      ],
    }
    const fragment = fragmentJson('shared_logic')
    const result = await listMokelayApiJsons(true, storage([
      'mokelay-apis:calls_shared_logic.json',
      'mokelay-apis:fragment/shared_logic.json',
    ], {
      'mokelay-apis:calls_shared_logic.json': endpoint,
      'mokelay-apis:fragment/shared_logic.json': fragment,
    }))

    expect(result).toEqual({ apis: [fragment], count: 1 })
    expect(result.apis[0]).toMatchObject({ uuid: 'shared_logic', fragment: true })
  })

  it('rejects a built-in caller whose Fragment target is not a nested built-in asset', async () => {
    const caller = {
      ...apiJson('invalid_system_caller', 'Invalid caller'),
      blocks: [
        { uuid: 'starter', nextBlock: 'call_database_only' },
        {
          uuid: 'call_database_only',
          functionName: 'executeFragment',
          inputs: { fragmentUuid: 'database_only', params: {} },
          outputs: ['result'],
          nextBlock: null,
        },
      ],
    }

    await expect(listMokelayApiJsons(false, storage(
      ['mokelay-apis:invalid_system_caller.json'],
      { 'mokelay-apis:invalid_system_caller.json': caller },
    ))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_FLOW' },
      message: expect.stringMatching(/只能引用.*mokelay-apis\/fragment.*database_only/),
    })
  })

  it('rejects a built-in caller whose params violate the nested Fragment contract', async () => {
    const caller = {
      ...apiJson('invalid_system_params', 'Invalid params'),
      blocks: [
        { uuid: 'starter', nextBlock: 'call_shared_logic' },
        {
          uuid: 'call_shared_logic',
          functionName: 'executeFragment',
          inputs: { fragmentUuid: 'shared_logic', params: { rogue: true } },
          outputs: ['result'],
          nextBlock: null,
        },
      ],
    }

    await expect(listMokelayApiJsons(false, storage([
      'mokelay-apis:invalid_system_params.json',
      'mokelay-apis:fragment/shared_logic.json',
    ], {
      'mokelay-apis:invalid_system_params.json': caller,
      'mokelay-apis:fragment/shared_logic.json': fragmentJson('shared_logic'),
    }))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_FLOW' },
      message: expect.stringMatching(/未声明参数：rogue.*缺少必填参数：name/),
    })
  })

  it('rejects a Fragment outside the dedicated nested directory', async () => {
    await expect(listMokelayApiJsons(false, storage(
      ['mokelay-apis:misplaced.json'],
      { 'mokelay-apis:misplaced.json': fragmentJson('misplaced') },
    ))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_SCHEMA' },
      message: expect.stringContaining('根目录'),
    })
  })

  it('fails the whole operation when an asset is invalid JSON', async () => {
    await expect(listMokelayApiJsons(false, storage(
      ['mokelay-apis:broken.json'],
      { 'mokelay-apis:broken.json': '{not-json' },
    ))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_JSON' },
      statusCode: 400,
    })
  })

  it('fails the whole operation when an asset has an invalid DSL schema', async () => {
    await expect(listMokelayApiJsons(false, storage(
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
    await expect(listMokelayApiJsons(false, storage(
      ['mokelay-apis:expected.json'],
      { 'mokelay-apis:expected.json': apiJson('different', 'Different API') },
    ))).rejects.toMatchObject({
      data: { code: 'API_JSON_UUID_MISMATCH' },
      statusCode: 400,
    })
  })
})
