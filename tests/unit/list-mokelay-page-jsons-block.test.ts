import { describe, expect, it } from 'vitest'
import type { MokelayApiAssetStorage } from '../../server/utils/blocks/listMokelayApiJsons'
import { listMokelayPageJsons } from '../../server/utils/blocks/listMokelayPageJsons'
import { readMokelayPageJson } from '../../server/utils/blocks/readMokelayPageJson'

function pageJson(uuid: string, name: string) {
  return {
    uuid,
    name,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    blocks: [],
  }
}

function storage(keys: string[], values: Record<string, unknown>): MokelayApiAssetStorage {
  return {
    getKeys: async () => keys,
    getItem: async (key) => values[key],
  }
}

describe('listMokelayPageJsons', () => {
  it('reads top-level page JSON assets and sorts by file name', async () => {
    const alpha = pageJson('alpha_page', 'Alpha Page')
    const zeta = pageJson('zeta_page', 'Zeta Page')
    const result = await listMokelayPageJsons(storage([
      'mokelay-pages:zeta_page.json',
      'mokelay-pages:nested/ignored.json',
      'mokelay-pages:notes.txt',
      'other:outside.json',
      'mokelay-pages:alpha_page.json',
    ], {
      'mokelay-pages:zeta_page.json': JSON.stringify(zeta),
      'mokelay-pages:alpha_page.json': alpha,
    }))

    expect(result).toEqual({
      pages: [alpha, zeta],
      count: 2,
    })
  })

  it('fails when a page asset is invalid JSON', async () => {
    await expect(listMokelayPageJsons(storage(
      ['mokelay-pages:broken.json'],
      { 'mokelay-pages:broken.json': '{not-json' },
    ))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_JSON' },
      statusCode: 400,
    })
  })

  it('fails when the file name and page UUID differ', async () => {
    await expect(listMokelayPageJsons(storage(
      ['mokelay-pages:expected.json'],
      { 'mokelay-pages:expected.json': pageJson('different', 'Different Page') },
    ))).rejects.toMatchObject({
      data: { code: 'API_JSON_UUID_MISMATCH' },
      statusCode: 400,
    })
  })
})

describe('readMokelayPageJson', () => {
  it('reads one page JSON asset by UUID', async () => {
    const page = pageJson('alpha_page', 'Alpha Page')

    await expect(readMokelayPageJson('alpha_page', storage([], {
      'mokelay-pages/alpha_page.json': JSON.stringify(page),
    }))).resolves.toEqual(page)
  })

  it('fails when the page asset is missing', async () => {
    await expect(readMokelayPageJson('missing_page', storage([], {}))).rejects.toMatchObject({
      data: { code: 'API_JSON_NOT_FOUND' },
      statusCode: 404,
    })
  })
})
