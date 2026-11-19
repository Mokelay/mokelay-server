import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'
import { sql, type SQL } from 'drizzle-orm'
import { closeDatasourceConnection, executeDatasourceSql } from 'mokelay-server-core/utils/db'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMokelayOrchestrationHandler } from 'mokelay-server-core/utils/orchestration'
import { setSessionValue } from 'mokelay-server-core/utils/session'
import { serverBlockDefinitions } from '../../server/utils/blocks'

// Point each URL at a migrated local test database. Cleanup is scoped to these fixtures.
const databases = [
  { name: 'MySQL', url: process.env.REIMBURSEMENT_TEST_MYSQL_URL, larkUrl: process.env.LARK_TEST_MYSQL_URL },
  { name: 'PostgreSQL', url: process.env.REIMBURSEMENT_TEST_POSTGRES_URL, larkUrl: process.env.LARK_TEST_POSTGRES_URL },
]
for (const { name, url, larkUrl } of databases) {
  describe.skipIf(!url || !larkUrl)(`reimbursement DSL with ${name}`, () => {
    const tenants = [randomUUID(), randomUUID()]
    const employees = [randomUUID(), randomUUID(), randomUUID()]
    const execute = (query: SQL) => executeDatasourceSql(query, 'Mokelay')
    const business = (query: SQL) => executeDatasourceSql(query, 'Lark')
    let server: Server
    let base: string
    let responseReferences: RegExpMatchArray[]
    const cookies: string[] = []
    beforeAll(async () => {
      vi.stubEnv('Mokelay_DATABASE_URL', url!)
      vi.stubEnv('Lark_DATABASE_URL', larkUrl!)
      expect(new URL(url!).pathname).not.toBe(new URL(larkUrl!).pathname)
      vi.stubEnv('SESSION_SECRET', 'local-reimbursement-integration-test-secret')
      const app = createApp()
      const router = createRouter()
      for (const uuid of tenants) await execute(sql`INSERT INTO enterprise (uuid, name) VALUES (${uuid}, 'Test')`)
      for (const [index, employee] of employees.entries()) {
        const tenant = tenants[index === 2 ? 1 : 0]
        await execute(sql`INSERT INTO employees (id, enterprise_uuid, name, email, password_hash)
          VALUES (${employee}, ${tenant}, 'Test', ${employee + '@example.test'}, '')`)
        router.get('/session/' + index, defineEventHandler(event => {
          setSessionValue(event, 'user', { id: employee, enterprise_uuid: tenant })
          return {}
        }))
      }
      // Use the real write graph, then force response resolution to fail after its INSERT.
      const asset = (name: string) => readFile(new URL(`../../server/assets/lark/apis/${name}.json`, import.meta.url), 'utf8').then(JSON.parse)
      const save = await asset('reimbursement_201_save_draft')
      const write = await asset('fragment/reimbursement_201_write')
      const page = await readFile(new URL('../../server/assets/lark/pages/reimbursement_201.json', import.meta.url), 'utf8')
      responseReferences = [...page.matchAll(/\{\{actions\.(load|save|send)\.outputs\.rawResponse\.data\.record\.([^}]+)\}\}/g)]
      router.use('/rollback/:apiJsonUuid', createMokelayOrchestrationHandler({
        blockDefinitions: serverBlockDefinitions,
        loadApiJson: async uuid => uuid === save.uuid ? save : {
          ...write, response: { record: { template: '{{blocks.read_result.outputs.missing}}' } },
        },
      }))
      router.use('/api/lark/:apiJsonUuid', createMokelayOrchestrationHandler({ assetApp: 'lark', blockDefinitions: serverBlockDefinitions }))
      app.use(router)
      server = createServer(toNodeListener(app))
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
      for (const index of employees.keys()) {
        const response = await fetch(base + '/session/' + index)
        cookies.push(response.headers.get('set-cookie')!.split(';')[0]!)
      }
    })
    afterAll(async () => {
      if (server) await new Promise<void>(resolve => server.close(() => resolve()))
      const employeeIds = sql.join(employees.map(id => sql`${id}`), sql`, `)
      const tenantIds = sql.join(tenants.map(id => sql`${id}`), sql`, `)
      try {
        await business(sql`DELETE FROM reimbursement_applications WHERE employee_id IN (${employeeIds})`)
        const lockIds = employees.map((id, i) => tenants[i === 2 ? 1 : 0] + ':' + id)
        await business(sql`DELETE FROM reimbursement_write_locks WHERE id IN (${sql.join(lockIds.map(id => sql`${id}`), sql`, `)})`)
        await execute(sql`DELETE FROM employees WHERE id IN (${employeeIds})`)
        await execute(sql`DELETE FROM enterprise WHERE uuid IN (${tenantIds})`)
      } finally {
        await closeDatasourceConnection('Mokelay')
        await closeDatasourceConnection('Lark')
        vi.unstubAllEnvs()
      }
    })

    async function call(action: 'init' | 'save_draft' | 'submit', body?: Record<string, unknown>, cookie = cookies[0]) {
      const res = await fetch(base + '/api/lark/reimbursement_201_' + action, {
        method: body ? 'POST' : 'GET', headers: { cookie: cookie ?? '', 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const response = await res.json()
      if (response.ok) {
        const actionId = { init: 'load', save_draft: 'save', submit: 'send' }[action]
        for (const [, source, field] of responseReferences) {
          if (source === actionId) expect(response.data.record, `${action} must supply the DSL field ${field}`).toHaveProperty(field)
        }
      }
      return response
    }

    it('autosaves a travel draft with blank amounts once, even when two first saves overlap', async () => {
      const cookie = cookies[1]
      const { data } = await call('init', undefined, cookie)
      expect(data.record).not.toHaveProperty('approval_amount')
      const payload = { ...data.record, category: 'travel', fiat: '', crypto: '', loan: '' }
      const [first, retry] = await Promise.all([call('save_draft', payload, cookie), call('save_draft', payload, cookie)])
      expect(first).toMatchObject({ ok: true, data: { record: {
        id: payload.id, category: 'travel', version: 1, status: 'draft', settlement: '0.00',
      } } })
      expect(retry.data.record).toEqual(first.data.record)
      expect((await call('init', undefined, cookie)).data.record).toEqual(first.data.record)

      const edits = ['Taxi', 'Bus'].map(note => ({ ...first.data.record, fiat: '99999999999999.99', note }))
      const attempts = await Promise.all(edits.map(edit => call('save_draft', edit, cookie)))
      const accepted = attempts.filter(reply => reply.ok)
      expect(accepted).toHaveLength(1)
      expect(accepted[0].data.record).toMatchObject({ version: 2, settlement: '99999999999999.99' })
      expect(attempts.find(reply => !reply.ok)?.error.code).toBe('BLOCK_UNIQUE_CONFLICT')
      const changedCent = { ...accepted[0].data.record, fiat: '99999999999999.98', version: 1 }
      expect((await call('save_draft', changedCent, cookie)).error.code).toBe('BLOCK_UNIQUE_CONFLICT')
    })

    it('rolls back the insert when building the Fragment result fails', async () => {
      const cookie = cookies[2]
      const { data } = await call('init', undefined, cookie)
      const payload = { ...data.record, category: 'office' }
      const failed = await fetch(base + '/rollback/reimbursement_201_save_draft', {
        method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(payload),
      })
      expect((await failed.json()).error.code).toBe('TEMPLATE_VARIABLE_NOT_FOUND')
      expect((await call('init', undefined, cookie)).data.record.version).toBe(0)
      expect(await call('save_draft', payload, cookie)).toMatchObject({ ok: true, data: { record: { id: payload.id, version: 1 } } })
      // Release this owner's draft so the isolation test also exercises the duplicate primary key.
      const saved = (await call('init', undefined, cookie)).data.record
      expect((await call('submit', saved, cookie)).ok).toBe(true)
    })

    it('restores only the owner’s draft, computes exact settlement and makes submission idempotent', async () => {
      expect((await call('init', undefined, '')).ok).toBe(false)
      const { data } = await call('init')
      expect(data.options.category.map((item: { value: string }) => item.value)).toEqual(['travel', 'office', 'other'])
      const fresh = data.record
      expect(fresh.settlement).toBe('0.00')
      expect((await call('submit', fresh)).ok).toBe(false)
      const draft = (await call('save_draft', fresh)).data.record
      expect(draft.version).toBe(1)
      expect((await call('save_draft', fresh)).data.record.version).toBe(1)
      const filled = { ...draft, fiat: '100.10', crypto: '0.20', loan: '20', category: 'travel', note: 'Taxi' }
      for (const bad of [{ category: 'unknown' }, { loan: '-1' }, { fiat: '1.001' }]) {
        expect((await call('submit', { ...filled, ...bad })).ok).toBe(false)
      }
      for (const stranger of cookies.slice(1)) {
        expect((await call('init', undefined, stranger)).data.record.id).not.toBe(draft.id)
        expect((await call('save_draft', filled, stranger)).ok).toBe(false)
        expect((await call('submit', { ...filled, version: 0 }, stranger)).error.code).toBe('BLOCK_UNIQUE_CONFLICT')
      }
      const updated = (await call('save_draft', { ...filled, settlement: '9999' })).data.record
      expect(updated.settlement).toBe('80.30')
      expect((await call('init')).data.record).toEqual(updated)
      expect((await call('save_draft', { ...filled, loan: '020.00' })).data.record).toEqual(updated)
      expect((await call('save_draft', { ...filled, note: 'taxi' })).error.code).toBe('BLOCK_UNIQUE_CONFLICT')
      const final = { ...updated, loan: '125', note: 'latest' }
      const [a, b] = await Promise.all([call('submit', final), call('submit', final)])
      expect(a.data.record).toMatchObject({ status: 'submitted', id: fresh.id, settlement: '-24.70', note: 'latest' })
      expect(b.data.record).toEqual(a.data.record)
      expect((await call('save_draft', final)).ok).toBe(false)
      expect((await call('init')).data.record.version).toBe(0)
    })
  })
}
