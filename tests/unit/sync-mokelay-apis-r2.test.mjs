import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { syncMokelayApisToR2 } from '../../scripts/sync-mokelay-apis-r2.mjs'

const r2Env = {
  CLOUDFLARE_R2_ACCOUNT_ID: 'account-id',
  CLOUDFLARE_R2_ACCESS_KEY_ID: 'access-key-id',
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret-access-key',
  MOKELAY_APIS_R2_BUCKET: 'mokelay-api-json',
  MOKELAY_APIS_R2_PREFIX: 'mokelay-apis',
}

let tempDir
const defaultApiJsonDir = new URL('../../server/assets/mokelay-apis/', import.meta.url)

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

describe('syncMokelayApisToR2', () => {
  it('uploads the repo API JSON files to Cloudflare R2 object keys', async () => {
    const sentInputs = []
    const client = {
      send: async (command) => {
        sentInputs.push(command.input)
        return {}
      },
    }

    const result = await syncMokelayApisToR2({
      env: r2Env,
      client,
      log: null,
    })

    const expectedCount = (await readdir(defaultApiJsonDir))
      .filter((fileName) => fileName.endsWith('.json'))
      .length

    expect(result.count).toBe(expectedCount)
    expect(result.keys).toContain('mokelay-apis/analyze-data-source.json')
    expect(result.keys).toContain('mokelay-apis/ai-generate-dsl.json')
    expect(result.keys).toContain('mokelay-apis/ai-translate.json')
    expect(result.keys).toContain('mokelay-apis/batch_delete_apis.json')
    expect(result.keys).toContain('mokelay-apis/create_app.json')
    expect(result.keys).toContain('mokelay-apis/delete_api_by_uuid.json')
    expect(result.keys).toContain('mokelay-apis/list_apis.json')
    expect(result.keys).toContain('mokelay-apis/list_apps.json')
    expect(result.keys).toContain('mokelay-apis/login.json')
    expect(result.keys).toContain('mokelay-apis/read_api_by_uuid.json')
    expect(result.keys).toContain('mokelay-apis/save_api.json')
    expect(result.keys).toContain('mokelay-apis/update_page_blocks_by_uuid.json')
    expect(result.keys).not.toContain('mokelay-apis/fragment/provision_new_user.json')
    expect(new Set(result.keys)).toHaveProperty('size', expectedCount)
    expect(sentInputs).toHaveLength(expectedCount)
    expect(sentInputs.every((input) => input.Bucket === 'mokelay-api-json')).toBe(true)
    expect(sentInputs.every((input) => input.ContentType === 'application/json')).toBe(true)
  })

  it('validates uuid before uploading any file', async () => {
    const sentInputs = []

    tempDir = await mkdtemp(join(tmpdir(), 'mokelay-api-json-'))
    await writeFile(join(tempDir, 'bad.json'), JSON.stringify({
      uuid: 'not_bad',
      method: 'GET',
      blocks: [],
      response: null,
    }))

    await expect(syncMokelayApisToR2({
      apiJsonDir: tempDir,
      env: r2Env,
      client: {
        send: async (command) => {
          sentInputs.push(command.input)
          return {}
        },
      },
      log: null,
    })).rejects.toThrow('bad.json uuid must equal "bad".')
    expect(sentInputs).toHaveLength(0)
  })
})
