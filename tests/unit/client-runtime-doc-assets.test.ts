import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The scanner is an executable JavaScript module with exported test helpers.
import { collectClientRuntimeDocs } from '../../scripts/import-client-runtime-docs.mjs'

const assetsDir = resolve(process.cwd(), 'server/assets')

type RuntimeDocs = {
  actions: Array<{ action_name: string }>
  processors: Array<{ processor_name: string }>
}

async function readJsonAsset<T>(relativePath: string) {
  return JSON.parse(await readFile(resolve(assetsDir, relativePath), 'utf8')) as T
}

describe('client Action and Processor documentation assets', () => {
  it('scans all registered client runtime docs from source comments', async () => {
    const docs = await collectClientRuntimeDocs() as RuntimeDocs

    expect(docs.actions.map((doc) => doc.action_name)).toEqual(expect.arrayContaining([
      'execute_ds', 'confirm', 'open_dialog', 'close_dialog', 'jump_url',
      'call_block_method', 'upload_file', 'download_blob', 'if_controller', 'switch_controller',
    ]))
    expect(docs.actions).toHaveLength(10)
    expect(docs.processors.map((doc) => doc.processor_name)).toEqual([
      'filter', 'date_time_format', 'merge_data', 'random_id', 'trim',
    ])
    expect(docs.processors).toHaveLength(5)
  })

  it.each([
    'mokelay-apis/list_client_action_docs.json',
    'mokelay-apis/read_client_action_doc.json',
    'mokelay-apis/list_client_processor_docs.json',
    'mokelay-apis/read_client_processor_doc.json',
  ])('declares a valid API asset: %s', async (fileName) => {
    const api = await readJsonAsset<{ method: string, request?: { query?: unknown[] }, blocks: unknown[], responses: unknown }>(fileName)
    expect(api.method).toMatch(/^(GET)$/)
    expect(api.request?.query).toBeTruthy()
    expect(api.blocks.length).toBeGreaterThan(1)
    expect(api.responses).toBeTruthy()
  })

  it('uses the client runtime tabs and stable detail routes', async () => {
    const page = await readJsonAsset<{
      blocks: Array<{ data?: { tabs?: Array<{ name?: string, pageUUID?: string }> } }>
    }>('mokelay-pages/client_docs.json')
    const tabs = page.blocks.flatMap((block) => block.data?.tabs ?? [])

    expect(tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Block文档', pageUUID: 'block_component_docs' }),
      expect.objectContaining({ name: 'Action文档', pageUUID: 'client_action_docs' }),
      expect.objectContaining({ name: 'Processor文档', pageUUID: 'client_processor_docs' }),
    ]))
  })

  it.each([
    ['mokelay-pages/client_action_doc_detail.json', '/api/mokelay/read_client_action_doc'],
    ['mokelay-pages/client_processor_doc_detail.json', '/api/mokelay/read_client_processor_doc'],
  ])('binds detail page %s to route UUID and the correct API', async (fileName, apiPath) => {
    const page = await readJsonAsset<{
      layoutUuid?: string
      dataSources: Array<{ ds?: { path?: string, queryData?: Array<{ key?: string, value?: { variable?: string } }> } }>
      blocks: Array<{ type?: string, data?: { value?: { variable?: string }, hiddenFields?: string[] } }>
    }>(fileName)
    const datasource = page.dataSources[0]?.ds

    expect(page.layoutUuid).toBe('mokelay_layout')
    expect(datasource?.path).toBe(apiPath)
    expect(datasource?.queryData).toContainEqual({
      key: 'uuid',
      value: expect.objectContaining({ variable: 'context.route.query.uuid' }),
    })
    expect(page.blocks.filter((block) => block.type === 'MJson')).not.toHaveLength(0)
    expect(page.blocks.find((block) => block.type === 'MRecordList')?.data?.hiddenFields).toEqual(expect.arrayContaining([
      'input_schema', 'output_schema', 'error_schema', 'config_schema', 'examples', 'source_refs', 'raw_meta',
    ]))
  })
})
