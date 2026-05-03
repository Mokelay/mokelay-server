import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../server/utils/password'

describe('password hashing', () => {
  it('creates scrypt hashes that can be verified', async () => {
    const hash = await hashPassword('mokelay123')

    expect(hash).toContain('scrypt')
    expect(await verifyPassword(hash, 'mokelay123')).toBe(true)
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false)
  })
})
