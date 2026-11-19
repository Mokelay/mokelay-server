import 'dotenv/config'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const template = value => ({ template: `{{${value}}}` })
const method = (uuid, blockId, name, inputs = {}) => ({ uuid, action: 'call_block_method', inputs: { blockId, method: name, ...inputs }, outputs: ['returnData'] })
const chain = actions => actions.map((action, i) => ({ ...action, nextAction: action.nextAction === undefined ? actions[i + 1]?.uuid ?? null : action.nextAction }))
const binding = (blockId, variable) => ({ mode: 'variable', source: 'Block', blockId, variable })
const read = (id, field) => `blocks['${id}'].${field}`

export function readApiRecordFields(api) {
  const record = api.response?.record
  const sourceId = record?.template?.match(/^\{\{blocks\.([^.]*)\.outputs\.data\}\}$/)?.[1]
  const source = api.blocks?.find(block => block.uuid === sourceId && block.functionName === 'read')
  const fields = source?.inputs?.fields
  if (!Array.isArray(fields) || !fields.length || fields.some(field => typeof field !== 'string')) {
    throw new Error(`Cannot determine record fields; review API before migration: ${api.uuid}`)
  }
  const defaults = record.processors?.find(processor => processor.processor === 'default_value')?.param
  return defaults ? fields.filter(field => Object.hasOwn(defaults, field)) : fields
}

function migrateHintEvent(form, condition) {
  const item = form.data.items?.find(item => item.variableName === condition.field)
  const editor = item?.editor
  if (!form.id || !editor?.id || editor.type !== 'MSelectField' || typeof condition.equals !== 'string') {
    throw new Error(`Hint controller requires review: ${form.id}`)
  }
  const initializers = form.events?.filter(event => event.event === 'init') ?? []
  const init = initializers[0]
  const restore = init?.actions?.find(action => action.uuid === 'restore_fields'
    && action.action === 'call_block_method' && action.inputs?.blockId === form.id
    && action.inputs?.method === 'setValues' && Object.hasOwn(action.inputs.values ?? {}, condition.field))
  if (initializers.length !== 1 || !restore || restore.nextAction === undefined) {
    throw new Error(`Custom hint initialization requires review: ${form.id}`)
  }
  const ruleId = `${editor.id}-hint-visibility`
  const triggerId = `${editor.id}-sync-hints`
  if (editor.events?.some(event => event.actions?.some(action => action.uuid === ruleId))
      || init.actions.some(action => action.uuid === triggerId)) throw new Error(`Hint event ID conflict: ${editor.id}`)
  editor.events = [...(editor.events ?? []), {
    event: 'change', execution: { concurrency: 'serialLatest' }, actions: [
      { uuid: ruleId, action: 'switch_controller', type: 'controller', inputs: { dataType: 'string', value: template('event.value') }, nodes: [
        { uuid: 'show', value: condition.equals, nextAction: 'show_hints' },
        { uuid: 'hide', type: 'DEFAULT', nextAction: 'hide_hints' }
      ], nextAction: null },
      { ...method('show_hints', form.id, 'setStatus', { showHints: true }), nextAction: null },
      { ...method('hide_hints', form.id, 'setStatus', { showHints: false }), nextAction: null }
    ]
  }]
  init.actions.splice(init.actions.indexOf(restore) + 1, 0, {
    uuid: triggerId, action: 'trigger_event', inputs: { blockId: editor.id, event: 'change', payload: {
      value: template(`actions.${restore.uuid}.outputs.returnData.values.${condition.field}`)
    } }, outputs: ['result'], nextAction: restore.nextAction
  })
  restore.nextAction = triggerId
  delete form.data.draft.showHintsWhen
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return
  visit(value)
  Object.values(value).forEach(child => walk(child, visit))
}

