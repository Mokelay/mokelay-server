import { afterEach, describe, expect, it } from 'vitest'
import { allowedOrigins } from '../../server/utils/cors'

describe('CORS origins', () => {
  const originalCorsOrigins = process.env.CORS_ORIGINS

  afterEach(() => {
    process.env.CORS_ORIGINS = originalCorsOrigins
  })

  it('allows Mokelay production domains and local website origins by default', () => {
    const origins = allowedOrigins()

    expect(origins.has('https://www.mokelay.com')).toBe(true)
    expect(origins.has('https://mokelay.com')).toBe(true)
    expect(origins.has('http://localhost:3000')).toBe(true)
    expect(origins.has('http://127.0.0.1:3000')).toBe(true)
  })

  it('merges configured origins', () => {
    process.env.CORS_ORIGINS = 'https://preview.mokelay.com, http://localhost:4173 '

    const origins = allowedOrigins()

    expect(origins.has('https://preview.mokelay.com')).toBe(true)
    expect(origins.has('http://localhost:4173')).toBe(true)
  })
})
