import { expect } from 'vitest'

/** Assert translation completeness, then provide the Chinese view for page behavior assertions. */
export function localizedPageFixture<T>(asset: T): T {
  function visit(value: unknown, path: string): unknown {
    if (Array.isArray(value)) return value.map((item, index) => visit(item, `${path}[${index}]`))
    if (!value || typeof value !== 'object') return value

    const record = value as Record<string, unknown>
    if ('$i18n' in record) {
      const translations = record.$i18n as Record<string, unknown>
      for (const locale of ['zh-CN', 'en-US']) {
        expect(translations?.[locale], `${path} must have a nonempty ${locale} translation`).toEqual(expect.any(String))
        expect((translations[locale] as string).trim(), `${path} has an empty ${locale} translation`).not.toBe('')
      }
      return translations['zh-CN']
    }

    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, visit(item, `${path}.${key}`)]))
  }

  return visit(asset, '$') as T
}