// Legacy configuration is interpreted only by this offline migration, never by MForm.
function migrateFormPresentation(document, blocks, form, draft) {
  if (!form.id) throw new Error('Form presentation migration requires a block ID')
  const unknown = Object.keys(draft).filter(key => !['title', 'fields', 'showHintsWhen', 'initApi', 'saveApi', 'submitApi', 'apiApp'].includes(key))
  if (unknown.length) throw new Error(`Custom draft configuration requires review: ${form.id}: ${unknown.join(', ')}`)
  const ids = new Set()
  const graphs = []
  walk(document, value => {
    if (value.type && value.data && value.id) ids.add(value.id)
    for (const event of Array.isArray(value.events) ? value.events : []) {
      for (const key of ['actions', 'onError', 'onFinally']) if (Array.isArray(event[key])) graphs.push(event[key])
    }
  })
  const reserve = id => {
    if (ids.has(id)) throw new Error(`Migration ID conflict: ${id}`)
    ids.add(id)
  }
  const prefix = []
  if (draft.title !== undefined && typeof draft.title !== 'string') throw new Error(`Custom title requires review: ${form.id}`)
  if (draft.title?.trim()) {
    const id = `${form.id}-title`
    reserve(id)
    prefix.push({ id, type: 'MHeading', data: { text: draft.title, level: '1', align: 'left' } })
  }
  const matches = action => action.action === 'call_block_method' && action.inputs?.blockId === form.id
    && action.inputs?.method === 'setStatus' && Object.hasOwn(action.inputs, 'message')
  if (graphs.some(actions => actions.some(matches))) {
    const stateId = `${form.id}-state`, textId = `${form.id}-status`
    reserve(textId)
    let state = blocks.find(block => block.id === stateId)
    if (state && (state.type !== 'MPageState' || state.data?.readonly || Object.hasOwn(state.data?.initialState ?? {}, 'statusMessage'))) {
      throw new Error(`Status state requires review: ${stateId}`)
    }
    if (!state) {
      reserve(stateId)
      state = { id: stateId, type: 'MPageState', data: { initialState: {} } }
      prefix.unshift(state)
    }
    state.data.initialState = { ...state.data.initialState, statusMessage: '' }
    prefix.push({ id: textId, type: 'MRichText', data: { content: binding(stateId, 'statusMessage') } })
    for (const actions of graphs) {
      for (const action of [...actions]) {
        if (!matches(action)) continue
        const uuid = `${action.uuid}-message`
        if (actions.some(candidate => candidate.uuid === uuid)) throw new Error(`Status action ID conflict: ${uuid}`)
        // A caller consuming the old message return value needs an explicit rewrite.
        if (JSON.stringify(document).includes(`actions.${action.uuid}.outputs.returnData.message`)) {
          throw new Error(`Status message output requires review: ${action.uuid}`)
        }
        const message = action.inputs.message
        delete action.inputs.message
        actions.splice(actions.indexOf(action) + 1, 0, {
          ...method(uuid, stateId, 'merge', { value: { statusMessage: message } }), nextAction: action.nextAction ?? null
        })
        action.nextAction = uuid
      }
    }
  }
  const initializers = form.events?.filter(event => event.event === 'init') ?? []
  if (initializers.length > 1) throw new Error(`Custom form initialization requires review: ${form.id}`)
  let init = initializers[0]
  if (!init) {
    init = { event: 'init', actions: [] }
    form.events = [...(form.events ?? []), init]
  }
  const first = init.actions?.[0]
  if (first?.action === 'call_block_method' && first.inputs?.blockId === form.id && first.inputs?.method === 'setStatus') {
    if (!Object.hasOwn(first.inputs, 'showHints')) first.inputs.showHints = false
  } else {
    const uuid = `${form.id}-initial-hints`
    if (init.actions?.some(action => action.uuid === uuid)) throw new Error(`Hint action ID conflict: ${uuid}`)
    init.actions = [{ ...method(uuid, form.id, 'setStatus', { showHints: false }), nextAction: first?.uuid ?? null }, ...(init.actions ?? [])]
  }
  blocks.splice(blocks.indexOf(form), 0, ...prefix)
  delete form.data.draft
}

