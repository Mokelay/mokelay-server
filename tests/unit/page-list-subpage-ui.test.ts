import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { executeNormalizePageRowsBlock } from '../../server/utils/blocks/pageRelationBlocks'

const pageDsl = JSON.parse(readFileSync(
  new URL('../../server/assets/mokelay-pages/mokelay_list_page.json', import.meta.url),
  'utf8',
))

describe('page list subpage management UI', () => {
  it('offers all/main/sub filtering and renders page kind plus quote count', () => {
    const searchForm = pageDsl.blocks.find((block: { id?: string }) => block.id === 'mokelay-list-page-search-form')
    const kindFilter = searchForm.data.items.find((item: { variableName?: string }) => item.variableName === 'subPage')
    expect(kindFilter.editor.data.options).toEqual([
      { label: '全部页面', value: '' },
      { label: '主页面', value: '0' },
      { label: '子页面', value: '1' },
    ])

    const table = pageDsl.blocks.find((block: { id?: string }) => block.id === 'mokelay-list-page-table')
    expect(table.data.ds.queryData).toContainEqual(expect.objectContaining({
      key: 'subPage',
      value: expect.objectContaining({ variable: 'search.subPage' }),
    }))
    expect(table.data.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldVariable: 'subPage',
        columnContent: [expect.objectContaining({
          data: expect.objectContaining({ tagName: '{{pageKindLabel}}' }),
        })],
      }),
      expect.objectContaining({
        fieldVariable: 'quotes',
        columnContent: [expect.objectContaining({
          data: expect.objectContaining({ text: '{{quotesCount}}' }),
        })],
      }),
    ]))
  })

  it('derives stable display fields from canonical relation metadata', async () => {
    const result = await executeNormalizePageRowsBlock({
      inputs: {
        rows: [{
          uuid: '11111111-1111-4111-8111-111111111111',
          name: 'Reusable child',
          blocks: '[]',
          sub_page: 1,
          quotes: '["parent-a","parent-b"]',
          dependencies: '[]',
        }],
      },
    } as unknown as Parameters<typeof executeNormalizePageRowsBlock>[0]) as {
      pages: Array<Record<string, unknown>>
    }

    expect(result.pages[0]).toMatchObject({
      subPage: true,
      quotes: ['parent-a', 'parent-b'],
      pageKindLabel: '子页面',
      quotesCount: 2,
    })
  })
})
