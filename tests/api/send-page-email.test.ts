import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMokelayOrchestrationHandler } from 'mokelay-server-core/utils/orchestration'
import { serverBlockDefinitions } from '../../server/utils/blocks'

const mailMocks = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: mailMocks.createTransport } }))

const smtpEnvNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE', 'SMTP_FROM'] as const
const originalEnv = Object.fromEntries(smtpEnvNames.map((name) => [name, process.env[name]]))
const originalDatabaseUrl = process.env.Mokelay_DATABASE_URL
const originalSessionSecret = process.env.SESSION_SECRET
const executeSql = vi.fn()
let server: Server
let baseUrl: string

beforeAll(async () => {
  process.env.SMTP_HOST = 'smtp.example.com'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_USER = 'sender@example.com'
  process.env.SMTP_PASS = 'test-password'
  process.env.SMTP_SECURE = 'false'
  process.env.Mokelay_DATABASE_URL = 'postgres://unit-test'
  process.env.SESSION_SECRET = 'send-page-email-test-secret-at-least-32-characters'
  mailMocks.createTransport.mockReturnValue({ sendMail: mailMocks.sendMail })
  mailMocks.sendMail.mockResolvedValue({
    messageId: '<page-email@example.com>',
    accepted: ['iamcarlchen@gmail.com'],
    rejected: [],
  })

  const rawApiJson = JSON.parse(await readFile(
    resolve(process.cwd(), 'server/assets/mokelay-apis/send_page_email.json'),
    'utf8',
  ))
  executeSql.mockResolvedValue({
    databaseType: 'postgres',
    rows: [{
      uuid: 'email-page',
      name: 'Email page',
      blocks: [{ id: 'copy', type: 'paragraph', data: { text: 'Hello by email' } }],
      locale_config: null,
      app_uuid: null,
      layout_uuid: null,
      sub_page: false,
      quotes: [],
      dependencies: [],
      created_at: '2026-07-21T00:00:00.000Z',
      updated_at: '2026-07-21T00:00:00.000Z',
    }],
  })
  const loginApiJson = {
    uuid: 'send_page_email_test_login',
    method: 'POST',
    blocks: [
      { uuid: 'starter', nextBlock: 'add_user_session' },
      {
        uuid: 'add_user_session',
        functionName: 'addSession',
        inputs: {
          key: 'user',
          value: { id: 'employee-1', enterprise_uuid: 'enterprise-1', email: 'user@example.com' },
        },
        outputs: [],
        nextBlock: null,
      },
    ],
    response: { success: true },
  }
  const handler = createMokelayOrchestrationHandler({
    loadApiJson: async (uuid) => uuid === 'send_page_email_test_login' ? loginApiJson : rawApiJson,
    executeSql,
    blockDefinitions: serverBlockDefinitions,
  })
  const app = createApp()
  const router = createRouter()
  router.use('/api/mokelay/:apiJsonUuid', handler)
  app.use(router)
  server = createServer(toNodeListener(app))
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  for (const name of smtpEnvNames) {
    const value = originalEnv[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  if (originalDatabaseUrl === undefined) delete process.env.Mokelay_DATABASE_URL
  else process.env.Mokelay_DATABASE_URL = originalDatabaseUrl
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET
  else process.env.SESSION_SECRET = originalSessionSecret
})

describe('GET /api/mokelay/send_page_email', () => {
  it('rejects requests without a logged-in user session', async () => {
    const response = await fetch(`${baseUrl}/api/mokelay/send_page_email?pageUUID=email-page`)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'BLOCK_SESSION_KEY_NOT_FOUND' },
    })
    expect(mailMocks.sendMail).not.toHaveBeenCalled()
  })

  it('loads Page DSL by UUID and sends the complete HTML to the fixed recipient', async () => {
    const loginResponse = await fetch(`${baseUrl}/api/mokelay/send_page_email_test_login`, { method: 'POST' })
    const cookie = loginResponse.headers.get('set-cookie')
    expect(cookie).toBeTruthy()
    const response = await fetch(`${baseUrl}/api/mokelay/send_page_email?pageUUID=EMAIL-PAGE`, {
      headers: { cookie: cookie! },
    })
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        messageId: '<page-email@example.com>',
        accepted: ['iamcarlchen@gmail.com'],
        rejected: [],
      },
    })
    expect(mailMocks.sendMail).toHaveBeenCalledOnce()
    expect(executeSql).toHaveBeenCalledOnce()
    expect(mailMocks.sendMail).toHaveBeenCalledWith({
      from: 'sender@example.com',
      to: 'iamcarlchen@gmail.com',
      subject: 'Email page',
      html: expect.stringMatching(/^<!doctype html>[\s\S]*Hello by email/),
    })
  })
})
