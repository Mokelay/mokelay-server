import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import type { SqlExecutionResult } from 'mokelay-server-core/utils/db'
import { executeResolveLayoutBundleBlock } from '../../server/utils/blocks/resolveLayoutBundle'

vi.mock('nitropack/runtime', () => ({
  useStorage: () => ({
    getKeys: async () => [],
    getItem: async (key: string) => {
      if (key === 'mokelay-pages/system_page.json') {
        return JSON.stringify({
          uuid: 'system_page',
          name: 'System Page',
          layoutUuid: 'asset-layout',
          blocks: [{ type: 'paragraph', data: { text: 'System page body.' } }],
        })
      }

      if (key === 'mokelay-layouts/asset-layout.json') {
        return JSON.stringify({
          uuid: 'asset-layout',
          name: 'Asset Layout',
          schemaVersion: 1,
          blocks: [
            {
              id: 'asset-slot',
              type: 'MPageSlot',
              data: {
                name: 'default',
              },
            },
          ],
        })
      }

      return undefined
    },
  }),
}))

function executeBlockWithRows(rows: Record<string, unknown>[]) {
  const executeSql = vi.fn(async (_query: SQL) => {
    const row = rows.shift()

    return {
      databaseType: 'postgres' as const,
      rows: row ? [row] : [],
    }
  }) as unknown as <T extends Record<string, unknown> = Record<string, unknown>>(query: SQL) => Promise<SqlExecutionResult<T>>

  return {
    executeSql,
    result: executeResolveLayoutBundleBlock({
      event: undefined as never,
      block: undefined as never,
      inputs: {
        uuid: 'page-1',
        source: 'user',
      },
      executeSql,
      databaseType: 'postgres',
    }),
  }
}

function layout(uuid: string, name: string, marker: string) {
  return {
    uuid,
    name,
    schemaVersion: 1,
    blocks: [
      {
        id: marker,
        type: 'MPageSlot',
        data: {
          name: 'default',
        },
      },
    ],
  }
}

describe('executeResolveLayoutBundleBlock', () => {
  it('returns the page layout before the app default layout', async () => {
    const { result, executeSql } = executeBlockWithRows([
      {
        page_uuid: 'page-1',
        page_name: 'Page One',
        page_blocks: [{ type: 'paragraph', data: { text: 'Hello' } }],
        page_app_uuid: 'app-1',
        page_layout_uuid_value: 'page-layout',
        page_created_at: '2026-06-25 00:00:00.000+00:00',
        page_updated_at: '2026-06-25 00:00:00.000+00:00',
      },
      {
        page_layout_uuid: 'page-layout',
        page_layout_name: 'Page Layout',
        page_layout_json: layout('page-layout', 'Page Layout', 'page-slot'),
      },
    ])

    await expect(result).resolves.toMatchObject({
      page: {
        uuid: 'page-1',
        name: 'Page One',
        appUuid: 'app-1',
        layoutUuid: 'page-layout',
      },
      layout: {
        uuid: 'page-layout',
        name: 'Page Layout',
        blocks: [{ id: 'page-slot' }],
      },
    })
    expect(executeSql).toHaveBeenCalledTimes(2)
  })

  it('falls back to the app default layout when the page has no layout', async () => {
    const { result, executeSql } = executeBlockWithRows([
      {
        page_uuid: 'page-1',
        page_name: 'Page One',
        page_blocks: JSON.stringify([{ type: 'paragraph', data: { text: 'Hello' } }]),
        page_app_uuid: 'app-1',
        page_layout_uuid_value: null,
      },
      {
        app_default_layout_uuid: 'app-layout',
      },
      {
        app_layout_uuid: 'app-layout',
        app_layout_name: 'App Layout',
        app_layout_json: JSON.stringify(layout('app-layout', 'App Layout', 'app-slot')),
      },
    ])

    await expect(result).resolves.toMatchObject({
      page: {
        uuid: 'page-1',
        blocks: [{ type: 'paragraph', data: { text: 'Hello' } }],
        layoutUuid: null,
      },
      layout: {
        uuid: 'app-layout',
        name: 'App Layout',
        blocks: [{ id: 'app-slot' }],
      },
    })
    expect(executeSql).toHaveBeenCalledTimes(3)
  })

  it('uses built-in layout assets for system pages before querying layouts', async () => {
    const executeSql = vi.fn(async (_query: SQL) => ({
      databaseType: 'postgres' as const,
      rows: [],
    })) as unknown as <T extends Record<string, unknown> = Record<string, unknown>>(query: SQL) => Promise<SqlExecutionResult<T>>

    await expect(executeResolveLayoutBundleBlock({
      event: undefined as never,
      block: undefined as never,
      inputs: {
        uuid: 'system_page',
        source: 'system',
      },
      executeSql,
      databaseType: 'postgres',
    })).resolves.toMatchObject({
      page: {
        uuid: 'system_page',
        name: 'System Page',
      },
      layout: {
        uuid: 'asset-layout',
        name: 'Asset Layout',
        blocks: [{ id: 'asset-slot' }],
      },
    })
    expect(executeSql).not.toHaveBeenCalled()
  })
})
