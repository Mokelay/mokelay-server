import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { migrateFormEvents, readApiRecordFields } from '../../scripts/migrate-form-events.mjs'
const legacy = () => ({ blocks: [
  { id: 'form', type: 'MForm', data: { draft: { title: 'Test', apiApp: 'lark', initApi: 'load', saveApi: 'save', submitApi: 'send' }, items: [{ variableName: 'note' }] } },
  { id: 'send', type: 'MButton', data: { label: 'Send' }, events: [{ event: 'click', actions: [{ uuid: 'send', action: 'call_block_method', inputs: { blockId: 'form', method: 'submitDraft' } }] }] }
] })
describe('form event migration', () => {
  it('moves hint conditions into editor events and reuses them after a silent restore', () => {
    const page = legacy()
    const form = page.blocks[0]
    form.data.draft.showHintsWhen = { field: 'help', equals: 'yes' }
    const existing = { event: 'change', actions: [{ uuid: 'custom', action: 'call_block_method', inputs: { blockId: 'form', method: 'getData' } }] }
    form.data.items.push({ variableName: 'help', editor: { id: 'help-field', type: 'MSelectField', data: {}, events: [existing] } })
    const { document, changed } = migrateFormEvents(page)
    expect(changed).toBe(1)
    const migrated = document.blocks.find(block => block.id === 'form')
    expect(migrated.data.draft).toEqual({ title: 'Test' })
    const field = migrated.data.items.find(item => item.variableName === 'help')
    expect(field).not.toHaveProperty('events')
    expect(field.editor.events[0]).toEqual(existing)
    expect(field.editor.events[1]).toMatchObject({ event: 'change', execution: { concurrency: 'serialLatest' }, actions: [
      { action: 'switch_controller', inputs: { value: { template: '{{event.value}}' } } },
      { inputs: { showHints: true } }, { inputs: { showHints: false } }
    ] })
    const init = migrated.events.find(event => event.event === 'init')
    expect(init.actions.find(action => action.uuid === 'restore_fields').nextAction).toBe('help-field-sync-hints')
    expect(init.actions.find(action => action.action === 'trigger_event')).toMatchObject({ inputs: {
      blockId: 'help-field', event: 'change', payload: { value: { template: '{{actions.restore_fields.outputs.returnData.values.help}}' } }
    }, nextAction: 'options' })
    expect(migrateFormEvents(document)).toEqual({ document, changed: 0 })
    expect(form.data.draft).toHaveProperty('showHintsWhen')
  })

  it('migrates hints on an already event-based form, but refuses ambiguous initialization', () => {
    const page = legacy()
    page.blocks[0].data.items.push({ variableName: 'help', editor: { id: 'help', type: 'MSelectField', data: {} } })
    const { document } = migrateFormEvents(page)
    const form = document.blocks.find(block => block.id === 'form')
    form.data.draft.showHintsWhen = { field: 'help', equals: 'yes' }
    expect(migrateFormEvents(document).changed).toBe(1)
    form.events[0].actions.find(action => action.uuid === 'restore_fields').uuid = 'custom_restore'
    expect(() => migrateFormEvents(document)).toThrow('Custom hint initialization requires review')
    expect(form.data.draft).toHaveProperty('showHintsWhen')
  })

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
