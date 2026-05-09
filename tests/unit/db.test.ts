import { describe, expect, it } from 'vitest'
import { detectDatabaseType } from '../../server/utils/db'

describe('database utilities', () => {
  it('detects supported database types from DATABASE_URL protocols', () => {
    expect(detectDatabaseType('postgres://user:pass@127.0.0.1:5432/app')).toBe('postgres')
    expect(detectDatabaseType('postgresql://user:pass@127.0.0.1:5432/app')).toBe('postgres')
    expect(detectDatabaseType('mysql://user:pass@127.0.0.1:3306/app')).toBe('mysql')
  })

  it('rejects unsupported database URL protocols', () => {
    expect(() => detectDatabaseType('sqlite://local.db')).toThrow('不支持的数据库类型：sqlite。')
    expect(() => detectDatabaseType('not-a-url')).toThrow('DATABASE_URL 不是合法 URL。')
  })
})
