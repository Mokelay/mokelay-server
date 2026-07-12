import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const assetsDir = resolve(process.cwd(), 'server/assets')

async function readJsonAsset<T>(relativePath: string) {
  return JSON.parse(await readFile(resolve(assetsDir, relativePath), 'utf8')) as T
}

type LayoutAsset = {
  resources: {
    mainMenu: {
      items: Array<{
        href?: string
        label?: string
      }>
    }
  }
}

type PageAsset = {
  blocks: Array<{
    id?: string
    type?: string
    data?: {
      activeTabId?: string
      tabs?: Array<{
        id?: string
        name?: string
        pageUUID?: string
        pageSource?: string
      }>
      columns?: Array<{
        columnName?: string
        fieldVariable?: string
        columnContent?: Array<{
          type?: string
          data?: {
            label?: string
          }
          events?: Array<{
            actions?: Array<{
              uuid?: string
              action?: string
              inputs?: {
                blockId?: string
                method?: string
                dsConfig?: {
                  path?: string
                  bodyData?: Array<{ key?: string }>
                }
              }
            }>
          }>
        }>
      }>
      ds?: {
        path?: string
        queryData?: Array<{ key?: string }>
      }
    }
  }>
}

type ApiAsset = {
  uuid: string
  method: string
  request: {
    query?: unknown[]
    body?: unknown[]
  }
  blocks: Array<{
    uuid: string
    functionName?: string
    inputs?: {
      table?: string
      fields?: string[]
      relations?: Array<{
        type?: string
        table?: string
        alias?: string
        localField?: string
        foreignField?: string
        fields?: Array<{
          field?: string
          as?: string
        }>
      }>
      conditions?: Array<{
        fieldName?: string
        fieldValue?: {
          template?: string
        }
      }>
    }
  }>
  responses: Record<string, Record<string, unknown>>
}

const settingPages = [
  {
    pageFile: 'mokelay-pages/setting_enterprise_page.json',
    tableId: 'setting-enterprise-table',
    listApi: 'list_enterprise',
    deleteApi: 'delete_enterprise_by_uuid',
    deleteBodyKey: 'uuid',
    expectedFields: ['id', 'uuid', 'name'],
  },
  {
    pageFile: 'mokelay-pages/setting_employees_page.json',
    tableId: 'setting-employees-table',
    listApi: 'list_employees',
    deleteApi: 'delete_employee_by_id',
    deleteBodyKey: 'id',
    expectedFields: ['id', 'enterprise_uuid', 'enterprise_name', 'name', 'email', 'plan', 'created_at', 'updated_at'],
  },
  {
    pageFile: 'mokelay-pages/setting_employee_auth_identities_page.json',
    tableId: 'setting-employee-auth-identities-table',
    listApi: 'list_employee_auth_identities',
    deleteApi: 'delete_employee_auth_identity_by_id',
    deleteBodyKey: 'id',
    expectedFields: [
      'id',
      'employee_id',
      'provider',
      'provider_user_id',
      'provider_email',
      'email_verified',
      'created_at',
      'updated_at',
    ],
  },
]

const listApis = [
  {
    apiFile: 'mokelay-apis/list_enterprise.json',
    table: 'enterprise',
    responseKey: 'enterprises',
    expectedFields: ['id', 'uuid', 'name'],
  },
  {
    apiFile: 'mokelay-apis/list_employees.json',
    table: 'employees',
    responseKey: 'employees',
    expectedFields: ['id', 'enterprise_uuid', 'name', 'email', 'plan', 'created_at', 'updated_at'],
  },
  {
    apiFile: 'mokelay-apis/list_employee_auth_identities.json',
    table: 'employee_auth_identities',
    responseKey: 'employee_auth_identities',
    expectedFields: [
      'id',
      'employee_id',
      'provider',
      'provider_user_id',
      'provider_email',
      'email_verified',
      'created_at',
      'updated_at',
    ],
  },
]

const deleteApis = [
  {
    apiFile: 'mokelay-apis/delete_enterprise_by_uuid.json',
    table: 'enterprise',
    bodyKey: 'uuid',
    conditionField: 'uuid',
  },
  {
    apiFile: 'mokelay-apis/delete_employee_by_id.json',
    table: 'employees',
    bodyKey: 'id',
    conditionField: 'id',
  },
  {
    apiFile: 'mokelay-apis/delete_employee_auth_identity_by_id.json',
    table: 'employee_auth_identities',
    bodyKey: 'id',
    conditionField: 'id',
  },
]

function tableBlock(page: PageAsset, tableId: string) {
  const block = page.blocks.find((item) => item.id === tableId)
  expect(block?.type).toBe('MAdvanceTable')
  return block
}

