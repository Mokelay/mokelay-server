import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectServerBlockDocs,
  parseServerBlockDocComment,
} from '../../scripts/import-server-block-docs.mjs'

let tempDir

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

async function writeFixture({ allowedOutputs = ['ok'], requiresDatasource = true, comment = validComment() } = {}) {
  tempDir = await mkdtemp(join(tmpdir(), 'server-block-docs-'))
  await writeFile(join(tempDir, 'index.ts'), `
import { executeDemoBlock } from './demo.js'

export const blockDefinitions = {
  demo: { executor: executeDemoBlock, allowedOutputs: ${JSON.stringify(allowedOutputs)}, requiresDatasource: ${requiresDatasource} },
}
`)
  await writeFile(join(tempDir, 'demo.ts'), `
${comment}
export const executeDemoBlock = async () => ({ ok: true })
`)

  return {
    indexPath: join(tempDir, 'index.ts'),
    registryName: 'blockDefinitions',
    sourceKind: 'core',
    sourcePackage: 'test-package',
  }
}

function validComment(overrides = {}) {
  const doc = {
    version: 1,
    functionName: 'demo',
    displayName: 'Demo Block',
    category: 'test',
    description: 'Demo block docs.',
    inputs: [{ key: 'datasource', type: 'string', required: true, description: 'Datasource.' }],
    outputs: [{ key: 'ok', type: 'boolean', description: 'Success flag.' }],
    errors: [],
    config: [],
    runtime: [{ key: 'requiresDatasource', type: 'boolean', value: true, description: 'Needs datasource.' }],
    examples: [{ title: 'Demo', block: { uuid: 'demo', functionName: 'demo', inputs: {}, outputs: ['ok'], nextBlock: null } }],
    ...overrides,
  }

  return `/**
 * @serverBlockDoc
 * ${JSON.stringify(doc, null, 2).split('\n').join('\n * ')}
 */`
}

describe('parseServerBlockDocComment', () => {
  it('parses a structured server block doc JSON comment', () => {
    const doc = parseServerBlockDocComment(validComment())

    expect(doc.functionName).toBe('demo')
    expect(doc.outputs).toEqual([{ key: 'ok', type: 'boolean', description: 'Success flag.' }])
  })

  it('throws for invalid JSON', () => {
    expect(() => parseServerBlockDocComment(`/**
 * @serverBlockDoc
 * { "functionName": }
 */`)).toThrow('Invalid @serverBlockDoc JSON')
  })
})

describe('collectServerBlockDocs', () => {
  it('collects all registered core and server block docs from the repo', async () => {
    const docs = await collectServerBlockDocs()
    const functionNames = docs.map((doc) => doc.function_name)

    expect(docs).toHaveLength(45)
    expect(functionNames).toContain('requireTenantContext')
    expect(functionNames).toContain('readAiDslPromptAsset')
    expect(functionNames).toContain('saveAiDslAssets')
    expect(functionNames).toContain('normalizePageUuid')
    expect(functionNames).toContain('savePageRelations')
    expect(functionNames).toContain('deletePageRelations')
    expect(functionNames).toContain('normalizePageRows')
    expect(functionNames).toContain('list')
    expect(functionNames).toContain('page')
    expect(functionNames).toContain('read')
    expect(functionNames).toContain('createSchema')
    expect(functionNames).toContain('randomId')
    expect(functionNames).toContain('resolveLayoutBundle')
    expect(functionNames).toContain('executeFragment')
    expect(functionNames).toContain('linkOAuthIdentity')
    expect(functionNames).toContain('validateApiDefinition')
    expect(functionNames).toContain('assertApiDefinitionsDeletable')
    expect(functionNames).toContain('cascadeDelete')
    expect(functionNames).toContain('dropSchemas')
    expect(docs.find((doc) => doc.function_name === 'list')).toMatchObject({
      requires_datasource: true,
      source_kind: 'core',
    })
  })

  it('normalizes a valid fixture doc', async () => {
    const registry = await writeFixture()
    const docs = await collectServerBlockDocs({ registries: [registry] })

    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      uuid: 'server-block-demo',
      function_name: 'demo',
      source_package: 'test-package',
      requires_datasource: true,
    })
    expect(docs[0].raw_meta.counts.outputs).toBe(1)
  })

  it('throws when a registered executor is missing a doc comment', async () => {
    const registry = await writeFixture({ comment: '' })

    await expect(collectServerBlockDocs({ registries: [registry] }))
      .rejects.toThrow('Missing @serverBlockDoc')
  })

  it('throws when a required doc field is missing', async () => {
    const comment = validComment({ examples: undefined }).replace(/,\n \*   "examples": undefined/, '')
    const registry = await writeFixture({ comment })

    await expect(collectServerBlockDocs({ registries: [registry] }))
      .rejects.toThrow('missing required field')
  })

  it('throws when documented outputs do not match registry outputs', async () => {
    const registry = await writeFixture({ allowedOutputs: ['ok', 'extra'] })

    await expect(collectServerBlockDocs({ registries: [registry] }))
      .rejects.toThrow('documented outputs must match registry allowedOutputs')
  })

  it('throws when documented requiresDatasource does not match registry metadata', async () => {
    const registry = await writeFixture({ requiresDatasource: false })

    await expect(collectServerBlockDocs({ registries: [registry] }))
      .rejects.toThrow('documented requiresDatasource=true, expected false')
  })
})
