import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const layoutDir = resolve(process.cwd(), 'server/assets/mokelay-layouts')
const layoutFiles = ['mokelay_layout.json', 'web_layout.json', 'internal_admin_layout.json']

describe('localized system layout assets', () => {
  it.each(layoutFiles)('%s declares complete Chinese and English translations', async (fileName) => {
    const layout = JSON.parse(await readFile(resolve(layoutDir, fileName), 'utf8')) as Record<string, unknown>
    expect(layout.localeConfig).toEqual({
      defaultLocale: 'zh-CN',
      supportedLocales: ['zh-CN', 'en-US'],
    })

    const localizedValues = collectLocalizedValues(layout)
    expect(localizedValues.length).toBeGreaterThan(0)
    for (const value of localizedValues) {
      expect(value.$i18n['zh-CN']?.trim()).toBeTruthy()
      expect(value.$i18n['en-US']?.trim()).toBeTruthy()
    }
  })
})

function collectLocalizedValues(value: unknown): Array<{ $i18n: Record<string, string> }> {
  if (isRecord(value) && isRecord(value.$i18n)) {
    return [{ $i18n: value.$i18n as Record<string, string> }]
  }
  if (Array.isArray(value)) return value.flatMap(collectLocalizedValues)
  if (!isRecord(value)) return []
  return Object.values(value).flatMap(collectLocalizedValues)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
