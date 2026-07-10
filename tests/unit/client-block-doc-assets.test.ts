import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const assetsDir = resolve(process.cwd(), 'server/assets')

async function readJsonAsset<T>(relativePath: string) {
  return JSON.parse(await readFile(resolve(assetsDir, relativePath), 'utf8')) as T
}

type ClientBlockDocsApi = {
  request: {
    query: Array<string | {
      key: string
      processors?: Array<string | {
        processor: string
        param?: unknown
      }>
    }>
  }
}

type ClientBlockDocsPage = {
  blocks: Array<{
    id: string
    type?: string
    data?: {
      ds?: {
        queryData?: Array<{ key: string, value: unknown }>
      }
    }
  }>
}

type ClientBlockDocSettingsApi = {
  request: {
    body: Array<string | {
      key: string
      processors?: Array<string | {
        processor: string
        param?: unknown
      }>
    }>
  }
  blocks: Array<{
    uuid: string
    type?: string
    functionName?: string
  }>
  responses: Record<string, unknown>
}

type ClientBlockDocsPageData = {
  items?: Array<{
    variableName?: string
    editor?: {
      type?: string
      data?: {
        options?: Array<{ label: string, value: string }>
      }
    }
  }>
  actionBar?: {
    buttons?: Array<{ id?: string }>
  }
  columns?: Array<{
    columnName?: string
    fieldVariable?: string
    width?: number
    wrap?: boolean
    fixed?: string | null
    columnContent?: Array<{
      id?: string
      type?: string
      data?: Record<string, unknown>
      events?: Array<{
        actions?: Array<{
          action?: string
          inputs?: Record<string, unknown>
        }>
      }>
    }>
  }>
}

type BlockComponentDocDetailPage = {
  dataSources?: Array<{
    key?: string
    type?: string
    ds?: {
      path?: string
      queryData?: Array<{
        key?: string
        value?: Record<string, unknown>
      }>
    }
  }>
  blocks?: Array<{
    id?: string
    type?: string
    data?: Record<string, unknown>
  }>
}

type TabsPage = {
  blocks: Array<{
    id: string
    data?: {
      tabs?: Array<{
        id: string
        name: string
        pageUUID: string
        pageSource?: string
      }>
    }
  }>
}

const optionalFilters = [
  'status',
  'sourceKind',
  'category',
  'editorEnabled',
  'toolboxVisible',
]

const defaultPageRequestField = {
  key: 'page',
  processors: [{
    processor: 'default_value',
    param: 1,
  }],
}

