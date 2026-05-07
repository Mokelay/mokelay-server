import { afterEach, describe, expect, it, vi } from 'vitest'

describe('loadApiJson', () => {
  afterEach(() => {
    vi.doUnmock('nitropack/runtime')
    vi.resetModules()
  })

  it('uses parsed objects returned by Nitro server assets', async () => {
    const apiJson = {
      uuid: 'from_nitro_assets',
      method: 'POST',
      blocks: [],
      response: null,
    }

    vi.doMock('nitropack/runtime', () => ({
      useStorage: (base: string) => ({
        getItem: async (key: string) => {
          expect(base).toBe('assets:server')
          expect(key).toBe('mokelay-apis/from_nitro_assets.json')

          return apiJson
        },
      }),
    }))

    const { loadApiJson } = await import('../../server/utils/orchestration')

    await expect(loadApiJson('from_nitro_assets')).resolves.toEqual(apiJson)
  })
})
