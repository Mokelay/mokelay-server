import { describe, expect, it } from 'vitest'
import { findDangerousBlocks, normalizeApiBuilderPayload } from '../../server/utils/orchestration-api-management'

describe('orchestration API management helpers', () => {
  it('normalizes builder payloads into valid API JSON for the target uuid', () => {
    const payload = normalizeApiBuilderPayload('visual_test', {
      apiJson: {
        uuid: 'other',
        alias: 'Visual test',
        method: 'post',
        blocks: [],
        response: null,
      },
    })

    expect(payload.apiJson).toMatchObject({
      uuid: 'visual_test',
      alias: 'Visual test',
      method: 'POST',
      request: {
        header: [],
        query: [],
        body: [],
      },
      blocks: [],
      response: null,
    })
  })

  it('flags update and delete blocks without conditions as dangerous', () => {
    expect(findDangerousBlocks({
      uuid: 'dangerous',
      method: 'POST',
      blocks: [
        {
          uuid: 'update_all',
          functionName: 'update',
          inputs: {
            datasource: 'Mokelay',
            table: 'users',
            fields: { plan: 'free' },
          },
        },
        {
          uuid: 'delete_one',
          functionName: 'delete',
          inputs: {
            datasource: 'Mokelay',
            table: 'users',
            conditions: [
              {
                group: false,
                conditionType: 'EQ',
                fieldName: 'id',
                fieldValue: '1',
              },
            ],
          },
        },
      ],
    })).toEqual([
      {
        uuid: 'update_all',
        functionName: 'update',
        alias: '',
      },
    ])
  })
})