describe('client block document assets', () => {
  it.each([
    'mokelay-apis/list_client_block_docs.json',
    'mokelay-apis/list_block_component_docs.json',
  ])('declares optional filters as optional request fields in %s', async (fileName) => {
    const api = await readJsonAsset<ClientBlockDocsApi>(fileName)

    expect(api.request.query.slice(0, 2)).toEqual([defaultPageRequestField, 'pageSize'])
    expect(api.request.query.slice(2)).toEqual(optionalFilters.map((key) => ({ key })))
  })

  it('loads only active client blocks on the documentation page', async () => {
    const page = await readJsonAsset<ClientBlockDocsPage>('mokelay-pages/block_component_docs.json')
    const datasource = page.blocks.find((block) => block.id === 'block-docs-table')?.data?.ds

    expect(datasource?.queryData).toContainEqual({
      key: 'status',
      value: 'active',
    })
    expect(datasource?.queryData).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'editorEnabled',
        value: expect.objectContaining({ variable: 'search.editorEnabled' }),
      }),
      expect.objectContaining({
        key: 'toolboxVisible',
        value: expect.objectContaining({ variable: 'search.toolboxVisible' }),
      }),
      expect.objectContaining({
        key: 'category',
        value: expect.objectContaining({ variable: 'search.category' }),
      }),
    ]))
  })

  it('declares a narrow settings API for the three toolbox configuration fields', async () => {
    const api = await readJsonAsset<ClientBlockDocSettingsApi>('mokelay-apis/update_client_block_doc_settings.json')

    expect(api.request.body.map((field) => typeof field === 'string' ? field : field.key)).toEqual([
      'uuid',
      'editor_enabled',
      'toolbox_visible',
      'sort_order',
    ])
    expect(api.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ uuid: 'validate_editor_enabled', type: 'controller', functionName: 'switch_controller' }),
      expect.objectContaining({ uuid: 'validate_toolbox_visible', type: 'controller', functionName: 'switch_controller' }),
      expect.objectContaining({ uuid: 'update_block_doc_settings', functionName: 'update' }),
      expect.objectContaining({ uuid: 'read_updated_block_doc_settings', functionName: 'read' }),
    ]))
    expect(api.responses).toHaveProperty('read_updated_block_doc_settings')
  })

  it('provides Block toolbox filters and configuration controls on the documentation page', async () => {
    const page = await readJsonAsset<{
      blocks: Array<{ id: string, data?: ClientBlockDocsPageData }>
    }>('mokelay-pages/block_component_docs.json')
    const searchForm = page.blocks.find((block) => block.id === 'block-docs-search-form')?.data
    const toolboxColumn = page.blocks.find((block) => block.id === 'block-docs-table')?.data?.columns
      ?.find((column) => column.columnName === '工具箱')

    expect(searchForm?.items?.map((item) => item.variableName)).toEqual([
      'editorEnabled',
      'toolboxVisible',
      'category',
    ])
    expect(searchForm?.actionBar?.buttons?.map((button) => button.id)).toEqual(['search', 'reset'])
    expect(searchForm?.items?.find((item) => item.variableName === 'category')?.editor?.data?.options)
      .toEqual(expect.arrayContaining([
        { label: '动作', value: 'action' },
        { label: '容器', value: 'container' },
        { label: '内容', value: 'content' },
        { label: '数据', value: 'data' },
        { label: '表单', value: 'form' },
        { label: '布局', value: 'layout' },
        { label: '页面', value: 'page' },
      ]))
    expect(toolboxColumn?.columnContent?.map((block) => block.id)).toEqual(expect.arrayContaining([
      'block-docs-disable-{{uuid}}',
      'block-docs-enable-{{uuid}}',
      'block-docs-hide-{{uuid}}',
      'block-docs-show-{{uuid}}',
      'block-docs-sort-order-{{uuid}}',
      'block-docs-save-sort-order-{{uuid}}',
    ]))
    expect(toolboxColumn).toMatchObject({
      width: 320,
      wrap: true,
    })
  })

  it('keeps detail data out of the list and links each Block to the detail page', async () => {
    const page = await readJsonAsset<{
      blocks: Array<{ id: string, data?: ClientBlockDocsPageData }>
    }>('mokelay-pages/block_component_docs.json')
    const columns = page.blocks.find((block) => block.id === 'block-docs-table')?.data?.columns
    const actionColumn = columns?.find((column) => column.columnName === '操作')
    const detailAction = actionColumn?.columnContent?.[0]?.events?.[0]?.actions?.[0]

    expect(columns?.map((column) => column.columnName)).not.toEqual(expect.arrayContaining([
      '属性',
      '事件',
      '方法',
      '数据字段',
      '保存',
    ]))
    expect(actionColumn).toMatchObject({
      fieldVariable: 'uuid',
      width: 112,
      fixed: 'right',
    })
    expect(actionColumn?.columnContent?.[0]?.id).toBe('block-docs-open-detail-{{uuid}}')
    expect(detailAction).toMatchObject({
      action: 'jump_url',
      inputs: {
        url: {
          template: '/#/block_component_doc_detail?uuid={{uuid}}',
        },
      },
    })
  })

  it('declares a shareable Block detail page driven by the route UUID', async () => {
    const page = await readJsonAsset<BlockComponentDocDetailPage>('mokelay-pages/block_component_doc_detail.json')
    const datasource = page.dataSources?.find((source) => source.key === 'doc')
    const uuidQuery = datasource?.ds?.queryData?.find((item) => item.key === 'uuid')
    const recordList = page.blocks?.find((block) => block.id === 'block-doc-detail-records')
    const propertiesTable = page.blocks?.find((block) => block.id === 'block-doc-detail-properties-table')
    const eventsTable = page.blocks?.find((block) => block.id === 'block-doc-detail-events-table')
    const methodsTable = page.blocks?.find((block) => block.id === 'block-doc-detail-methods-table')
    const jsonConfigGrid = page.blocks?.find((block) => block.id === 'block-doc-detail-json-config-grid')
    const jsonViewer = page.blocks?.find((block) => block.id === 'block-doc-detail-json')

    expect(datasource).toMatchObject({
      type: 'datasource',
      ds: {
        path: '/api/mokelay/read_block_component_doc',
      },
    })
    expect(uuidQuery?.value).toMatchObject({
      mode: 'variable',
      source: 'MPage',
      pageId: 'block_component_doc_detail',
      variable: 'context.route.query.uuid',
    })
    expect(recordList?.type).toBe('MRecordList')
    expect(recordList?.data).toMatchObject({
      emptyText: '未找到对应的 Block 文档。',
      hiddenFields: expect.arrayContaining([
        'registration',
        'toolbox',
        'initial_props',
        'default_data',
        'property_schema',
        'event_schema',
        'method_schema',
        'data_fields_schema',
        'save_schema',
        'examples',
        'source_refs',
        'raw_meta',
      ]),
    })
    expect(propertiesTable).toMatchObject({
      type: 'MAdvanceTable',
      data: {
        rows: {
          mode: 'variable',
          source: 'MPage',
          pageId: 'block_component_doc_detail',
          variable: 'dataSources.doc.doc.property_schema',
        },
      },
    })
    expect(eventsTable).toMatchObject({
      type: 'MAdvanceTable',
      data: {
        rows: expect.objectContaining({ variable: 'dataSources.doc.doc.event_schema' }),
      },
    })
    expect(methodsTable).toMatchObject({
      type: 'MAdvanceTable',
      data: {
        rows: expect.objectContaining({ variable: 'dataSources.doc.doc.method_schema' }),
      },
    })
    expect(jsonConfigGrid).toMatchObject({
      type: 'MLayoutGrid',
      data: {
        columns: 'minmax(0, 1fr) minmax(0, 1fr)',
        responsive: {
          mobile: {
            columns: 1,
          },
        },
      },
    })

    const configBlocks = ((jsonConfigGrid?.data?.areas as Array<{
      blocks?: Array<{ id?: string, type?: string, data?: Record<string, unknown> }>
    }> | undefined) ?? []).flatMap((area) => area.blocks ?? [])
    const expectedJsonPaths = {
      'block-doc-detail-registration-json': 'dataSources.doc.doc.registration',
      'block-doc-detail-toolbox-json': 'dataSources.doc.doc.toolbox',
      'block-doc-detail-initial-props-json': 'dataSources.doc.doc.initial_props',
      'block-doc-detail-default-data-json': 'dataSources.doc.doc.default_data',
      'block-doc-detail-data-fields-json': 'dataSources.doc.doc.data_fields_schema',
      'block-doc-detail-save-rules-json': 'dataSources.doc.doc.save_schema',
      'block-doc-detail-examples-json': 'dataSources.doc.doc.examples',
      'block-doc-detail-source-refs-json': 'dataSources.doc.doc.source_refs',
      'block-doc-detail-raw-meta-json': 'dataSources.doc.doc.raw_meta',
    }

    expect(configBlocks).toHaveLength(Object.keys(expectedJsonPaths).length)
    Object.entries(expectedJsonPaths).forEach(([id, variable]) => {
      expect(configBlocks.find((block) => block.id === id)).toMatchObject({
        type: 'MJson',
        data: {
          value: {
            mode: 'variable',
            source: 'MPage',
            pageId: 'block_component_doc_detail',
            variable,
          },
          height: 320,
          expandDepth: 1,
        },
      })
    })

    expect(jsonViewer).toMatchObject({
      type: 'MJson',
      data: {
        height: 560,
        expandDepth: 1,
        value: {
          mode: 'variable',
          source: 'MPage',
          pageId: 'block_component_doc_detail',
          variable: 'dataSources.doc.doc',
        },
      },
    })
  })

  it('removes the obsolete per-field dialog page assets', () => {
    expect(existsSync(resolve(assetsDir, 'mokelay-pages/block_component_doc_properties.json'))).toBe(false)
    expect(existsSync(resolve(assetsDir, 'mokelay-pages/block_component_doc_events.json'))).toBe(false)
    expect(existsSync(resolve(assetsDir, 'mokelay-pages/block_component_doc_methods.json'))).toBe(false)
  })

  it('groups the client Block list under the client documentation tabs', async () => {
    const docs = await readJsonAsset<TabsPage>('mokelay-pages/docs.json')
    const clientDocs = docs.blocks.find((block) => block.id === 'mokelay-docs-tabs')?.data?.tabs
      ?.find((tab) => tab.id === 'client-docs')
    const clientPage = await readJsonAsset<TabsPage>('mokelay-pages/client_docs.json')
    const blockDocs = clientPage.blocks.find((block) => block.id === 'client-docs-tabs')?.data?.tabs

    expect(clientDocs).toEqual({
      id: 'client-docs',
      name: '客户端文档',
      pageUUID: 'client_docs',
      pageSource: 'system',
    })
    expect(blockDocs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'client-block-docs',
        name: 'Block文档',
        pageUUID: 'block_component_docs',
        pageSource: 'system',
      }),
      expect.objectContaining({
        id: 'client-action-docs',
        name: 'Action文档',
        pageUUID: 'client_action_docs',
        pageSource: 'system',
      }),
      expect.objectContaining({
        id: 'client-processor-docs',
        name: 'Processor文档',
        pageUUID: 'client_processor_docs',
        pageSource: 'system',
      }),
    ]))
  })
})
