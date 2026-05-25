import { afterEach, describe, expect, it } from 'vitest'
import { detectDatabaseType, mokelayDatabaseUrl } from '../../server/utils/db'

describe('database utilities', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('detects supported database types from database URL protocols', () => {
    expect(detectDatabaseType('postgres://user:pass@127.0.0.1:5432/app')).toBe('postgres')
    expect(detectDatabaseType('postgresql://user:pass@127.0.0.1:5432/app')).toBe('postgres')
    expect(detectDatabaseType('mysql://user:pass@127.0.0.1:3306/app')).toBe('mysql')
  })

  it('rejects unsupported database URL protocols', () => {
    expect(() => detectDatabaseType('sqlite://local.db')).toThrow('不支持的数据库类型：sqlite。')
    expect(() => detectDatabaseType('not-a-url')).toThrow('数据库连接 URL 不是合法 URL。')
  })

  it('reads the Mokelay database URL from Mokelay_DATABASE_URL', () => {
    process.env.Mokelay_DATABASE_URL = 'postgres://mokelay-unit-test'

    expect(mokelayDatabaseUrl()).toBe('postgres://mokelay-unit-test')
  })

  it('does not fall back to DATABASE_URL for the Mokelay database URL', () => {
    process.env.DATABASE_URL = 'postgres://legacy-should-not-be-used'
    delete process.env.Mokelay_DATABASE_URL

    expect(() => mokelayDatabaseUrl()).toThrow('Mokelay_DATABASE_URL is not configured.')
  })
})
