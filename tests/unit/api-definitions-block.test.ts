import type { SqlExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { describe, expect, it, vi } from 'vitest'
import {
  executeAssertApiDefinitionsDeletableBlock,
  executeValidateApiDefinitionBlock,
} from '../../server/utils/blocks/apiDefinitions'

function executorInput(inputs: Record<string, unknown>, executeSql: SqlExecutor) {
  return {
    event: undefined as never,
    block: undefined as never,
    inputs,
    executeSql,
    databaseType: 'postgres' as const,
    processValue: async (value: unknown) => value,
    invokeFragment: async () => ({}),
  }
}

describe('API/Fragment definition guards', () => {
  it('keeps incomplete draft orchestration saveable while normalizing metadata', async () => {
    const executeSql = vi.fn(async () => ({ databaseType: 'postgres' as const, rows: [] })) as unknown as SqlExecutor

    await expect(executeValidateApiDefinitionBlock(executorInput({
      datasource: 'Mokelay',
      uuid: 'draft_in_progress',
      method: 'get',
      fragment: false,
      status: 'draft',
      apiJson: {
        uuid: 'draft_in_progress',
        method: 'GET',
        blocks: [{ uuid: 'not_finished_yet' }],
      },
    }, executeSql))).resolves.toEqual({ method: 'GET', fragment: false })
  })

  it('strictly validates the same incomplete orchestration when publishing', async () => {
    const executeSql = vi.fn(async () => ({ databaseType: 'postgres' as const, rows: [] })) as unknown as SqlExecutor

    await expect(executeValidateApiDefinitionBlock(executorInput({
      datasource: 'Mokelay',
      uuid: 'invalid_publish',
      method: 'GET',
      fragment: false,
      status: 'published',
      apiJson: {
        uuid: 'invalid_publish',
        method: 'GET',
        blocks: [{ uuid: 'not_finished_yet' }],
      },
    }, executeSql))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_SCHEMA' },
    })
  })

  it('rejects a draft user caller whose Fragment target exists only as a built-in asset', async () => {
    const executeSql = vi.fn(async () => ({ databaseType: 'postgres' as const, rows: [] })) as unknown as SqlExecutor

    await expect(executeValidateApiDefinitionBlock(executorInput({
      datasource: 'Mokelay',
      uuid: 'draft_cross_source_caller',
      method: 'POST',
      fragment: false,
      status: 'draft',
      apiJson: {
        uuid: 'draft_cross_source_caller',
        method: 'POST',
        blocks: [
          { uuid: 'starter', nextBlock: 'call_builtin' },
          {
            uuid: 'call_builtin',
            functionName: 'executeFragment',
            inputs: { fragmentUuid: 'provision_new_user', params: {} },
            outputs: ['result'],
            nextBlock: null,
          },
        ],
      },
    }, executeSql))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_FLOW' },
      message: expect.stringContaining('不存在或类型不正确'),
    })
  })

  it('allows a draft user caller to reference a draft database Fragment', async () => {
    let queryCount = 0
    const executeSql = vi.fn(async () => {
      queryCount += 1
      return {
        databaseType: 'postgres' as const,
        rows: queryCount === 2
          ? [{ uuid: 'draft_database_fragment', fragment: true, status: 'draft', api_json: {} }]
          : [],
      }
    }) as unknown as SqlExecutor

    await expect(executeValidateApiDefinitionBlock(executorInput({
      datasource: 'Mokelay',
      uuid: 'draft_database_caller',
      method: 'POST',
      fragment: false,
      status: 'draft',
      apiJson: {
        uuid: 'draft_database_caller',
        method: 'POST',
        blocks: [
          { uuid: 'starter', nextBlock: 'call_draft_database_fragment' },
          {
            uuid: 'call_draft_database_fragment',
            functionName: 'executeFragment',
            inputs: { fragmentUuid: 'draft_database_fragment', params: {} },
            outputs: ['result'],
            nextBlock: null,
          },
        ],
      },
    }, executeSql))).resolves.toEqual({ method: 'POST', fragment: false })
  })

  it('does not allow a persisted Fragment to be converted into an endpoint', async () => {
    const executeSql = vi.fn(async () => ({
      databaseType: 'postgres' as const,
      rows: [{ uuid: 'stable_kind', fragment: true, status: 'published', api_json: {} }],
    })) as unknown as SqlExecutor

    await expect(executeValidateApiDefinitionBlock(executorInput({
      datasource: 'Mokelay',
      uuid: 'stable_kind',
      method: 'GET',
      fragment: false,
      status: 'published',
      apiJson: {
        uuid: 'stable_kind',
        method: 'GET',
        blocks: [{ uuid: 'starter', nextBlock: null }],
        response: {},
      },
    }, executeSql))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_FLOW' },
      message: expect.stringContaining('类型'),
    })
  })

  it('rejects published callers with unknown or missing required Fragment params', async () => {
    let queryCount = 0
    const targetFragment = {
      uuid: 'contract_target',
      fragment: true,
      params: [
        'name',
        { key: 'nickname' },
        { key: 'email', processors: ['is_not_null'] },
      ],
      blocks: [{ uuid: 'starter', nextBlock: null }],
      response: { ok: true },
    }
    const executeSql = vi.fn(async () => {
      queryCount += 1
      return {
        databaseType: 'postgres' as const,
        rows: queryCount === 2
          ? [{ uuid: 'contract_target', fragment: true, status: 'published', api_json: targetFragment }]
          : [],
      }
    }) as unknown as SqlExecutor

    await expect(executeValidateApiDefinitionBlock(executorInput({
      datasource: 'Mokelay',
      uuid: 'invalid_contract_caller',
      method: 'POST',
      fragment: false,
      status: 'published',
      apiJson: {
        uuid: 'invalid_contract_caller',
        method: 'POST',
        blocks: [
          { uuid: 'starter', nextBlock: 'call_contract_target' },
          {
            uuid: 'call_contract_target',
            functionName: 'executeFragment',
            inputs: {
              fragmentUuid: 'contract_target',
              params: { name: 'Mokelay', rogue: true },
            },
            outputs: ['result'],
            nextBlock: null,
          },
        ],
        response: { result: { template: '{{blocks.call_contract_target.outputs.result}}' } },
      },
    }, executeSql))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_FLOW' },
      message: expect.stringMatching(/未声明参数：rogue.*缺少必填参数：email/),
    })
  })

  it('rejects a published Fragment contract change that breaks an existing caller', async () => {
    let queryCount = 0
    const existingFragment = {
      uuid: 'stable_contract',
      fragment: true,
      params: ['name'],
      blocks: [{ uuid: 'starter', nextBlock: null }],
      response: { name: { template: '{{params.name}}' } },
    }
    const publishedCaller = {
      uuid: 'stable_contract_caller',
      method: 'POST',
      blocks: [
        { uuid: 'starter', nextBlock: 'call_stable_contract' },
        {
          uuid: 'call_stable_contract',
          functionName: 'executeFragment',
          inputs: { fragmentUuid: 'stable_contract', params: { name: 'Mokelay' } },
          outputs: ['result'],
          nextBlock: null,
        },
      ],
      response: { result: { template: '{{blocks.call_stable_contract.outputs.result}}' } },
    }
    const executeSql = vi.fn(async () => {
      queryCount += 1
      return {
        databaseType: 'postgres' as const,
        rows: queryCount === 1
          ? [{ uuid: 'stable_contract', fragment: true, status: 'published', api_json: existingFragment }]
          : [{ uuid: 'stable_contract_caller', api_json: publishedCaller }],
      }
    }) as unknown as SqlExecutor

    await expect(executeValidateApiDefinitionBlock(executorInput({
      datasource: 'Mokelay',
      uuid: 'stable_contract',
      method: 'FRAGMENT',
      fragment: true,
      status: 'published',
      apiJson: {
        ...existingFragment,
        params: ['name', 'email'],
      },
    }, executeSql))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_FLOW' },
      message: expect.stringMatching(/stable_contract_caller.*缺少必填参数：email/),
    })
  })

  it('rejects removing an existing Fragment result key while published callers exist', async () => {
    let queryCount = 0
    const existingFragment = {
      uuid: 'stable_result',
      fragment: true,
      params: ['name'],
      blocks: [{ uuid: 'starter', nextBlock: null }],
      response: {
        user: { name: { template: '{{params.name}}' } },
        free_datasource_uuid: 'free-schema',
      },
    }
    const publishedCaller = {
      uuid: 'stable_result_caller',
      method: 'POST',
      blocks: [
        { uuid: 'starter', nextBlock: 'call_stable_result' },
        {
          uuid: 'call_stable_result',
          functionName: 'executeFragment',
          inputs: { fragmentUuid: 'stable_result', params: { name: 'Mokelay' } },
          outputs: ['result'],
          nextBlock: null,
        },
      ],
      response: {
        user: { template: '{{blocks.call_stable_result.outputs.result.user}}' },
      },
    }
    const executeSql = vi.fn(async () => {
      queryCount += 1
      return {
        databaseType: 'postgres' as const,
        rows: queryCount === 1
          ? [{ uuid: 'stable_result', fragment: true, status: 'published', api_json: existingFragment }]
          : [{ uuid: 'stable_result_caller', api_json: publishedCaller }],
      }
    }) as unknown as SqlExecutor

    await expect(executeValidateApiDefinitionBlock(executorInput({
      datasource: 'Mokelay',
      uuid: 'stable_result',
      method: 'FRAGMENT',
      fragment: true,
      status: 'published',
      apiJson: {
        ...existingFragment,
        response: { free_datasource_uuid: 'free-schema' },
      },
    }, executeSql))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_FLOW' },
      message: expect.stringMatching(/不能删除已有 result 顶层字段：user/),
    })
  })

  it('does not treat built-in callers as references to a same-UUID database Fragment', async () => {
    let queryCount = 0
    const executeSql = vi.fn(async () => {
      queryCount += 1
      return {
        databaseType: 'postgres' as const,
        rows: queryCount === 1
          ? [{ uuid: 'provision_new_user', fragment: true, status: 'published', api_json: {} }]
          : [],
      }
    }) as unknown as SqlExecutor

    await expect(executeAssertApiDefinitionsDeletableBlock(executorInput({
      datasource: 'Mokelay',
      uuids: ['provision_new_user'],
    }, executeSql))).resolves.toEqual({})
    expect(queryCount).toBe(2)
  })

  it('allows deleting a database Fragment together with all of its published database callers', async () => {
    let queryCount = 0
    const caller = {
      uuid: 'batch_caller',
      method: 'POST',
      blocks: [
        { uuid: 'starter', nextBlock: 'call_batch_fragment' },
        {
          uuid: 'call_batch_fragment',
          functionName: 'executeFragment',
          inputs: { fragmentUuid: 'batch_fragment', params: {} },
          outputs: ['result'],
          nextBlock: null,
        },
      ],
      response: {},
    }
    const executeSql = vi.fn(async () => {
      queryCount += 1
      if (queryCount === 1) {
        return { databaseType: 'postgres' as const, rows: [{ uuid: 'batch_fragment', fragment: true, status: 'published' }] }
      }
      if (queryCount === 2) {
        return { databaseType: 'postgres' as const, rows: [{ uuid: 'batch_caller', api_json: caller }] }
      }
      return { databaseType: 'postgres' as const, rows: [{ uuid: 'batch_caller', fragment: false, status: 'published' }] }
    }) as unknown as SqlExecutor

    await expect(executeAssertApiDefinitionsDeletableBlock(executorInput({
      datasource: 'Mokelay',
      uuids: ['batch_fragment', 'batch_caller'],
    }, executeSql))).resolves.toEqual({})
  })

  it('allows a database Fragment to share a UUID with a nested built-in Fragment', async () => {
    const executeSql = vi.fn(async () => ({ databaseType: 'postgres' as const, rows: [] })) as unknown as SqlExecutor

    await expect(executeValidateApiDefinitionBlock(executorInput({
      datasource: 'Mokelay',
      uuid: 'provision_new_user',
      method: 'FRAGMENT',
      fragment: true,
      status: 'published',
      apiJson: {
        uuid: 'provision_new_user',
        fragment: true,
        params: ['database_only'],
        blocks: [{ uuid: 'starter', nextBlock: null }],
        response: { database_only: { template: '{{params.database_only}}' } },
      },
    }, executeSql))).resolves.toEqual({ method: 'FRAGMENT', fragment: true })
  })

  it('still rejects a user definition that collides with a root built-in API UUID', async () => {
    const executeSql = vi.fn(async () => ({ databaseType: 'postgres' as const, rows: [] })) as unknown as SqlExecutor

    await expect(executeValidateApiDefinitionBlock(executorInput({
      datasource: 'Mokelay',
      uuid: 'register',
      method: 'POST',
      fragment: false,
      status: 'published',
      apiJson: {
        uuid: 'register',
        method: 'POST',
        blocks: [{ uuid: 'starter', nextBlock: null }],
        response: {},
      },
    }, executeSql))).rejects.toMatchObject({
      data: { code: 'API_JSON_DUPLICATE_UUID' },
      message: expect.stringContaining('系统资产冲突'),
    })
  })

  it('resolves user caller targets only from the database even when a same-UUID built-in Fragment exists', async () => {
    let queryCount = 0
    const databaseFragment = {
      uuid: 'provision_new_user',
      fragment: true,
      params: ['database_only'],
      blocks: [{ uuid: 'starter', nextBlock: null }],
      response: { database_only: { template: '{{params.database_only}}' } },
    }
    const executeSql = vi.fn(async () => {
      queryCount += 1
      return {
        databaseType: 'postgres' as const,
        rows: queryCount === 2
          ? [{ uuid: 'provision_new_user', fragment: true, status: 'published', api_json: databaseFragment }]
          : [],
      }
    }) as unknown as SqlExecutor

    await expect(executeValidateApiDefinitionBlock(executorInput({
      datasource: 'Mokelay',
      uuid: 'database_caller',
      method: 'POST',
      fragment: false,
      status: 'published',
      apiJson: {
        uuid: 'database_caller',
        method: 'POST',
        blocks: [
          { uuid: 'starter', nextBlock: 'call_database_fragment' },
          {
            uuid: 'call_database_fragment',
            functionName: 'executeFragment',
            inputs: { fragmentUuid: 'provision_new_user', params: { database_only: 'database value' } },
            outputs: ['result'],
            nextBlock: null,
          },
        ],
        response: { result: { template: '{{blocks.call_database_fragment.outputs.result}}' } },
      },
    }, executeSql))).resolves.toEqual({ method: 'POST', fragment: false })
  })

  it('rejects a user caller when its Fragment exists only in built-in assets', async () => {
    const executeSql = vi.fn(async () => ({ databaseType: 'postgres' as const, rows: [] })) as unknown as SqlExecutor

    await expect(executeValidateApiDefinitionBlock(executorInput({
      datasource: 'Mokelay',
      uuid: 'database_caller_without_target',
      method: 'POST',
      fragment: false,
      status: 'published',
      apiJson: {
        uuid: 'database_caller_without_target',
        method: 'POST',
        blocks: [
          { uuid: 'starter', nextBlock: 'call_builtin_fragment' },
          {
            uuid: 'call_builtin_fragment',
            functionName: 'executeFragment',
            inputs: {
              fragmentUuid: 'provision_new_user',
              params: {
                enterprise_name: 'Enterprise',
                name: 'User',
                email: 'user@example.com',
                password_hash: 'hash',
              },
            },
            outputs: ['result'],
            nextBlock: null,
          },
        ],
        response: { result: { template: '{{blocks.call_builtin_fragment.outputs.result}}' } },
      },
    }, executeSql))).rejects.toMatchObject({
      data: { code: 'API_JSON_INVALID_FLOW' },
      message: expect.stringContaining('不存在或类型不正确'),
    })
  })
})
