import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectServerControllerDocs,
  parseServerControllerDocComment,
} from '../../scripts/import-server-controller-docs.mjs'

let tempDir

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

async function writeFixture({ comment = validComment() } = {}) {
  tempDir = await mkdtemp(join(tmpdir(), 'server-controller-docs-'))
  await writeFile(join(tempDir, 'index.ts'), `
import { executeDemoController } from './demo.js'

export const controllerExecutors = {
  demo_controller: executeDemoController,
}
`)
  await writeFile(join(tempDir, 'demo.ts'), `
${comment}
export const executeDemoController = ({ controller }) => controller.nodes[0]
`)

  return {
    indexPath: join(tempDir, 'index.ts'),
    registryName: 'controllerExecutors',
    sourceKind: 'core',
    sourcePackage: 'test-package',
  }
}

function validComment(overrides = {}) {
  const doc = {
    version: 1,
    functionName: 'demo_controller',
    displayName: 'Demo Controller',
    category: 'test',
    description: 'Demo controller docs.',
    inputs: [{ key: 'value', type: 'boolean', required: true, description: 'Branch value.' }],
    nodes: [{ key: 'trueNode', type: 'ControllerNode', required: true, description: 'True branch.' }],
    errors: [],
    config: [],
    runtime: [{ key: 'requiresDatasource', type: 'boolean', value: false, description: 'No datasource.' }],
    examples: [{
      title: 'Demo',
      controller: {
        uuid: 'demo_controller',
        functionName: 'demo_controller',
        type: 'controller',
        inputs: { value: true },
        nodes: [{ uuid: 'true_node', value: true, nextBlock: null }],
      },
    }],
    ...overrides,
  }

  return `/**
 * @serverControllerDoc
 * ${JSON.stringify(doc, null, 2).split('\n').join('\n * ')}
 */`
}

describe('parseServerControllerDocComment', () => {
  it('parses a structured server controller doc JSON comment', () => {
    const doc = parseServerControllerDocComment(validComment())

    expect(doc.functionName).toBe('demo_controller')
    expect(doc.nodes).toEqual([{ key: 'trueNode', type: 'ControllerNode', required: true, description: 'True branch.' }])
  })

  it('throws for invalid JSON', () => {
    expect(() => parseServerControllerDocComment(`/**
 * @serverControllerDoc
 * { "functionName": }
 */`)).toThrow('Invalid @serverControllerDoc JSON')
  })
})

describe('collectServerControllerDocs', () => {
  it('collects all registered core controller docs from the repo', async () => {
    const docs = await collectServerControllerDocs()
    const functionNames = docs.map((doc) => doc.function_name)

    expect(docs).toHaveLength(2)
    expect(functionNames).toEqual(['if_controller', 'switch_controller'])
    expect(docs.find((doc) => doc.function_name === 'if_controller')).toMatchObject({
      source_kind: 'core',
      source_package: 'mokelay-server-core',
    })
  })

  it('normalizes a valid fixture doc', async () => {
    const registry = await writeFixture()
    const docs = await collectServerControllerDocs({ registries: [registry] })

    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      uuid: 'server-controller-demo_controller',
      function_name: 'demo_controller',
      source_package: 'test-package',
    })
    expect(docs[0].raw_meta.counts.nodes).toBe(1)
  })

  it('throws when a registered executor is missing a doc comment', async () => {
    const registry = await writeFixture({ comment: '' })

    await expect(collectServerControllerDocs({ registries: [registry] }))
      .rejects.toThrow('Missing @serverControllerDoc')
  })

  it('throws when a required doc field is missing', async () => {
    const comment = validComment({ examples: undefined }).replace(/,\n \*   "examples": undefined/, '')
    const registry = await writeFixture({ comment })

    await expect(collectServerControllerDocs({ registries: [registry] }))
      .rejects.toThrow('missing required field')
  })

  it('throws when documented functionName does not match the registry', async () => {
    const registry = await writeFixture({ comment: validComment({ functionName: 'other_controller' }) })

    await expect(collectServerControllerDocs({ registries: [registry] }))
      .rejects.toThrow('expected "demo_controller"')
  })

  it('throws when nodes do not describe controller node rules', async () => {
    const registry = await writeFixture({ comment: validComment({ nodes: [] }) })

    await expect(collectServerControllerDocs({ registries: [registry] }))
      .rejects.toThrow('must describe controller node rules')
  })

  it('throws when an example is missing controller type', async () => {
    const registry = await writeFixture({
      comment: validComment({
        examples: [{
          title: 'Demo',
          controller: {
            uuid: 'demo_controller',
            functionName: 'demo_controller',
            inputs: { value: true },
            nodes: [{ uuid: 'true_node', value: true, nextBlock: null }],
          },
        }],
      }),
    })

    await expect(collectServerControllerDocs({ registries: [registry] }))
      .rejects.toThrow('controller.type must be "controller"')
  })
})
