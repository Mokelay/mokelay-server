import { describe, expect, it } from 'vitest'
import { loginSchema, registerSchema } from '../../server/utils/validation'

describe('auth validation', () => {
  it('normalizes registration email', () => {
    const result = registerSchema.parse({
      name: 'Mokelay',
      email: 'HELLO@MOKELAY.COM ',
      password: 'mokelay123',
    })

    expect(result.email).toBe('hello@mokelay.com')
  })

  it('requires stronger registration passwords', () => {
    const result = registerSchema.safeParse({
      name: 'Mokelay',
      email: 'hello@mokelay.com',
      password: 'password',
    })

    expect(result.success).toBe(false)
  })

  it('accepts a minimal login payload', () => {
    const result = loginSchema.safeParse({
      email: 'hello@mokelay.com',
      password: 'anything',
    })

    expect(result.success).toBe(true)
  })
})
