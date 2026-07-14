import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function text(fileName) {
  return await readFile(new URL(`../../${fileName}`, import.meta.url), 'utf8')
}

describe('page reference migrations', () => {
  it('adds equivalent relation storage and a version-zero graph lock in both dialects', async () => {
    const [postgres, mysql] = await Promise.all([
      text('server/database/migrations/0026_page_references.sql'),
      text('data/mysql_migrations/0026_page_references.sql'),
    ])

    for (const migration of [postgres, mysql]) {
      expect(migration).toContain('sub_page')
      expect(migration).toContain('quotes')
      expect(migration).toContain('dependencies')
      expect(migration).toContain('idx_pages_sub_page')
      expect(migration).toContain('page_reference_graph_state')
      expect(migration).toMatch(/(?:VALUES \(1, 0, 0\)|VALUES \(1,0,0\))/)
    }
    expect(postgres).toContain("DEFAULT '[]'::jsonb NOT NULL")
    expect(mysql).toContain('DEFAULT (JSON_ARRAY())')
  })

  it('marks canonical fresh-import data dumps as graph version one', async () => {
    const [postgres, mysql] = await Promise.all([
      text('data/postgres_data.sql'),
      text('data/mysql_data.sql'),
    ])

    expect(postgres).toContain('(1, 0, 1);')
    expect(mysql).toContain('VALUES (1,0,1);')
    for (const dump of [postgres, mysql]) {
      expect(dump).not.toMatch(/open_dialog|"MTabs"|pageUUID|pageUuid/)
    }
  })

  it('stores page identifiers as lowercase slugs while retaining UUID defaults', async () => {
    const [postgres, mysql] = await Promise.all([
      text('server/database/migrations/0027_page_slug_identifiers.sql'),
      text('data/mysql_migrations/0027_page_slug_identifiers.sql'),
    ])

    for (const migration of [postgres, mysql]) {
      expect(migration).toMatch(/varchar\(128\)/i)
      expect(migration).toMatch(/char_length/i)
      expect(migration).toMatch(/\[\^?a-z0-9_-\]/)
    }
    expect(postgres).toContain('gen_random_uuid()::text')
    expect(postgres).toContain('pages_uuid_slug_check')
    expect(mysql).toMatch(/DEFAULT \(UUID\(\)\)/i)
    expect(mysql).toContain('ascii_bin')
    expect(mysql).toContain('chk_pages_uuid_slug')
    expect(mysql).toContain('ADD UNIQUE KEY `uk_pages_uuid` (`uuid`)')
  })
})
