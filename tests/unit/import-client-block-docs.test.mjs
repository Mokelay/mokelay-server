import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectClientBlockDocs,
  parseClientBlockDocComment,
} from '../../scripts/import-block-component-docs.mjs'

let tempDir

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

function validDoc(overrides = {}) {
  return {
    version: 1,
    blockType: 'MDemo',
    displayName: 'Demo Block',
    category: 'test',
    description: 'Demo client block docs.',
    registration: {
      sourceKind: 'mokelay-editor',
      sourcePackage: 'mokelay-editor',
      componentName: 'MDemo',
      toolSymbol: 'mDemoEditorTool',
      editorEnabled: true,
      toolboxVisible: true,
      sortOrder: 10,
    },
    toolbox: { title: 'Demo', icon: '<svg />' },
    defaultData: { label: 'Demo' },
    properties: [{ key: 'label', label: 'Label', type: 'text' }],
    events: [{ event: 'click', payload: 'MouseEvent' }],
    methods: [],
    dataFields: [],
    saveRules: [{ key: 'serialize', description: 'Save data.' }],
    examples: [{ id: 'demo-example', type: 'MDemo', data: { label: 'Demo' } }],
    ...overrides,
  }
}

function commentFor(doc = validDoc()) {
  return `/**
 * @clientBlockDoc
 * ${JSON.stringify(doc, null, 2).split('\n').join('\n * ')}
 */`
}

async function writeFixture({ comment = commentFor(), secondComment, secondToolSymbol = 'mSecondEditorTool', legacyMetadata = false, layoutEntry = false } = {}) {
  tempDir = await mkdtemp(join(tmpdir(), 'client-block-docs-'))
  await mkdir(join(tempDir, 'src/blocks'), { recursive: true })
  await mkdir(join(tempDir, 'src/editors'), { recursive: true })
  if (layoutEntry) await mkdir(join(tempDir, 'src/layouts'), { recursive: true })
  await writeFile(join(tempDir, 'src/editors/editorComponentRegistry.ts'), `
import MDemo, { mDemoEditorTool } from '@/blocks/MDemo.vue'
${secondComment ? `import MSecond, { ${secondToolSymbol} } from '@/blocks/MSecond.vue'` : ''}
${layoutEntry ? "import MLayoutOnly, { mLayoutOnlyEditorTool } from '@/layouts/MLayoutOnly.vue'" : ''}

function getEditorComponentName(component: { name?: string }) {
  return component.name || 'MDemo'
}

export const editorComponentRegistry = {
  [getEditorComponentName(MDemo)]: {
    component: MDemo,
    ...mDemoEditorTool
  },
  ${secondComment ? `[getEditorComponentName(MSecond)]: { component: MSecond, ...${secondToolSymbol} },` : ''}
  ${layoutEntry ? '[getEditorComponentName(MLayoutOnly)]: { component: MLayoutOnly, ...mLayoutOnlyEditorTool },' : ''}
}
`)
  await writeFile(join(tempDir, 'src/blocks/MDemo.vue'), `
<script lang="ts">
import { defineEditorTool } from '@/editors/editorToolDefinition'
${comment}
export const mDemoEditorTool = defineEditorTool({
  ${legacyMetadata ? "toolbox: { title: 'Demo', icon: '<svg />' }," : ''}
  normalizeProps: (props) => ({ edit: false, ...props }),
  serialize: (props) => ({ label: props.label })
})
</script>
`)
  if (secondComment) {
    await writeFile(join(tempDir, 'src/blocks/MSecond.vue'), `
<script lang="ts">
import { defineEditorTool } from '@/editors/editorToolDefinition'
${secondComment}
export const ${secondToolSymbol} = defineEditorTool({
  normalizeProps: (props) => ({ edit: false, ...props }),
  serialize: (props) => props
})
</script>
`)
  }
  if (layoutEntry) {
    await writeFile(join(tempDir, 'src/layouts/MLayoutOnly.vue'), `
<script lang="ts">
import { defineEditorTool } from '@/editors/editorToolDefinition'
export const mLayoutOnlyEditorTool = defineEditorTool({
  normalizeProps: (props) => props,
  serialize: (props) => props
})
</script>
`)
  }

  return {
    editorRoot: tempDir,
    registryFile: join(tempDir, 'src/editors/editorComponentRegistry.ts'),
    includeManual: false,
  }
}

describe('parseClientBlockDocComment', () => {
  it('parses a structured client block doc JSON comment', () => {
    const doc = parseClientBlockDocComment(commentFor())

    expect(doc.blockType).toBe('MDemo')
    expect(doc.registration.toolSymbol).toBe('mDemoEditorTool')
    expect(doc.properties).toEqual([{ key: 'label', label: 'Label', type: 'text' }])
  })

  it('throws for invalid JSON', () => {
    expect(() => parseClientBlockDocComment(`/**
 * @clientBlockDoc
 * { "blockType": }
 */`)).toThrow('Invalid @clientBlockDoc JSON')
  })
})

