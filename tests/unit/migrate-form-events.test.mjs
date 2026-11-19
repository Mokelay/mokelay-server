import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { migrateFormEvents, readApiRecordFields } from '../../scripts/migrate-form-events.mjs'
const legacy = () => ({ blocks: [
  { id: 'form', type: 'MForm', data: { draft: { title: 'Test', apiApp: 'lark', initApi: 'load', saveApi: 'save', submitApi: 'send' }, items: [{ variableName: 'note' }] } },
  { id: 'send', type: 'MButton', data: { label: 'Send' }, events: [{ event: 'click', actions: [{ uuid: 'send', action: 'call_block_method', inputs: { blockId: 'form', method: 'submitDraft' } }] }] }
] })
describe('form event migration', () => {
  it('moves all API interactions to events and is idempotent', () => {
    const original = legacy(), { document, changed } = migrateFormEvents(original)
    expect(changed).toBe(1)
    const form = document.blocks.find(block => block.id === 'form')
    expect(form.data.draft).toEqual({ title: 'Test' })
    expect(form.events.map(event => event.event)).toEqual(['init', 'change'])
    expect(form.events[1].execution).toMatchObject({ debounceMs: 400, concurrency: 'serialLatest', retry: 'resumeUnconfirmed' })
    const json = JSON.stringify(document)
    for (const key of ['initApi', 'saveApi', 'submitApi', 'apiApp', 'submitDraft', '$draft']) expect(json).not.toContain(key)
    for (const path of ['/api/lark/load', '/api/lark/save', '/api/lark/send']) expect(json).toContain(path)
    expect(migrateFormEvents(document)).toEqual({ document, changed: 0 })
    expect(original).toEqual(legacy())
  })
  it('rejects custom chains and generated ID collisions before overwriting them', () => {
    const page = legacy()
    page.blocks[1].events[0].actions.push({ uuid: 'custom', action: 'confirm' })
    expect(() => migrateFormEvents(page)).toThrow('Custom submit chain')
    const conflict = legacy()
    conflict.blocks.push({ id: 'form-state', type: 'MPageState', data: {} })
    expect(() => migrateFormEvents(conflict)).toThrow('Migration ID conflict')
  })

  it('keeps display-only defaults out of API response mappings', () => {
    const page = legacy()
    page.blocks[0].data.defaultValues = { localAmount: '0', settlement: '0.00' }
    page.blocks[0].data.items.push(
      { variableName: 'localAmount', rules: { readOnly: true } },
      { variableName: 'settlement', rules: { readOnly: true } },
    )
    const { document } = migrateFormEvents(page, () => ['note', 'settlement'])
    const restores = document.blocks.flatMap(block => block.events ?? []).flatMap(event => event.actions)
      .filter(action => action.inputs?.method === 'setValues')
    expect(restores).toHaveLength(3)
    for (const action of restores) {
      expect(action.inputs.values).not.toHaveProperty('localAmount')
      expect(action.inputs.values).toHaveProperty('settlement')
    }
    expect(document.blocks.find(block => block.id === 'form').data.defaultValues.localAmount).toBe('0')
  })

  it('only references fields returned by the real reimbursement API assets', () => {
    const asset = name => JSON.parse(readFileSync(new URL(`../../server/assets/lark/${name}.json`, import.meta.url), 'utf8'))
    const fields = {
      load: readApiRecordFields(asset('apis/reimbursement_201_init')),
      save: readApiRecordFields(asset('apis/fragment/reimbursement_201_write')),
      send: readApiRecordFields(asset('apis/fragment/reimbursement_201_write')),
    }
    const page = asset('pages/reimbursement_201')
    const references = [...JSON.stringify(page).matchAll(/\{\{actions\.(load|save|send)\.outputs\.rawResponse\.data\.record\.([^}]+)\}\}/g)]
    expect(new Set(references.map(match => match[1]))).toEqual(new Set(['load', 'save', 'send']))
    for (const [, action, field] of references) expect(fields[action]).toContain(field)
    expect(page.blocks.find(block => block.type === 'MForm').data.defaultValues.approval_amount).toBe('0')
  })
})