describe('setting assets', () => {
  it('adds the setting entry to the top navigation', async () => {
    const layout = await readJsonAsset<LayoutAsset>('mokelay-layouts/mokelay_layout.json')

    expect(layout.resources.mainMenu.items).toContainEqual(expect.objectContaining({
      href: '#/setting',
      label: '设置',
    }))
  })

  it('configures the setting page tabs for enterprise, employees, and auth identities', async () => {
    const page = await readJsonAsset<PageAsset>('mokelay-pages/setting.json')
    const tabsBlock = page.blocks.find((block) => block.id === 'setting-tabs')

    expect(tabsBlock?.type).toBe('MTabs')
    expect(tabsBlock?.data?.activeTabId).toBe('enterprise')
    expect(tabsBlock?.data?.tabs).toEqual([
      { id: 'enterprise', name: '企业', pageUUID: 'setting_enterprise_page', pageSource: 'system' },
      { id: 'employees', name: '员工', pageUUID: 'setting_employees_page', pageSource: 'system' },
      { id: 'employee-auth-identities', name: '员工授权', pageUUID: 'setting_employee_auth_identities_page', pageSource: 'system' },
    ])
  })

  it.each(settingPages)('binds $pageFile to the list and delete APIs', async ({
    pageFile,
    tableId,
    listApi,
    deleteApi,
    deleteBodyKey,
    expectedFields,
  }) => {
    const page = await readJsonAsset<PageAsset>(pageFile)
    const table = tableBlock(page, tableId)
    const columns = table?.data?.columns ?? []
    const fieldVariables = columns.map((column) => column.fieldVariable)
    const deleteButton = columns
      .find((column) => column.fieldVariable === 'action')
      ?.columnContent
      ?.find((content) => content.type === 'MButton' && content.data?.label === '删除')
    const actions = deleteButton?.events?.flatMap((event) => event.actions ?? []) ?? []
    const executeAction = actions.find((action) => action.action === 'execute_ds')
    const refreshAction = actions.find((action) => action.action === 'call_block_method')

    expect(table?.data?.ds?.path).toBe(`/api/mokelay/${listApi}`)
    expect(table?.data?.ds?.queryData?.map((item) => item.key)).toEqual(['page', 'pageSize'])
    expect(fieldVariables).toEqual(expect.arrayContaining([...expectedFields, 'action']))
    expect(fieldVariables).not.toContain('password_hash')
    expect(fieldVariables).not.toContain('profile')
    expect(actions.map((action) => action.action)).toEqual([
      'confirm',
      'if_controller',
      'execute_ds',
      'call_block_method',
    ])
    expect(executeAction?.inputs?.dsConfig?.path).toBe(`/api/mokelay/${deleteApi}`)
    expect(executeAction?.inputs?.dsConfig?.bodyData).toContainEqual(expect.objectContaining({
      key: deleteBodyKey,
    }))
    expect(refreshAction?.inputs).toMatchObject({
      blockId: tableId,
      method: 'refresh',
    })
  })

  it.each(listApis)('declares a paginated list API asset for $table', async ({
    apiFile,
    table,
    responseKey,
    expectedFields,
  }) => {
    const api = await readJsonAsset<ApiAsset>(apiFile)
    const pageBlock = api.blocks.find((block) => block.functionName === 'page')
    const response = api.responses[pageBlock?.uuid ?? '']

    expect(api.method).toBe('GET')
    expect(api.request.query).toEqual(['page', 'pageSize'])
    expect(pageBlock?.inputs?.table).toBe(table)
    expect(pageBlock?.inputs?.fields).toEqual(expectedFields)
    expect(response?.[responseKey]).toEqual(expect.objectContaining({
      template: `{{blocks['${pageBlock?.uuid}'].outputs.datas}}`,
    }))
    expect(response?.pagination).toBeTruthy()
  })

  it('configures the employees list API to read enterprise_name through page relations', async () => {
    const api = await readJsonAsset<ApiAsset>('mokelay-apis/list_employees.json')
    const pageBlock = api.blocks.find((block) => block.functionName === 'page')

    expect(pageBlock?.inputs?.relations).toEqual([
      {
        type: 'left',
        table: 'enterprise',
        alias: 'enterprise',
        localField: 'enterprise_uuid',
        foreignField: 'uuid',
        fields: [
          {
            field: 'name',
            as: 'enterprise_name',
          },
        ],
      },
    ])
  })

  it('shows enterprise_name after enterprise_uuid on the employees setting page', async () => {
    const page = await readJsonAsset<PageAsset>('mokelay-pages/setting_employees_page.json')
    const table = tableBlock(page, 'setting-employees-table')

    expect(table?.data?.columns?.map((column) => column.fieldVariable)).toEqual([
      'id',
      'enterprise_uuid',
      'enterprise_name',
      'name',
      'email',
      'plan',
      'created_at',
      'updated_at',
      'action',
    ])
  })

  it.each(deleteApis)('declares a direct delete API asset for $table', async ({
    apiFile,
    table,
    bodyKey,
    conditionField,
  }) => {
    const api = await readJsonAsset<ApiAsset>(apiFile)
    const deleteBlock = api.blocks.find((block) => block.functionName === 'delete')
    const condition = deleteBlock?.inputs?.conditions?.[0]

    expect(api.method).toBe('POST')
    expect(api.request.body).toEqual([bodyKey])
    expect(deleteBlock?.inputs?.table).toBe(table)
    expect(condition?.fieldName).toBe(conditionField)
    expect(condition?.fieldValue?.template).toBe(`{{request.body.${bodyKey}}}`)
  })
})
