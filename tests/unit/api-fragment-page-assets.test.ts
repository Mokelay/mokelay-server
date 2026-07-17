import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const pageAssetsDir = resolve(process.cwd(), 'server/assets/mokelay-pages')

async function page(uuid: string) {
  return JSON.parse(await readFile(resolve(pageAssetsDir, `${uuid}.json`), 'utf8')) as Record<string, unknown>
}

function objects(value: unknown): Array<Record<string, any>> {
  if (Array.isArray(value)) return value.flatMap(objects)
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return [record, ...Object.values(record).flatMap(objects)]
}

function byId(value: unknown, id: string) {
  return objects(value).find(item => item.id === id)
}

function byUuid(value: unknown, uuid: string) {
  return objects(value).find(item => item.uuid === uuid)
}

function queryValue(table: Record<string, any> | undefined, key: string) {
  return table?.data?.ds?.queryData?.find((item: Record<string, unknown>) => item.key === key)?.value
}

describe('API and Fragment list page assets', () => {
  it('nests API/Fragment tabs under the APP workbench and settings', async () => {
    const [root, userTabs, systemTabs] = await Promise.all([
      page('app'),
      page('mokelay_apis_user_tabs_page'),
      page('mokelay_apis_system_tabs_page'),
    ])

    expect(byId(root, 'app-resource-tabs')?.data?.tabs).toContainEqual(
      expect.objectContaining({ name: '接口', pageUUID: 'mokelay_apis_user_tabs_page', pageSource: 'system' }),
    )
    expect(byId(userTabs, 'mokelay-apis-user-type-tabs')?.data).toMatchObject({
      activeTabId: 'user-api',
      tabs: [
        { id: 'user-api', name: 'API', pageUUID: 'mokelay_apis_user_page', pageSource: 'system' },
        { id: 'user-fragment', name: 'Fragment', pageUUID: 'mokelay_apis_user_fragment_page', pageSource: 'system' },
      ],
    })
    expect(byId(systemTabs, 'mokelay-apis-system-type-tabs')?.data).toMatchObject({
      activeTabId: 'system-api',
      tabs: [
        { id: 'system-api', name: 'API', pageUUID: 'mokelay_apis_system_page', pageSource: 'system' },
        { id: 'system-fragment', name: 'Fragment', pageUUID: 'mokelay_apis_system_fragment_page', pageSource: 'system' },
      ],
    })
  })

  it('filters every list by kind and keeps built-in pages read-only', async () => {
    const [userApi, userFragment, systemApi, systemFragment] = await Promise.all([
      page('mokelay_apis_user_page'),
      page('mokelay_apis_user_fragment_page'),
      page('mokelay_apis_system_page'),
      page('mokelay_apis_system_fragment_page'),
    ])

    expect(queryValue(byId(userApi, 'mokelay-apis-user-table'), 'fragment')).toBe('false')
    expect(queryValue(byId(userFragment, 'mokelay-fragments-user-table'), 'fragment')).toBe('true')
    expect(queryValue(byId(systemApi, 'mokelay-apis-system-table'), 'fragment')).toBe('false')
    expect(queryValue(byId(systemFragment, 'mokelay-fragments-system-table'), 'fragment')).toBe('true')

    expect(byId(userApi, 'create-api')?.label ?? byId(userApi, 'create-api')?.data?.label).toBe('新建 API')
    expect(byId(userFragment, 'create-fragment')?.label ?? byId(userFragment, 'create-fragment')?.data?.label).toBe('新建 Fragment')
    expect(JSON.stringify(userApi)).not.toContain('新建 Fragment')
    expect(JSON.stringify(userFragment)).not.toContain('新建 API')
    expect(JSON.stringify(systemApi)).not.toContain('新建')
    expect(JSON.stringify(systemFragment)).not.toContain('新建')
    expect(JSON.stringify(systemApi)).not.toContain('删除')
    expect(JSON.stringify(systemFragment)).not.toContain('删除')

    const userFragmentJson = JSON.stringify(userFragment)
    expect(userFragmentJson).toContain('确认批量删除 Fragment')
    expect(userFragmentJson).toContain('/api/mokelay/batch_delete_apis')
    expect(userFragmentJson).toContain('删除 Fragment')
    expect(userFragmentJson).toContain('/api/mokelay/delete_api_by_uuid')
  })

  it('keeps samples on the user API tab and opens details with source and kind context', async () => {
    const [root, userApi, userFragment, systemApi, systemFragment] = await Promise.all([
      page('app'),
      page('mokelay_apis_user_page'),
      page('mokelay_apis_user_fragment_page'),
      page('mokelay_apis_system_page'),
      page('mokelay_apis_system_fragment_page'),
    ])

    expect(byId(root, 'mokelay-api-samples-list')).toBeUndefined()
    expect(byId(userApi, 'mokelay-api-samples-list')).toBeTruthy()
    expect(byId(userFragment, 'mokelay-api-samples-list')).toBeUndefined()
    expect(byUuid(userApi, 'mokelay_api_user_open_detail')?.inputs?.url?.template).toContain('appUuid={{context.route.query.uuid}}')
    expect(byUuid(userFragment, 'mokelay_fragment_user_open_detail')?.inputs?.url?.template).toContain('appUuid={{context.route.query.uuid}}')
    expect(byUuid(systemApi, 'mokelay_api_system_open_detail')?.inputs?.url?.template).toBe('#/apis/{{sourceBlock.data.action.uuid}}?source=system')
    expect(byUuid(systemFragment, 'mokelay_fragment_system_open_detail')?.inputs?.url?.template).toBe('#/apis/{{sourceBlock.data.action.uuid}}?source=system&fragment=true')
  })

  it('creates a database Fragment draft with Fragment metadata and DSL shape', async () => {
    const createPage = await page('mokelay_fragment_create_page')
    const form = byId(createPage, 'mokelay-fragment-create-form')
    const readForm = byUuid(createPage, 'mokelay_fragment_create_read_form')
    const normalizeUuid = byUuid(createPage, 'mokelay_fragment_create_normalize_uuid')
    const submitForm = byUuid(createPage, 'mokelay_fragment_create_submit_form')
    const save = byUuid(createPage, 'mokelay_fragment_create_execute_save')
    const bodyData = save?.inputs?.dsConfig?.bodyData ?? []
    const byKey = (key: string) => bodyData.find((item: Record<string, unknown>) => item.key === key)
    const canonicalUuidTemplate = "{{actions['mokelay_fragment_create_normalize_uuid'].outputs.returnData.values.uuid}}"

    expect(form?.data?.items?.map((item: Record<string, unknown>) => item.variableName)).toEqual(['name', 'uuid'])
    expect(readForm).toMatchObject({
      action: 'call_block_method',
      inputs: { blockId: 'mokelay-fragment-create-form', method: 'getData' },
      nextAction: 'mokelay_fragment_create_normalize_uuid',
    })
    expect(normalizeUuid).toMatchObject({
      action: 'call_block_method',
      inputs: {
        blockId: 'mokelay-fragment-create-form',
        method: 'setValues',
        args: {
          uuid: {
            template: "{{actions['mokelay_fragment_create_read_form'].outputs.returnData.uuid}}",
            processors: [
              'trim',
              {
                processor: 'random_id',
                param: { prefix: 'fragment_', length: 6, when: 'empty' },
              },
            ],
          },
        },
      },
      nextAction: 'mokelay_fragment_create_submit_form',
    })
    expect(submitForm?.nextAction).toBe('mokelay_fragment_create_if_valid')
    expect(byKey('method')?.value).toBe('FRAGMENT')
    expect(byKey('fragment')?.value).toBe(true)
    expect(byKey('uuid')?.value).toEqual({ template: canonicalUuidTemplate })
    expect(byKey('apiJson')?.value).toEqual({
      uuid: { template: canonicalUuidTemplate },
      alias: { template: "{{actions['mokelay_fragment_create_submit_form'].outputs.returnData.values.name}}" },
      fragment: true,
      params: [],
      blocks: [{ uuid: 'starter', nextBlock: null }],
      response: {},
    })
    expect(byKey('apiJson')?.value).not.toHaveProperty('method')
    expect(byKey('apiJson')?.value).not.toHaveProperty('request')
    expect(byUuid(createPage, 'mokelay_fragment_create_open_created_api')?.inputs?.url?.template)
      .toBe("#/apis/{{actions['mokelay_fragment_create_execute_save'].outputs.api.uuid}}?fragment=true&appUuid={{context.appUuid}}")
  })
})
