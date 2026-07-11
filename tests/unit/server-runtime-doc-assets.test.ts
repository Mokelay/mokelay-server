import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const assetsDir = resolve(process.cwd(), 'server/assets')

async function readJsonAsset<T = any>(relativePath: string) {
  return JSON.parse(await readFile(resolve(assetsDir, relativePath), 'utf8')) as T
}

function collectActions(value: unknown): any[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((item) => collectActions(item))

  const record = value as Record<string, unknown>
  const ownActions = Array.isArray(record.actions) ? record.actions as any[] : []
  return [
    ...ownActions,
    ...Object.values(record).flatMap((item) => collectActions(item)),
  ]
}

function collectButtons(value: unknown): any[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((item) => collectButtons(item))

  const record = value as Record<string, unknown>
  const current = record.type === 'MButton' ? [record] : []
  return [
    ...current,
    ...Object.values(record).flatMap((item) => collectButtons(item)),
  ]
}

const docKinds = [
  {
    kind: 'block',
    listPage: 'mokelay-pages/server_block_docs.json',
    detailPage: 'mokelay-pages/server_block_doc_detail.json',
    readApi: 'mokelay-apis/read_server_block_doc.json',
    table: 'docs_server_block',
    expectedColumns: ['Function', '名称', '分类', '数据源', '说明', '源码', '操作'],
    detailPath: '/#/server_block_doc_detail?uuid={{uuid}}',
  },
  {
    kind: 'controller',
    listPage: 'mokelay-pages/server_controller_docs.json',
    detailPage: 'mokelay-pages/server_controller_doc_detail.json',
    readApi: 'mokelay-apis/read_server_controller_doc.json',
    table: 'docs_server_controller',
    expectedColumns: ['Function', '名称', '分类', '说明', '源码', '操作'],
    detailPath: '/#/server_controller_doc_detail?uuid={{uuid}}',
  },
  {
    kind: 'processor',
    listPage: 'mokelay-pages/server_processor_docs.json',
    detailPage: 'mokelay-pages/server_processor_doc_detail.json',
    readApi: 'mokelay-apis/read_server_processor_doc.json',
    table: 'docs_server_processor',
    expectedColumns: ['Processor', '名称', '分类', '说明', '源码', '操作'],
    detailPath: '/#/server_processor_doc_detail?uuid={{uuid}}',
  },
]

describe('server runtime documentation assets', () => {
  it.each(docKinds)('declares a route-backed read API for $kind docs', async ({ kind, readApi, table }) => {
    const api = await readJsonAsset(readApi)
    const readBlock = api.blocks.find((block: any) => block.uuid === `read_server_${kind}_doc_block`)

    expect(api.method).toBe('GET')
    expect(api.request?.query).toContain('uuid')
    expect(readBlock?.functionName).toBe('read')
    expect(readBlock?.inputs?.table).toBe(table)
    expect(readBlock?.inputs?.conditions).toContainEqual(expect.objectContaining({
      fieldName: 'uuid',
      fieldValue: { template: '{{request.query.uuid}}' },
    }))
    expect(api.responses?.[`read_server_${kind}_doc_block`]?.doc).toEqual({
      template: `{{blocks['read_server_${kind}_doc_block'].outputs.data}}`,
    })
  })

  it.each(docKinds)('binds $kind detail page to route uuid and read API', async ({ kind, detailPage }) => {
    const page = await readJsonAsset(detailPage)
    const datasource = page.dataSources?.[0]?.ds
    const blockTypes = page.blocks.map((block: any) => block.type)

    expect(page.layoutUuid).toBe('mokelay_layout')
    expect(datasource?.path).toBe(`/api/mokelay/read_server_${kind}_doc`)
    expect(datasource?.queryData).toContainEqual({
      key: 'uuid',
      value: expect.objectContaining({ variable: 'context.route.query.uuid' }),
    })
    expect(blockTypes).toContain('MRecordList')
    expect(blockTypes).toContain('MAdvanceTable')
    expect(blockTypes).toContain('MLayoutGrid')
    expect(blockTypes).toContain('MJson')
  })

  it.each(docKinds)('uses one 查看详情 operation column on $kind list page', async ({ listPage, expectedColumns, detailPath }) => {
    const page = await readJsonAsset(listPage)
    const table = page.blocks.find((block: any) => block.type === 'MAdvanceTable')
    const columns = table?.data?.columns ?? []
    const operationColumn = columns.find((column: any) => column.columnName === '操作')
    const buttons = collectButtons(columns)
    const actions = collectActions(columns)

    expect(columns.map((column: any) => column.columnName)).toEqual(expectedColumns)
    expect(operationColumn?.fieldVariable).toBe('uuid')
    expect(operationColumn?.fixed).toBe('right')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.data?.label).toBe('查看详情')
    expect(actions.map((action) => action.action)).toEqual(['jump_url'])
    expect(actions[0]?.inputs?.url).toEqual({ template: detailPath })
  })

  it('disables loading labels on create dialog entry buttons', async () => {
    const datasources = await readJsonAsset('mokelay-pages/datasources.json')
    const layouts = await readJsonAsset('mokelay-pages/mokelay_layouts_user_page.json')
    const pages = await readJsonAsset('mokelay-pages/mokelay_list_page.json')

    const datasourceCreate = datasources.blocks
      .find((block: any) => block.id === 'mokelay-datasources-toolbar')
      ?.data?.buttons?.find((button: any) => button.id === 'create')
    const layoutCreate = layouts.blocks
      .find((block: any) => block.id === 'mokelay-layouts-user-toolbar')
      ?.data?.buttons?.find((button: any) => button.id === 'create')
    const pageCreate = pages.blocks
      .find((block: any) => block.id === 'mokelay-list-page-search-form')
      ?.data?.actionBar?.buttons?.find((button: any) => button.id === 'create')

    expect(datasourceCreate?.showLoading).toBe(false)
    expect(layoutCreate?.showLoading).toBe(false)
    expect(pageCreate?.showLoading).toBe(false)
  })
})
