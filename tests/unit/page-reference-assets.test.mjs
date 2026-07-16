import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  analyzeSystemPageAssets,
  extractEmbeddedPageReferences,
  writeSystemPageRelations,
} from '../../scripts/page-reference-assets.mjs'
import {
  buildCanonicalPageGraph,
  extractPageReferences,
} from '../../server/utils/pageRelations'
import { runPageReferencesCli } from '../../scripts/page-references.mjs'

describe('system page reference assets', () => {
  it('matches the canonical static graph baseline', async () => {
    const analysis = await analyzeSystemPageAssets()

    expect(analysis.summary).toEqual({
      pageCount: 47,
      dependencyCount: 32,
      parentCount: 16,
      subPageCount: 32,
      mainPageCount: 15,
      multiQuotedPageCount: 0,
      changedFileCount: 0,
    })
    expect(analysis.relations.get('mokelay_api_create_page')).toEqual({
      subPage: true,
      quotes: ['mokelay_apis_user_page'],
      dependencies: [],
    })
    expect(analysis.relations.get('mokelay_apis_user_tabs_page')).toEqual({
      subPage: true,
      quotes: ['apis'],
      dependencies: ['mokelay_apis_user_fragment_page', 'mokelay_apis_user_page'],
    })
    expect(analysis.relations.get('mokelay_apis_system_tabs_page')).toEqual({
      subPage: true,
      quotes: ['setting'],
      dependencies: ['mokelay_apis_system_fragment_page', 'mokelay_apis_system_page'],
    })
  })

  it('exposes the asset check through the unified page-reference CLI', async () => {
    await expect(runPageReferencesCli('check')).resolves.toMatchObject({
      status: 'validated',
      pageCount: 47,
      dependencyCount: 32,
      changedFileCount: 0,
    })
  })

  it('extracts nested tabs and dialogs while ignoring navigation actions', () => {
    const references = extractEmbeddedPageReferences([
      {
        type: 'MLayoutGrid',
        data: {
          blocks: [{
            type: 'MTabs',
            data: {
              tabs: [{ pageUUID: 'tab_page', pageSource: 'system' }],
            },
          }],
        },
        events: [{
          event: 'click',
          actions: [
            { action: 'open_dialog', inputs: { pageUuid: 'dialog_page', pageSource: 'system' } },
            { action: 'jump_url', inputs: { pageUUID: 'navigation_page', pageSource: 'system' } },
          ],
        }],
      },
    ])

    expect(references.map(({ uuid, pageSource }) => ({ uuid, pageSource }))).toEqual([
      { uuid: 'tab_page', pageSource: 'system' },
      { uuid: 'dialog_page', pageSource: 'system' },
    ])
  })

  it('writes relation fields once and is idempotent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mokelay-page-assets-'))
    try {
      const parent = {
        uuid: 'parent_page',
        name: 'Parent',
        blocks: [{
          type: 'MTabs',
          data: { tabs: [{ pageUUID: 'child_page', pageSource: 'system' }] },
        }],
      }
      const child = { uuid: 'child_page', name: 'Child', blocks: [] }
      await Promise.all([
        writeFile(path.join(directory, 'parent_page.json'), `${JSON.stringify(parent, null, 2)}\n`),
        writeFile(path.join(directory, 'child_page.json'), `${JSON.stringify(child, null, 2)}\n`),
      ])

      expect((await writeSystemPageRelations(directory)).changedFileCount).toBe(2)
      expect((await writeSystemPageRelations(directory)).changedFileCount).toBe(0)
      expect((await readdir(directory)).sort()).toEqual(['child_page.json', 'parent_page.json'])

      const childSource = await readFile(path.join(directory, 'child_page.json'), 'utf8')
      expect(childSource).toContain([
        '  "uuid": "child_page",',
        '  "subPage": true,',
        '  "quotes": ["parent_page"],',
        '  "dependencies": [],',
      ].join('\n'))
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects dynamic and ambiguous embedded page targets', () => {
    expect(() => extractEmbeddedPageReferences({
      action: 'open_dialog',
      inputs: { pageUUID: { template: '{{pageUuid}}' } },
    })).toThrow(/PAGE_REFERENCE_DYNAMIC/)

    expect(() => extractEmbeddedPageReferences({
      action: 'open_dialog',
      inputs: { pageUUID: '{{request.pageUuid}}' },
    })).toThrow(/PAGE_REFERENCE_DYNAMIC/)

    expect(() => extractEmbeddedPageReferences({
      action: 'open_dialog',
      inputs: { pageUUID: 'request.pageUuid}}' },
    })).toThrow(/PAGE_REFERENCE_DYNAMIC/)

    expect(() => extractEmbeddedPageReferences({
      action: 'open_dialog',
      inputs: { pageUUID: 'literal_page', pageSource: '{{request.pageSource}}' },
    })).toThrow(/PAGE_REFERENCE_DYNAMIC/)

    expect(() => extractEmbeddedPageReferences({
      action: 'open_dialog',
      inputs: { pageUUID: 'canonical', pageUuid: 'legacy' },
    })).toThrow(/PAGE_REFERENCE_AMBIGUOUS/)

    expect(() => extractEmbeddedPageReferences({
      type: 'MTabs',
      data: { tabs: 'dynamic' },
    })).toThrow(/PAGE_REFERENCE_INVALID/)

    expect(() => extractEmbeddedPageReferences({
      type: 'MTabs',
      data: { tabs: [{}] },
    })).toThrow(/PAGE_REFERENCE_DYNAMIC/)
  })

  it('trims literal targets before graph validation', () => {
    expect(extractEmbeddedPageReferences([{
      action: 'open_dialog',
      inputs: { pageUUID: '  child_page  ', pageSource: 'system' },
    }, {
      type: 'MTabs',
      data: { tabs: [{ pageUuid: ' legacy_child ', pageSource: 'system' }] },
    }]).map(reference => reference.uuid)).toEqual(['child_page', 'legacy_child'])
  })

  it('keeps runtime and asset extraction/graph entry points conformant', async () => {
    const blocks = [{
      type: 'MTabs',
      data: { tabs: [{ pageUuid: ' child_page ', pageSource: 'system' }] },
      events: [{
        action: 'open_dialog',
        inputs: { pageUUID: 'dialog_page', pageSource: 'system' },
        nextAction: { action: 'jump_url', inputs: { pageUUID: 'ignored_page' } },
      }],
    }]
    const fromAssets = extractEmbeddedPageReferences(blocks)
      .map(reference => ({ uuid: reference.uuid, source: reference.pageSource }))
      .sort((left, right) => left.uuid.localeCompare(right.uuid))
    const fromRuntime = extractPageReferences(blocks)
      .map(reference => ({ uuid: reference.uuid, source: reference.source }))
    expect(fromAssets).toEqual(fromRuntime)

    const invalidFixtures = [
      [{ type: 'MTabs', data: { tabs: 'dynamic' } }],
      [{ action: 'open_dialog', inputs: { pageUUID: '{{uuid}}' } }],
      [{ action: 'open_dialog', inputs: { pageUUID: 'a', pageUuid: 'b' } }],
      [{ action: 'open_dialog', inputs: { pageUUID: 'child_page', pageSource: 'remote' } }],
    ]
    for (const fixture of invalidFixtures) {
      expect(() => extractEmbeddedPageReferences(fixture)).toThrow()
      expect(() => extractPageReferences(fixture)).toThrow()
    }

    const directory = await mkdtemp(path.join(tmpdir(), 'mokelay-page-conformance-'))
    try {
      const pages = [
        {
          uuid: 'parent_page',
          name: 'Parent',
          blocks: [{ type: 'MTabs', data: { tabs: [{ pageUUID: 'child_page', pageSource: 'system' }] } }],
        },
        { uuid: 'child_page', name: 'Child', blocks: [] },
      ]
      await Promise.all(pages.map(page => writeFile(
        path.join(directory, `${page.uuid}.json`),
        `${JSON.stringify(page, null, 2)}\n`,
      )))
      const analysis = await analyzeSystemPageAssets(directory)
      const runtimeGraph = buildCanonicalPageGraph(pages.map(page => ({ ...page, source: 'system' })))
      expect(analysis.relations.get('parent_page')).toEqual(runtimeGraph.get('system:parent_page'))
      expect(analysis.relations.get('child_page')).toEqual(runtimeGraph.get('system:child_page'))
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects missing or non-array asset blocks instead of treating them as empty', async () => {
    for (const blocks of [undefined, {}]) {
      const directory = await mkdtemp(path.join(tmpdir(), 'mokelay-page-invalid-blocks-'))
      try {
        const page = { uuid: 'invalid_blocks_page', name: 'Invalid Blocks', ...(blocks === undefined ? {} : { blocks }) }
        await writeFile(
          path.join(directory, 'invalid_blocks_page.json'),
          `${JSON.stringify(page, null, 2)}\n`,
        )
        await expect(analyzeSystemPageAssets(directory)).rejects.toThrow(/PAGE_REFERENCE_INVALID/)
      }
      finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  })

  it.each([undefined, '', '   ', 'x'.repeat(121)])('rejects invalid asset name %j', async (name) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mokelay-page-invalid-name-'))
    try {
      const page = { uuid: 'invalid_name_page', ...(name === undefined ? {} : { name }), blocks: [] }
      await writeFile(
        path.join(directory, 'invalid_name_page.json'),
        `${JSON.stringify(page, null, 2)}\n`,
      )
      await expect(analyzeSystemPageAssets(directory)).rejects.toThrow(/PAGE_ASSET_NAME_INVALID/)
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
