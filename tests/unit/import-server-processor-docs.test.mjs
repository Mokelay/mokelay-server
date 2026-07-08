import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectServerProcessorDocs,
  parseServerProcessorDocComment,
} from '../../scripts/import-server-processor-docs.mjs'

let tempDir

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

async function writeFixture({ comment = validComment() } = {}) {
  tempDir = await mkdtemp(join(tmpdir(), 'server-processor-docs-'))
  await writeFile(join(tempDir, 'index.ts'), `
import { demoProcessor } from './demo.js'

export const processorExecutors = {
  demo_processor: demoProcessor,
}
`)
  await writeFile(join(tempDir, 'demo.ts'), `
${comment}
export const demoProcessor = ({ value }) => value
`)

  return {
    indexPath: join(tempDir, 'index.ts'),
    registryName: 'processorExecutors',
    sourceKind: 'core',
    sourcePackage: 'test-package',
  }
}

function validComment(overrides = {}) {
  const doc = {
    version: 1,
    functionName: 'demo_processor',
    displayName: 'Demo Processor',
    category: 'test',
    description: 'Demo processor docs.',
    inputs: [{ key: 'value', type: 'unknown', required: true, description: 'Input value.' }],
    params: [{ key: 'param', type: 'never', required: false, description: 'No params.' }],
    outputs: [{ key: 'value', type: 'unknown', description: 'Output value.' }],
    errors: [],
    config: [{ key: 'processor', type: 'string', required: true, value: 'demo_processor', description: 'Processor name.' }],
    runtime: [{ key: 'async', type: 'boolean', value: false, description: 'Sync.' }],
    examples: [{
      title: 'Demo',
      input: 'hello',
      processor: { processor: 'demo_processor' },
      output: 'hello',
    }],
    ...overrides,
  }

  return `/**
 * @serverProcessorDoc
 * ${JSON.stringify(doc, null, 2).split('\n').join('\n * ')}
 */`
}

describe('parseServerProcessorDocComment', () => {
  it('parses a structured server processor doc JSON comment', () => {
    const doc = parseServerProcessorDocComment(validComment())

    expect(doc.functionName).toBe('demo_processor')
    expect(doc.params).toEqual([{ key: 'param', type: 'never', required: false, description: 'No params.' }])
  })

  it('throws for invalid JSON', () => {
    expect(() => parseServerProcessorDocComment(`/**
 * @serverProcessorDoc
 * { "functionName": }
 */`)).toThrow('Invalid @serverProcessorDoc JSON')
  })
})

describe('collectServerProcessorDocs', () => {
  it('collects all registered core processor docs from the repo', async () => {
    const docs = await collectServerProcessorDocs()
    const functionNames = docs.map((doc) => doc.function_name)

    expect(docs).toHaveLength(17)
    expect(functionNames).toContain('trim')
    expect(functionNames).toContain('env_value')
    expect(functionNames).toContain('api_json_when_published')
    expect(functionNames).toContain('hash_make')
    expect(functionNames).toContain('hash_check')
    expect(docs.find((doc) => doc.function_name === 'trim')).toMatchObject({
      source_kind: 'core',
      source_package: 'mokelay-server-core',
      output_schema: expect.any(Array),
    })
  })

  it('normalizes a valid fixture doc', async () => {
    const registry = await writeFixture()
    const docs = await collectServerProcessorDocs({ registries: [registry] })

    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      uuid: 'server-processor-demo_processor',
      function_name: 'demo_processor',
      source_package: 'test-package',
    })
    expect(docs[0].raw_meta.counts.params).toBe(1)
    expect(docs[0].raw_meta.counts.outputs).toBe(1)
  })

  it('throws when a registered executor is missing a doc comment', async () => {
    const registry = await writeFixture({ comment: '' })

    await expect(collectServerProcessorDocs({ registries: [registry] }))
      .rejects.toThrow('Missing @serverProcessorDoc')
  })

  it('throws when a required doc field is missing', async () => {
    const comment = validComment({ outputs: undefined }).replace(/,\n \*   "outputs": undefined/, '')
    const registry = await writeFixture({ comment })

    await expect(collectServerProcessorDocs({ registries: [registry] }))
      .rejects.toThrow('missing required field')
  })

  it('throws when documented functionName does not match the registry', async () => {
    const registry = await writeFixture({ comment: validComment({ functionName: 'other_processor' }) })

    await expect(collectServerProcessorDocs({ registries: [registry] }))
      .rejects.toThrow('expected "demo_processor"')
  })

  it('throws when params do not describe processor parameter rules', async () => {
    const registry = await writeFixture({ comment: validComment({ params: [] }) })

    await expect(collectServerProcessorDocs({ registries: [registry] }))
      .rejects.toThrow('must describe processor parameter rules')
  })

  it('throws when an example processor does not match the registry', async () => {
    const registry = await writeFixture({
      comment: validComment({
        examples: [{
          title: 'Demo',
          input: 'hello',
          processor: { processor: 'other_processor' },
          output: 'hello',
        }],
      }),
    })

    await expect(collectServerProcessorDocs({ registries: [registry] }))
      .rejects.toThrow('processor must match the registered functionName')
  })
})
