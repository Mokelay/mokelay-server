import { createError, deleteCookie, getCookie, setCookie, type H3Event } from 'h3'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PublicUser } from './user-store'

export const sessionCookieName = 'mokelay_session'

const sessionMaxAgeSeconds = 60 * 60 * 24 * 7

export type UserSession = {
  user: PublicUser | null
  loggedInAt?: string
}

type StoredSession = UserSession & {
  iat: number
  exp: number
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET

  if (secret) {
    return secret
  }

  if (process.env.NODE_ENV === 'production') {
    throw createError({
      statusCode: 500,
      message: 'SESSION_SECRET is not configured.',
    })
  }

  return 'mokelay-local-session-secret-at-least-32-characters'
}

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(value: string) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url')
}

function seal(payload: StoredSession) {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  return `${encodedPayload}.${sign(encodedPayload)}`
}

function unseal(value: string): StoredSession | null {
  const [encodedPayload, signature] = value.split('.')

  if (!encodedPayload || !signature) {
    return null
  }

  const expectedSignature = sign(encodedPayload)
  const signatureBuffer = Buffer.from(signature)
  const expectedSignatureBuffer = Buffer.from(expectedSignature)

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length
    || !timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return null
  }

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as StoredSession

    if (!payload.user || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

function cookieDomain() {
  return process.env.COOKIE_DOMAIN || undefined
}

function isProduction() {
  return process.env.NODE_ENV === 'production'
}

export function setUserSession(event: H3Event, session: UserSession) {
  const now = Math.floor(Date.now() / 1000)
  const payload: StoredSession = {
    ...session,
    iat: now,
    exp: now + sessionMaxAgeSeconds,
  }

  setCookie(event, sessionCookieName, seal(payload), {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: sessionMaxAgeSeconds,
    domain: cookieDomain(),
  })
}

export function getUserSession(event: H3Event): UserSession {
  const cookie = getCookie(event, sessionCookieName)
  const payload = cookie ? unseal(cookie) : null

  return {
    user: payload?.user || null,
    loggedInAt: payload?.loggedInAt,
  }
}

export function clearUserSession(event: H3Event) {
  deleteCookie(event, sessionCookieName, {
    path: '/',
    domain: cookieDomain(),
  })
}
