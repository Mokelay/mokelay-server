import { describe, expect, it } from 'vitest'
import type { MokelayApiAssetStorage } from '../../server/utils/blocks/listMokelayApiJsons'
import { listMokelayLayoutJsons } from '../../server/utils/blocks/listMokelayLayoutJsons'
import { readMokelayLayoutJson } from '../../server/utils/blocks/readMokelayLayoutJson'

function layoutJson(uuid: string, name: string) {
  return {
    uuid,
    name,
    schemaVersion: 1,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    blocks: [
      {
        id: 'page-slot',
        type: 'MPageSlot',
        data: {
          name: 'default',
        },
      },
    ],
  }
}

function layoutRecord(uuid: string, name: string) {
  const layout = layoutJson(uuid, name)
  return {
    uuid,
    name,
    layoutJson: layout,
    createdAt: layout.createdAt,
    updatedAt: layout.updatedAt,
  }
}

function storage(keys: string[], values: Record<string, unknown>): MokelayApiAssetStorage {
  return {
    getKeys: async () => keys,
    getItem: async (key) => values[key],
  }
}

describe('listMokelayLayoutJsons', () => {
  it('reads top-level layout JSON assets and sorts by file name', async () => {
    const alpha = layoutJson('alpha_layout', 'Alpha Layout')
    const zeta = layoutJson('zeta_layout', 'Zeta Layout')
    const result = await listMokelayLayoutJsons(storage([
      'mokelay-layouts:zeta_layout.json',
      'mokelay-layouts:nested/ignored.json',
      'mokelay-layouts:notes.txt',
      'other:outside.json',
      'mokelay-layouts:alpha_layout.json',
    ], {
      'mokelay-layouts:zeta_layout.json': JSON.stringify(zeta),
      'mokelay-layouts:alpha_layout.json': alpha,
    }))

    expect(result).toEqual({
      layouts: [
        layoutRecord('alpha_layout', 'Alpha Layout'),
        layoutRecord('zeta_layout', 'Zeta Layout'),
      ],
      count: 2,
    })
  })

  it('fails when a layout asset is invalid JSON', async () => {
    await expect(listMokelayLayoutJsons(storage(
      ['mokelay-layouts:broken.json'],
      { 'mokelay-layouts:broken.json': '{not-json' },
    ))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_JSON' },
      statusCode: 400,
    })
  })

  it('fails when the file name and layout UUID differ', async () => {
    await expect(listMokelayLayoutJsons(storage(
      ['mokelay-layouts:expected.json'],
      { 'mokelay-layouts:expected.json': layoutJson('different', 'Different Layout') },
    ))).rejects.toMatchObject({
      data: { code: 'API_JSON_UUID_MISMATCH' },
      statusCode: 400,
    })
  })
})

describe('readMokelayLayoutJson', () => {
  it('reads one layout JSON asset by UUID', async () => {
    const layout = layoutJson('alpha_layout', 'Alpha Layout')

    await expect(readMokelayLayoutJson('alpha_layout', storage([], {
      'mokelay-layouts/alpha_layout.json': JSON.stringify(layout),
    }))).resolves.toEqual(layoutRecord('alpha_layout', 'Alpha Layout'))
  })

  it('fails when the layout asset is missing', async () => {
    await expect(readMokelayLayoutJson('missing_layout', storage([], {}))).rejects.toMatchObject({
      data: { code: 'API_JSON_NOT_FOUND' },
      statusCode: 404,
    })
  })
})
