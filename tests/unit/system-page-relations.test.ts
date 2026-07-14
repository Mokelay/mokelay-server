import type { SQL } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { readMokelayPageJson } from '../../server/utils/blocks/readMokelayPageJson'
import { mergeSystemPageRelations } from '../../server/utils/pageRelationStore'

describe('system page dynamic quotes', () => {
  it('merges user-to-system parents with static system parents in one graph read', async () => {
    const userUuid = '55555555-5555-4555-8555-555555555555'
    const page = await readMokelayPageJson('mokelay_api_create_page') as Record<string, unknown>
    const executeSql = (async (_query: SQL) => ({
      databaseType: 'postgres' as const,
      rows: [{
        uuid: userUuid,
        name: 'User parent',
        blocks: [{
          action: 'open_dialog',
          inputs: { pageUUID: 'mokelay_api_create_page', pageSource: 'system' },
        }],
        sub_page: false,
        quotes: [],
        dependencies: ['mokelay_api_create_page'],
      }],
    })) as unknown as SqlExecutor

    const [merged] = await mergeSystemPageRelations([page], executeSql)
    expect(merged).toMatchObject({
      subPage: true,
      quotes: [userUuid, 'apis', 'mokelay_apis_user_page'],
    })
  })
})
