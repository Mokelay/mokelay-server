import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

    expect(result.count).toBe(22)
    expect(result.keys).toContain('mokelay-apis/login.json')
    expect(result.keys).toContain('mokelay-apis/update_page_blocks_by_uuid.json')
    expect(new Set(result.keys)).toHaveProperty('size', 22)
    expect(sentInputs).toHaveLength(22)
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