describe('collectClientBlockDocs', () => {
  it('collects all registered client block docs from the repo', async () => {
    const docs = await collectClientBlockDocs()
    const blockTypes = docs.map((doc) => doc.block_type)

    expect(docs).toHaveLength(47)
    expect(blockTypes).toContain('MButton')
    expect(blockTypes).toContain('MForm')
    expect(blockTypes).toContain('MJson')
    expect(blockTypes).toContain('MLayoutPreview')
    expect(docs.find((doc) => doc.block_type === 'MButton')).toMatchObject({
      source_kind: 'mokelay-editor',
      component_name: 'MButton',
      tool_symbol: 'mButtonEditorTool',
      editor_enabled: true,
    })
    expect(docs.find((doc) => doc.block_type === 'MJson')).toMatchObject({
      uuid: 'mokelay-editor-MJson',
      source_kind: 'mokelay-editor',
      component_name: 'MJson',
      tool_symbol: 'mJsonTool',
      editor_enabled: true,
      toolbox_visible: false,
      sort_order: 81,
      default_data: {
        height: 360,
        expandDepth: 1,
      },
    })
    expect(docs).not.toContainEqual(expect.objectContaining({ source_kind: 'layout' }))
    expect(docs.some((doc) => doc.source_file.includes('/src/layouts/'))).toBe(false)
  })

  it('normalizes a valid fixture doc', async () => {
    const options = await writeFixture()
    const docs = await collectClientBlockDocs(options)

    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      uuid: 'mokelay-editor-MDemo',
      block_type: 'MDemo',
      component_name: 'MDemo',
      tool_symbol: 'mDemoEditorTool',
      default_data: { label: 'Demo' },
    })
    expect(docs[0].raw_meta.counts.properties).toBe(1)
  })

  it('ignores layout modules even when they appear in the editor component registry', async () => {
    const options = await writeFixture({ layoutEntry: true })

    await expect(collectClientBlockDocs(options)).resolves.toMatchObject([
      { block_type: 'MDemo' },
    ])
  })

  it('throws when a registered editor tool is missing a doc comment', async () => {
    const options = await writeFixture({ comment: '' })

    await expect(collectClientBlockDocs(options))
      .rejects.toThrow('Missing @clientBlockDoc')
  })

  it('throws when a required doc field is missing', async () => {
    const doc = validDoc()
    delete doc.examples
    const options = await writeFixture({ comment: commentFor(doc) })

    await expect(collectClientBlockDocs(options))
      .rejects.toThrow('missing required field')
  })

  it('throws when documented metadata does not match the registry', async () => {
    const options = await writeFixture({
      comment: commentFor(validDoc({ registration: { ...validDoc().registration, toolSymbol: 'wrongTool' } })),
    })

    await expect(collectClientBlockDocs(options))
      .rejects.toThrow('documents toolSymbol')
  })

  it('discovers a registered tool whose symbol does not end with EditorTool', async () => {
    const secondDoc = validDoc({
      blockType: 'MSecond',
      registration: {
        ...validDoc().registration,
        componentName: 'MSecond',
        toolSymbol: 'mSecondTool',
      },
    })
    const options = await writeFixture({
      secondComment: commentFor(secondDoc),
      secondToolSymbol: 'mSecondTool',
    })

    await expect(collectClientBlockDocs(options)).resolves.toHaveLength(2)
  })

  it('rejects legacy runtime metadata that duplicates @clientBlockDoc', async () => {
    const options = await writeFixture({ legacyMetadata: true })

    await expect(collectClientBlockDocs(options))
      .rejects.toThrow('must declare toolbox only in its @clientBlockDoc comment')
  })

  it('throws when doc uuids are duplicated', async () => {
    const secondDoc = validDoc({
      uuid: 'mokelay-editor-MDemo',
      blockType: 'MSecond',
      registration: {
        ...validDoc().registration,
        componentName: 'MSecond',
        toolSymbol: 'mSecondEditorTool',
      },
    })
    const options = await writeFixture({ secondComment: commentFor(secondDoc) })

    await expect(collectClientBlockDocs(options))
      .rejects.toThrow('Duplicate client block doc uuid')
  })
})

describe('client block document persistence', () => {
  it('keeps database-managed toolbox settings on MySQL and Postgres rescans', async () => {
    const source = await readFile(resolve(process.cwd(), 'scripts/import-block-component-docs.mjs'), 'utf8')

    expect(source).not.toContain('editor_enabled = VALUES(editor_enabled)')
    expect(source).not.toContain('toolbox_visible = VALUES(toolbox_visible)')
    expect(source).not.toContain('sort_order = VALUES(sort_order)')
    expect(source).not.toContain('editor_enabled = excluded.editor_enabled')
    expect(source).not.toContain('toolbox_visible = excluded.toolbox_visible')
    expect(source).not.toContain('sort_order = excluded.sort_order')
  })

  it('does not generate an editor-side document cache', async () => {
    const source = await readFile(resolve(process.cwd(), 'scripts/import-block-component-docs.mjs'), 'utf8')

    expect(source).not.toContain('clientBlockDocs.generated')
    expect(source).toContain('--write-editor-cache has been removed')
  })
})