export function migrateFormEvents(document, getRecordFields) {
  const result = structuredClone(document)
  let changed = 0
  function migrateArray(blocks) {
    if (!Array.isArray(blocks)) return
    for (const form of [...blocks]) {
      const draft = form?.type === 'MForm' && form.data?.draft
      let migrated = false
      if (draft?.fields) {
        for (const item of form.data.items ?? []) {
          if (Object.hasOwn(draft.fields, item.variableName)) item.rules = { ...draft.fields[item.variableName], ...item.rules }
        }
      }
      if (draft?.initApi || draft?.saveApi || draft?.submitApi) {
        if (!form.id || !draft.initApi || !draft.saveApi || !draft.submitApi) throw new Error('Incomplete legacy form API configuration')
        const id = form.id, stateId = `${id}-state`, retryId = `${id}-retry`
        if (blocks.some(block => block.id === stateId || block.id === retryId)) throw new Error(`Migration ID conflict: ${id}`)
        if (form.events?.some(event => ['init', 'change'].includes(event.event))) throw new Error(`Existing form event requires review: ${id}`)
        const recordFields = getRecordFields?.(draft.apiApp ?? 'mokelay', draft.initApi)
        const fields = (form.data.items ?? []).map(item => item.variableName)
          .filter(field => !recordFields || recordFields.includes(field))
        const editable = (form.data.items ?? []).filter(item => !item.rules?.readOnly).map(item => item.variableName)
        const derived = fields.filter(field => !editable.includes(field))
        const state = field => template(read(stateId, field))
        const patch = (uuid, value) => method(uuid, stateId, 'merge', { value })
        const status = (uuid, value) => method(uuid, id, 'setStatus', value)
        const request = (uuid, api, values) => ({ uuid, action: 'execute_ds', inputs: { dsConfig: {
          type: 'API', domain: 'mokelay', path: `/api/${draft.apiApp ?? 'mokelay'}/${api}`, method: values ? 'POST' : 'GET', headerData: [], queryData: [],
          bodyData: values ? [
            { key: 'id', dataType: 'string', value: state('record.id') },
            { key: 'version', dataType: 'number', value: state('record.version') },
            ...editable.map(key => ({ key, dataType: 'string', value: template(`${values}.${key}`) }))
          ] : []
        } }, outputs: ['rawResponse'] })
        const response = uuid => `actions.${uuid}.outputs.rawResponse.data`
        const acknowledge = (uuid, all = false) => [
          patch('store_record', { record: template(`${response(uuid)}.record`), hideRetry: true }),
          method('restore_fields', id, 'setValues', { values: Object.fromEntries((all ? fields : derived).map(field => [field, template(`${response(uuid)}.record.${field}`)])) })
        ]
        const failure = (blockId, event, message) => chain([
          patch('remember_failure', { hideRetry: false, failedBlock: blockId, failedEvent: event }),
          status('show_error', { message, errors: [{ message: template('event.error.message') }] })
        ])
        const finish = chain([patch('finish', { busy: false, locked: state('submitted') }), status('unlock', { loading: false, disabled: state('locked') })])
        const execution = { concurrency: 'serialLatest', debounceMs: 400, retry: 'resumeUnconfirmed', flushOn: ['hidden', 'unmount'] }
        const init = { event: 'init', execution: { concurrency: 'drop' }, actions: chain([
          status('loading', { loading: true, disabled: true, message: '正在加载…', errors: [] }),
          request('load', draft.initApi), ...acknowledge('load', true),
          method('options', id, 'setFieldOptions', { options: template(`${response('load')}.options`) }),
          patch('ready', { locked: false, ready: true }), status('loaded', { message: '将自动保存填写内容', errors: [] })
        ]), onError: failure(id, 'init', '初始化失败'), onFinally: chain([
          patch('finish_init', { busy: false }), status('finish_loading', { loading: false, disabled: state('locked') })
        ]) }
        const change = { event: 'change', execution, actions: chain([
          { uuid: 'valid', action: 'if_controller', type: 'controller', inputs: { value: template('event.valid') }, nodes: [{ uuid: 'yes', value: true, nextAction: 'saving' }, { uuid: 'no', value: false, nextAction: null }], nextAction: null },
          status('saving', { message: '正在保存…', errors: [] }), request('save', draft.saveApi, 'event.values'), ...acknowledge('save'), status('saved', { message: '草稿已保存', errors: [] })
        ]), onError: failure(id, 'change', '草稿未保存') }
        const buttons = blocks.filter(block => block.events?.some(event => event.actions?.some(action => action.inputs?.blockId === id && action.inputs?.method === 'submitDraft')))
        for (const button of buttons) {
          button.data.disabled = binding(stateId, 'locked'); button.data.hidden = binding(stateId, 'submitted')
          for (const event of button.events) {
            if (!event.actions?.some(action => action.inputs?.blockId === id && action.inputs?.method === 'submitDraft')) continue
            if (event.actions.length !== 1) throw new Error(`Custom submit chain requires review: ${button.id}`)
            Object.assign(event, { execution: { concurrency: 'drop', retry: 'resumeUnconfirmed' }, actions: chain([
              patch('lock', { locked: true, busy: true }), status('submitting', { disabled: true, message: '正在提交…', errors: [] }),
              { uuid: 'flush', action: 'flush_event', inputs: { blockId: id, event: 'change' } },
              method('validate', id, 'submit'),
              { uuid: 'valid', action: 'if_controller', type: 'controller', inputs: { value: template('actions.validate.outputs.returnData.valid') }, nodes: [{ uuid: 'yes', value: true, nextAction: 'send' }, { uuid: 'no', value: false, nextAction: 'invalid' }], nextAction: null },
              status('invalid', { message: '请检查表单填写内容。' }),
              // The validation failure branch ends before any request.
              request('send', draft.submitApi, 'actions.validate.outputs.returnData.values'), ...acknowledge('send'),
              patch('submitted', { submitted: true, hideRetry: true }), status('receipt', { message: { template: `已提交 · 申请单号 {{${response('send')}.record.id}}` }, errors: [] })
            ]).map(action => action.uuid === 'invalid' ? { ...action, nextAction: null } : action), onError: failure(button.id, event.event, '提交失败'), onFinally: finish })
          }
        }
        const retry = { id: retryId, type: 'MButton', data: { label: '重试', variant: 'text', align: 'center', hidden: binding(stateId, 'hideRetry'), disabled: binding(stateId, 'busy') }, events: [{ event: 'click', execution: { concurrency: 'drop' }, actions: chain([
          patch('retry_busy', { busy: true, locked: true }), status('retry_lock', { disabled: true }),
          { uuid: 'retry', action: 'retry_event', inputs: { blockId: state('failedBlock'), event: state('failedEvent') } }
        ]), onError: chain([status('retry_error', { errors: [{ message: template('event.error.message') }] })]), onFinally: chain([
          { uuid: 'retry_ready', action: 'if_controller', type: 'controller', inputs: { value: state('ready') }, nodes: [{ uuid: 'yes', value: true, nextAction: 'retry_finished' }, { uuid: 'no', value: false, nextAction: 'retry_not_ready' }], nextAction: null },
          { ...patch('retry_finished', { busy: false, locked: state('submitted') }), nextAction: 'retry_unlock' },
          patch('retry_not_ready', { busy: false, locked: true }), status('retry_unlock', { disabled: state('locked') })
        ]) }] }
        form.data.draft = { title: draft.title ?? '', ...(draft.showHintsWhen ? { showHintsWhen: draft.showHintsWhen } : {}) }
        form.events = [...(form.events ?? []), init, change]
        blocks.splice(blocks.indexOf(form), 0, { id: stateId, type: 'MPageState', data: { initialState: { record: {}, ready: false, locked: true, busy: true, submitted: false, hideRetry: true, failedBlock: id, failedEvent: 'init' } } })
        blocks.splice(blocks.indexOf(form) + 1, 0, retry)
        changed++
        migrated = true
      }
      if (draft?.showHintsWhen) {
        migrateHintEvent(form, draft.showHintsWhen)
      }
      if (draft) {
        migrateFormPresentation(result, blocks, form, draft)
        if (!migrated) changed++
      }
      function visit(value) {
        if (!value || typeof value !== 'object') return
        if (Array.isArray(value) && value.some(item => item?.type && item?.data)) migrateArray(value)
        else for (const child of Object.values(value)) visit(child)
      }
      visit(form?.data)
    }
  }
  if (Array.isArray(result)) migrateArray(result)
  else migrateArray(result.blocks)
  return { document: result, changed }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const backup = path.resolve(process.env.FORM_MIGRATION_BACKUP ?? `/tmp/mokelay-form-events-${Date.now()}`)
  let total = 0
  const saveBackup = async (name, text) => { await mkdir(backup, { recursive: true, mode: 0o700 }); await writeFile(path.join(backup, name), text, { mode: 0o600 }) }
  const assetRoot = path.resolve('server/assets')
  const getRecordFields = (app, api) => readApiRecordFields(JSON.parse(readFileSync(path.join(assetRoot, app, 'apis', `${api}.json`), 'utf8')))
  for (const app of await readdir(assetRoot)) {
    const directory = path.join(assetRoot, app, 'pages')
    const files = await readdir(directory).catch(() => [])
    for (const file of files.filter(file => file.endsWith('.json'))) {
      const filename = path.join(directory, file), original = await readFile(filename, 'utf8')
      const result = migrateFormEvents(JSON.parse(original), getRecordFields)
      if (!result.changed) continue
      if (apply) { await saveBackup(`${app}-${file}`, original); await writeFile(filename, JSON.stringify(result.document, null, 2) + '\n') }
      total += result.changed
      console.log(`${apply ? 'Migrated' : 'Would migrate'} asset ${app}/${file}: ${result.changed} form(s)`)
    }
  }
  if (process.argv.includes('--database')) {
    const url = new URL(process.env.Mokelay_DATABASE_URL)
    if (!['localhost','127.0.0.1','::1'].includes(url.hostname) || url.protocol !== 'mysql:') throw new Error('This migration only updates the local MySQL platform database')
    const { default: mysql } = await import('mysql2/promise')
    const db = await mysql.createConnection(url.href)
    try {
      await db.beginTransaction()
      const [rows] = await db.query('SELECT uuid, blocks FROM pages FOR UPDATE')
      for (const row of rows) {
        const original = typeof row.blocks === 'string' ? row.blocks : JSON.stringify(row.blocks)
        const result = migrateFormEvents(JSON.parse(original), getRecordFields)
        if (!result.changed) continue
        if (apply) { await saveBackup(`page-${encodeURIComponent(row.uuid)}.json`, original); await db.execute('UPDATE pages SET blocks = ? WHERE uuid = ?', [JSON.stringify(result.document), row.uuid]) }
        total += result.changed; console.log(`${apply ? 'Migrated' : 'Would migrate'} saved page ${row.uuid}: ${result.changed} form(s)`)
      }
      if (apply) await db.commit(); else await db.rollback()
    } catch (error) { await db.rollback(); throw error } finally { await db.end() }
  }
  console.log(JSON.stringify({ apply, forms: total, ...(apply && total ? { backup } : {}) }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
