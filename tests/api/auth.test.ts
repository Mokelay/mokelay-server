import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import corsMiddleware from '../../server/middleware/cors'
import registerHandler from '../../server/routes/api/auth/register.post'
import loginHandler from '../../server/routes/api/auth/login.post'
import logoutHandler from '../../server/routes/api/auth/logout.post'
import meHandler from '../../server/routes/api/me.get'
import billingWebhookHandler from '../../server/routes/api/billing/webhook.post'
import { clearMemoryUsers } from '../../server/utils/user-store'
import { sessionCookieName } from '../../server/utils/session'

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
}

async function startServer(): Promise<TestServer> {
  const app = createApp()

  app.use(corsMiddleware)
  app.use('/api/auth/register', registerHandler)
  app.use('/api/auth/login', loginHandler)
  app.use('/api/auth/logout', logoutHandler)
  app.use('/api/me', meHandler)
  app.use('/api/billing/webhook', billingWebhookHandler)

  const server = createServer(toNodeListener(app))

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
  }
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function readJson(response: Response) {
  return await response.json() as Record<string, unknown>
}

describe('auth API', () => {
  let testServer: TestServer
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: '',
      SESSION_SECRET: 'test-session-secret-at-least-32-characters',
      COOKIE_DOMAIN: '',
      NODE_ENV: 'test',
    }
    clearMemoryUsers()
    testServer = await startServer()
  })

  afterEach(async () => {
    await testServer.close()
    clearMemoryUsers()
    process.env = { ...originalEnv }
  })

  it('registers, reads the session, and logs out with an HTTP-only cookie', async () => {
    const registerResponse = await fetch(`${testServer.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        name: 'E2E Builder',
        email: 'builder@mokelay.test',
        password: 'mokelay123',
      }),
    })

    expect(registerResponse.status).toBe(200)
    expect(registerResponse.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    expect(registerResponse.headers.get('access-control-allow-credentials')).toBe('true')

    const cookie = registerResponse.headers.get('set-cookie')

    expect(cookie).toContain(`${sessionCookieName}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')

    const meResponse = await fetch(`${testServer.baseUrl}/api/me`, {
      headers: {
        cookie: cookie || '',
      },
    })
    const meBody = await readJson(meResponse)

    expect(meBody.loggedIn).toBe(true)
    expect(meBody.user).toMatchObject({
      name: 'E2E Builder',
      email: 'builder@mokelay.test',
      plan: 'free',
    })

    const logoutResponse = await fetch(`${testServer.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: cookie || '',
      },
    })

    expect(logoutResponse.status).toBe(200)
    expect(logoutResponse.headers.get('set-cookie')).toContain(`${sessionCookieName}=`)
    expect(logoutResponse.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('rejects duplicate registrations and bad credentials', async () => {
    const payload = {
      name: 'Mokelay',
      email: 'duplicate@mokelay.test',
      password: 'mokelay123',
    }

    expect((await fetch(`${testServer.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })).status).toBe(200)

    expect((await fetch(`${testServer.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })).status).toBe(409)

    expect((await fetch(`${testServer.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: payload.email,
        password: 'wrong-password',
      }),
    })).status).toBe(401)
  })

  it('logs in an existing user and handles unauthenticated /api/me', async () => {
    await fetch(`${testServer.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Login User',
        email: 'login@mokelay.test',
        password: 'mokelay123',
      }),
    })

    const loginResponse = await fetch(`${testServer.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'LOGIN@MOKELAY.TEST ',
        password: 'mokelay123',
      }),
    })

    expect(loginResponse.status).toBe(200)
    expect(loginResponse.headers.get('set-cookie')).toContain(`${sessionCookieName}=`)

    const anonymousMeResponse = await fetch(`${testServer.baseUrl}/api/me`)
    const anonymousMe = await readJson(anonymousMeResponse)

    expect(anonymousMe).toEqual({
      loggedIn: false,
      user: null,
    })
  })

  it('handles billing webhook placeholder responses', async () => {
    const response = await fetch(`${testServer.baseUrl}/api/billing/webhook`, {
      method: 'POST',
      body: '{}',
    })
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      received: true,
      mode: 'placeholder',
    })
  })
})
