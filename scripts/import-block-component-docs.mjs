import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import postgres from 'postgres'
import ts from 'typescript'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(scriptDir, '..')
const workspaceRoot = path.resolve(serverRoot, '../..')
const editorRoot = path.resolve(serverRoot, '../mokelay-editor')

const requiredDocFields = [
  'version',
  'blockType',
  'displayName',
  'category',
  'description',
  'registration',
  'toolbox',
  'defaultData',
  'properties',
  'events',
  'methods',
  'dataFields',
  'saveRules',
  'examples',
]

const jsonArrayFields = ['properties', 'events', 'methods', 'dataFields', 'saveRules', 'examples']
const propertyComponentNames = new Set([
  'MActionEditor',
  'MActionToolBarEditor',
  'MAdvanceTableColumnsEditor',
  'MDatasourceEditor',
  'MFormItemsEditor',
  'MVariableValueEditor',
])

dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true })

const manualEditorJsDocs = [
  {
    uuid: 'editorjs-paragraph',
    block_type: 'paragraph',
    display_name: '段落',
    category: 'content',
    source_kind: 'editorjs',
    source_package: 'editorjs',
    source_file: 'EditorJS default paragraph tool',
    component_name: 'paragraph',
    tool_symbol: 'paragraph',
    description: 'EditorJS 默认段落 block。MPage 预览态会直接把 data.text 渲染为段落 HTML。',
    status: 'active',
    editor_enabled: true,
    toolbox_visible: true,
    sort_order: 1,
    registration: { sourceKind: 'editorjs', componentName: 'paragraph', toolSymbol: 'paragraph', editorEnabled: true, toolboxVisible: true, sortOrder: 1 },
    toolbox: { title: { zh: '段落', en: 'Paragraph', raw: 'EditorJS default paragraph' } },
    default_data: {},
    property_schema: [{ key: 'text', label: '段落内容', type: 'html', valueType: 'string' }],
    event_schema: [],
    method_schema: [],
    data_fields_schema: [{ label: 'text', variable: 'text', dataType: 'string' }],
    save_schema: [{ key: 'text', type: 'string', description: '保存为 data.text。' }],
    examples: [{ id: 'paragraph-example', type: 'paragraph', data: { text: 'Hello Mokelay' } }],
    source_refs: [{ file: 'submodule/mokelay-editor/src/blocks/components/EditorPreviewBlock.vue', reason: 'renders paragraph' }],
    raw_meta: { managedBy: 'import-block-component-docs.mjs', manual: true },
  },
  {
    uuid: 'editorjs-table',
    block_type: 'table',
    display_name: '表格',
    category: 'content',
    source_kind: 'editorjs-plugin',
    source_package: '@editorjs/table',
    source_file: '@editorjs/table',
    component_name: 'table',
    tool_symbol: 'Table',
    description: 'EditorJS Table 插件 block。MPage 预览态读取 data.content 并按 withHeadings 渲染表格。',
    status: 'active',
    editor_enabled: true,
    toolbox_visible: true,
    sort_order: 2,
    registration: { sourceKind: 'editorjs-plugin', sourcePackage: '@editorjs/table', componentName: 'table', toolSymbol: 'Table', editorEnabled: true, toolboxVisible: true, sortOrder: 2 },
    toolbox: { title: { zh: '表格', en: 'Table', raw: '@editorjs/table' } },
    default_data: {},
    property_schema: [
      { key: 'content', label: '表格内容', type: 'array', valueType: 'json' },
      { key: 'withHeadings', label: '首行为表头', type: 'checkbox', valueType: 'boolean' },
    ],
    event_schema: [],
    method_schema: [],
    data_fields_schema: [
      { label: 'content', variable: 'content', dataType: 'array' },
      { label: 'withHeadings', variable: 'withHeadings', dataType: 'boolean' },
    ],
    save_schema: [{ key: 'content', type: 'string[][]', description: '保存为 data.content。' }],
    examples: [{ id: 'table-example', type: 'table', data: { withHeadings: true, content: [['列1', '列2'], ['值1', '值2']] } }],
    source_refs: [{ file: 'submodule/mokelay-editor/src/blocks/MPage.vue', reason: 'registers @editorjs/table' }],
    raw_meta: { managedBy: 'import-block-component-docs.mjs', manual: true },
  },
  {
    uuid: 'editorjs-columns',
    block_type: 'columns',
    display_name: '多列容器',
    category: 'layout',
    source_kind: 'editorjs-plugin',
    source_package: '@calumk/editorjs-columns',
    source_file: '@calumk/editorjs-columns',
    component_name: 'columns',
    tool_symbol: 'EditorJsColumns',
    description: 'EditorJS Columns 插件 block。每列的 data.cols[].blocks 继续保存一组 EditorJS blocks。',
    status: 'active',
    editor_enabled: true,
    toolbox_visible: true,
    sort_order: 3,
    registration: { sourceKind: 'editorjs-plugin', sourcePackage: '@calumk/editorjs-columns', componentName: 'columns', toolSymbol: 'EditorJsColumns', editorEnabled: true, toolboxVisible: true, sortOrder: 3 },
    toolbox: { title: { zh: '多列容器', en: 'Columns', raw: '@calumk/editorjs-columns' } },
    default_data: { cols: [{ blocks: [] }, { blocks: [] }] },
    property_schema: [{ key: 'cols', label: '列配置', type: 'array', valueType: 'json' }],
    event_schema: [],
    method_schema: [],
    data_fields_schema: [{ label: 'cols', variable: 'cols', dataType: 'array' }],
    save_schema: [{ key: 'cols', type: 'Array<{ blocks: Block[] }>', description: '保存每列内部 EditorJS blocks。' }],
    examples: [{ id: 'columns-example', type: 'columns', data: { cols: [{ blocks: [] }, { blocks: [] }] } }],
    source_refs: [{ file: 'submodule/mokelay-editor/src/blocks/MPage.vue', reason: 'registers columns' }],
    raw_meta: { managedBy: 'import-block-component-docs.mjs', manual: true },
  },
]

function toPosixPath(value) {
  return value.split(path.sep).join('/')
}

function workspaceRelative(filePath) {
  return toPosixPath(path.relative(workspaceRoot, filePath))
}

async function firstExistingPath(candidates, label) {
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8')
      return candidate
    } catch {
      // keep looking
    }
  }

  throw new Error(`Cannot find ${label}. Tried: ${candidates.map(workspaceRelative).join(', ')}`)
}

async function readText(filePath) {
  return await readFile(filePath, 'utf8')
}

function extractScriptContent(filePath, source) {
  if (!filePath.endsWith('.vue')) return source

  const scripts = []
  const pattern = /<script\b[^>]*>([\s\S]*?)<\/script>/g
  let match

  while ((match = pattern.exec(source)) !== null) {
    scripts.push(match[1])
  }

  return scripts.join('\n\n')
}

function parseSource(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function cleanJsDoc(rawComment) {
  return rawComment
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join('\n')
}

export function parseClientBlockDocComment(rawComment, filePath = 'unknown') {
  const cleaned = cleanJsDoc(rawComment)
  const tagIndex = cleaned.indexOf('@clientBlockDoc')

  if (tagIndex < 0) {
    throw new Error(`Missing @clientBlockDoc in ${workspaceRelative(filePath)}.`)
  }

  const jsonText = cleaned.slice(tagIndex + '@clientBlockDoc'.length).trim()
  const start = jsonText.indexOf('{')
  const end = jsonText.lastIndexOf('}')

  if (start < 0 || end < start) {
    throw new Error(`@clientBlockDoc in ${workspaceRelative(filePath)} must contain a JSON object.`)
  }

  try {
    return JSON.parse(jsonText.slice(start, end + 1))
  } catch (error) {
    throw new Error(`Invalid @clientBlockDoc JSON in ${workspaceRelative(filePath)}: ${error.message}`)
  }
}

function visit(node, callback) {
  callback(node)
  ts.forEachChild(node, (child) => visit(child, callback))
}

function propertyName(name) {
  if (!name) return ''
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return name.getText()
}

function parseImportMap(sourceFile) {
  const symbols = new Map()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const modulePath = statement.moduleSpecifier.text
    if (!modulePath.startsWith('@/')) continue
    const clause = statement.importClause
    if (!clause) continue

    if (clause.name) {
      symbols.set(clause.name.text, modulePath)
    }

    const namedBindings = clause.namedBindings
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        symbols.set(element.name.text, modulePath)
      }
    }
  }

  return symbols
}

function resolveAlias(modulePath, root = editorRoot) {
  const withoutAlias = modulePath.replace(/^@\//, '')
  return [
    path.join(root, 'src', withoutAlias),
    path.join(root, 'src', `${withoutAlias}.ts`),
    path.join(root, 'src', `${withoutAlias}.vue`),
  ]
}

async function readModuleSource(modulePath, root = editorRoot) {
  const filePath = await firstExistingPath(resolveAlias(modulePath, root), modulePath)
  const raw = await readText(filePath)
  const source = extractScriptContent(filePath, raw)

  return {
    filePath,
    source,
    sourceFile: parseSource(filePath, source),
    label: workspaceRelative(filePath),
  }
}

function isLayoutModule(filePath, root = editorRoot) {
  const layoutDirectory = path.resolve(root, 'src/layouts')
  const relativePath = path.relative(layoutDirectory, filePath)

  return Boolean(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
}

function extractRegistryEntries(sourceFile, importMap) {
  const entries = []

  visit(sourceFile, (node) => {
    if (!ts.isPropertyAssignment(node)) return

    let blockType = ''
    if (ts.isIdentifier(node.name)) {
      blockType = node.name.text
    } else if (
      ts.isComputedPropertyName(node.name)
      && ts.isCallExpression(node.name.expression)
      && ts.isIdentifier(node.name.expression.expression)
      && node.name.expression.expression.text === 'getEditorComponentName'
      && node.name.expression.arguments.length === 1
      && ts.isIdentifier(node.name.expression.arguments[0])
    ) {
      blockType = node.name.expression.arguments[0].text
    }

    if (!blockType) return

    if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
      const dynamicModules = []
      let toolSymbol = ''

      visit(node.initializer, (child) => {
        if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const argument = child.arguments[0]
          if (argument && ts.isStringLiteral(argument)) dynamicModules.push(argument.text)
        }

        if (ts.isSpreadAssignment(child) && ts.isIdentifier(child.expression)) {
          toolSymbol = child.expression.text
        }

        if (ts.isSpreadAssignment(child) && ts.isPropertyAccessExpression(child.expression)) {
          toolSymbol = child.expression.name.text
        }
      })

      if (!toolSymbol || dynamicModules.length === 0) return
      const componentModule = dynamicModules.find((modulePath) => modulePath.endsWith(`/blocks/${blockType}.vue`))
        ?? dynamicModules[0]
      const toolModule = dynamicModules.find((modulePath) => (
        modulePath.replace(/^.*\//, '').replace(/\.(ts|js|vue)$/, '') === toolSymbol
      )) ?? componentModule

      entries.push({
        blockType,
        toolSymbol,
        toolModule,
        componentModule,
      })
      return
    }

    if (!ts.isObjectLiteralExpression(node.initializer)) return

    const spread = node.initializer.properties.find((property) => (
      ts.isSpreadAssignment(property)
      && ts.isIdentifier(property.expression)
      && importMap.has(property.expression.text)
    ))
    if (!spread || !ts.isSpreadAssignment(spread) || !ts.isIdentifier(spread.expression)) return

    entries.push({
      blockType,
      toolSymbol: spread.expression.text,
      toolModule: importMap.get(spread.expression.text),
      componentModule: importMap.get(blockType) ?? `@/blocks/${blockType}.vue`,
    })
  })

  return entries
}

function findToolDeclaration(sourceFile, toolSymbol) {
  let result

  visit(sourceFile, (node) => {
    if (result || !ts.isVariableDeclaration(node)) return
    if (ts.isIdentifier(node.name) && node.name.text === toolSymbol) {
      result = node
    }
  })

  return result
}

function validateToolDefinitionMetadataBoundary(declaration, entry, tool) {
  const initializer = declaration.initializer
  if (
    !initializer
    || !ts.isCallExpression(initializer)
    || !ts.isIdentifier(initializer.expression)
    || initializer.expression.text !== 'defineEditorTool'
    || !ts.isObjectLiteralExpression(initializer.arguments[0])
  ) {
    throw new Error(`Cannot inspect editor tool definition for ${entry.blockType} in ${tool.label}.`)
  }

  const forbiddenFields = new Set(['toolbox', 'propertyPanel', 'createInitialProps'])
  for (const property of initializer.arguments[0].properties) {
    const name = propertyName(property.name)
    if (forbiddenFields.has(name)) {
      throw new Error(`${entry.blockType} must declare ${name} only in its @clientBlockDoc comment, not in runtime code.`)
    }
  }
}

function leadingClientBlockDocComment(sourceFile, node, filePath) {
  const fullText = sourceFile.getFullText()
  const candidates = [node, node.parent, node.parent?.parent].filter(Boolean)
  const ranges = candidates.flatMap((candidate) => ts.getLeadingCommentRanges(fullText, candidate.pos) ?? [])
  const matching = ranges
    .map((range) => fullText.slice(range.pos, range.end))
    .filter((comment) => comment.includes('@clientBlockDoc'))

  if (matching.length === 0) return undefined
  if (matching.length > 1) {
    throw new Error(`Multiple @clientBlockDoc comments found before editor tool in ${workspaceRelative(filePath)}.`)
  }
  return matching[0]
}

async function readEditorToolDoc(entry, root = editorRoot) {
  if (!entry.toolModule) {
    throw new Error(`Cannot resolve tool module for registered client block ${entry.blockType}.`)
  }

  const tool = await readModuleSource(entry.toolModule, root)
  const declaration = findToolDeclaration(tool.sourceFile, entry.toolSymbol)
  if (!declaration) {
    throw new Error(`Cannot find editor tool ${entry.toolSymbol} in ${tool.label}.`)
  }

  validateToolDefinitionMetadataBoundary(declaration, entry, tool)

  const comment = leadingClientBlockDocComment(tool.sourceFile, declaration, tool.filePath)
  if (!comment) {
    throw new Error(`Missing @clientBlockDoc for ${entry.blockType} (${entry.toolSymbol}) in ${tool.label}.`)
  }

  return {
    doc: parseClientBlockDocComment(comment, tool.filePath),
    tool,
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertArray(value, fieldName, blockType) {
  if (!Array.isArray(value)) {
    throw new Error(`${blockType} @clientBlockDoc.${fieldName} must be an array.`)
  }
}

function assertRequiredFields(doc, blockType) {
  for (const fieldName of requiredDocFields) {
    if (!Object.prototype.hasOwnProperty.call(doc, fieldName)) {
      throw new Error(`${blockType} @clientBlockDoc is missing required field: ${fieldName}.`)
    }
  }

  for (const fieldName of jsonArrayFields) {
    assertArray(doc[fieldName], fieldName, blockType)
  }
}

function validatePropertyComponents(properties, blockType) {
  for (const property of properties) {
    if (!isRecord(property) || property.type !== 'component' || property.component === undefined) continue
    if (typeof property.component !== 'string' || !propertyComponentNames.has(property.component)) {
      throw new Error(`${blockType} @clientBlockDoc.properties[] uses unknown property component: ${property.component}.`)
    }
  }
}

function validateDocAgainstRegistry(doc, entry) {
  if (!isRecord(doc)) {
    throw new Error(`${entry.blockType} @clientBlockDoc must be a JSON object.`)
  }

  assertRequiredFields(doc, entry.blockType)

  if (doc.blockType !== entry.blockType) {
    throw new Error(`${entry.toolSymbol} documents blockType "${doc.blockType}", expected "${entry.blockType}".`)
  }

  if (!isRecord(doc.registration)) {
    throw new Error(`${entry.blockType} @clientBlockDoc.registration must be an object.`)
  }

  if (doc.registration.toolSymbol !== undefined && doc.registration.toolSymbol !== entry.toolSymbol) {
    throw new Error(`${entry.blockType} documents toolSymbol "${doc.registration.toolSymbol}", expected "${entry.toolSymbol}".`)
  }

  if (doc.registration.componentName !== undefined && doc.registration.componentName !== entry.blockType) {
    throw new Error(`${entry.blockType} documents componentName "${doc.registration.componentName}", expected "${entry.blockType}".`)
  }

  validatePropertyComponents(doc.properties, entry.blockType)
}

function normalizeBoolean(value, defaultValue) {
  return typeof value === 'boolean' ? value : defaultValue
}

function normalizeInteger(value, defaultValue) {
  return Number.isFinite(Number(value)) ? Number(value) : defaultValue
}

function normalizeDoc(entry, doc, tool, registryFile, index) {
  const registration = doc.registration
  const sourceFile = workspaceRelative(entry.componentFilePath)
  const sourceRefs = Array.isArray(doc.sourceRefs) ? [...doc.sourceRefs] : []
  const requiredRefs = [
    { file: sourceFile, reason: 'Vue component implementation' },
    { file: tool.label, symbol: entry.toolSymbol, reason: 'Editor tool definition and @clientBlockDoc source' },
    { file: workspaceRelative(registryFile), reason: 'registered editor component' },
  ]

  for (const ref of requiredRefs) {
    if (!sourceRefs.some((item) => isRecord(item) && item.file === ref.file && item.reason === ref.reason)) {
      sourceRefs.unshift(ref)
    }
  }

  const editorEnabled = normalizeBoolean(registration.editorEnabled, true)
  const toolboxVisible = normalizeBoolean(registration.toolboxVisible, editorEnabled)
  const sortOrder = normalizeInteger(registration.sortOrder, (index + 1) * 10)
  const defaultData = isRecord(doc.defaultData) ? doc.defaultData : {}

  return {
    uuid: typeof doc.uuid === 'string' && doc.uuid.trim() ? doc.uuid.trim() : `mokelay-editor-${entry.blockType}`,
    block_type: entry.blockType,
    display_name: doc.displayName,
    category: doc.category,
    source_kind: typeof registration.sourceKind === 'string' && registration.sourceKind.trim() ? registration.sourceKind.trim() : 'mokelay-editor',
    source_package: typeof registration.sourcePackage === 'string' && registration.sourcePackage.trim() ? registration.sourcePackage.trim() : 'mokelay-editor',
    source_file: sourceFile,
    component_name: typeof registration.componentName === 'string' && registration.componentName.trim() ? registration.componentName.trim() : entry.blockType,
    tool_symbol: entry.toolSymbol,
    description: doc.description,
    status: typeof doc.status === 'string' && doc.status.trim() ? doc.status.trim() : 'active',
    editor_enabled: editorEnabled,
    toolbox_visible: toolboxVisible,
    sort_order: sortOrder,
    registration: { ...registration, editorEnabled, toolboxVisible, sortOrder },
    toolbox: isRecord(doc.toolbox) ? doc.toolbox : {},
    initial_props: defaultData,
    default_data: defaultData,
    property_schema: doc.properties,
    event_schema: doc.events,
    method_schema: doc.methods,
    data_fields_schema: doc.dataFields,
    save_schema: doc.saveRules,
    examples: doc.examples,
    source_refs: sourceRefs,
    raw_meta: {
      version: doc.version,
      managedBy: 'import-block-component-docs.mjs',
      sourceKind: registration.sourceKind ?? 'mokelay-editor',
      registryFile: workspaceRelative(registryFile),
      componentModule: entry.componentModule,
      toolModule: entry.toolModule,
      toolSymbol: entry.toolSymbol,
      counts: {
        properties: doc.properties.length,
        events: doc.events.length,
        methods: doc.methods.length,
        dataFields: doc.dataFields.length,
        saveRules: doc.saveRules.length,
        examples: doc.examples.length,
      },
      importedFromCodeAt: new Date().toISOString(),
    },
  }
}

function normalizeManualDoc(doc) {
  return {
    initial_props: doc.default_data ?? {},
    save_schema: doc.save_schema ?? [],
    ...doc,
    raw_meta: {
      ...(doc.raw_meta ?? {}),
      counts: {
        properties: doc.property_schema?.length ?? 0,
        events: doc.event_schema?.length ?? 0,
        methods: doc.method_schema?.length ?? 0,
        dataFields: doc.data_fields_schema?.length ?? 0,
        saveRules: doc.save_schema?.length ?? 0,
        examples: doc.examples?.length ?? 0,
      },
      importedFromCodeAt: new Date().toISOString(),
    },
  }
}

export async function collectClientBlockDocs(options = {}) {
  const root = options.editorRoot ?? editorRoot
  const registryFile = options.registryFile ?? path.join(root, 'src/editors/editorComponentRegistry.ts')
  const includeManual = options.includeManual !== false
  const registrySource = await readText(registryFile)
  const registrySourceFile = parseSource(registryFile, registrySource)
  const importMap = parseImportMap(registrySourceFile)
  const entries = extractRegistryEntries(registrySourceFile, importMap)
  const docs = []
  const seenBlockTypes = new Set()
  const seenUuids = new Set()

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const component = await readModuleSource(entry.componentModule, root)

    // docs_client_block is limited to editor blocks; layout rendering modules are not Block docs.
    if (isLayoutModule(component.filePath, root)) continue

    if (seenBlockTypes.has(entry.blockType)) {
      throw new Error(`Duplicate registered client block type: ${entry.blockType}.`)
    }
    seenBlockTypes.add(entry.blockType)

    const rawDoc = await readEditorToolDoc(entry, root)
    const completeEntry = {
      ...entry,
      componentFilePath: component.filePath,
    }

    validateDocAgainstRegistry(rawDoc.doc, completeEntry)
    const doc = normalizeDoc(completeEntry, rawDoc.doc, rawDoc.tool, registryFile, index)

    if (seenUuids.has(doc.uuid)) {
      throw new Error(`Duplicate client block doc uuid: ${doc.uuid}.`)
    }
    seenUuids.add(doc.uuid)
    docs.push(doc)
  }

  const manualDocs = includeManual ? manualEditorJsDocs.map(normalizeManualDoc) : []
  for (const doc of manualDocs) {
    if (seenUuids.has(doc.uuid)) {
      throw new Error(`Duplicate client block doc uuid: ${doc.uuid}.`)
    }
    if (seenBlockTypes.has(doc.block_type)) {
      throw new Error(`Duplicate client block doc block_type: ${doc.block_type}.`)
    }
    seenUuids.add(doc.uuid)
    seenBlockTypes.add(doc.block_type)
  }

  return [...manualDocs, ...docs].sort((a, b) => (
    a.sort_order - b.sort_order
    || a.source_kind.localeCompare(b.source_kind)
    || a.category.localeCompare(b.category)
    || a.block_type.localeCompare(b.block_type)
  ))
}

function databaseType(databaseUrl) {
  const protocol = new URL(databaseUrl).protocol.replace(/:$/, '')
  if (protocol === 'mysql') return 'mysql'
  if (protocol === 'postgres' || protocol === 'postgresql') return 'postgres'
  throw new Error(`Unsupported Mokelay_DATABASE_URL protocol: ${protocol}`)
}

async function ensureMysqlColumn(connection, columnName, definition) {
  const [rows] = await connection.execute(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'docs_client_block'
      AND column_name = ?
  `, [columnName])

  if (!rows.length) {
    await connection.execute(`ALTER TABLE docs_client_block ADD COLUMN ${definition}`)
  }
}

async function ensureMysqlJsonColumn(connection, columnName, definition, fallbackExpression) {
  await ensureMysqlColumn(connection, columnName, definition)
  await connection.execute(`UPDATE docs_client_block SET ${columnName} = ${fallbackExpression} WHERE ${columnName} IS NULL`)
  await connection.execute(`ALTER TABLE docs_client_block MODIFY ${columnName} json NOT NULL`)
}

async function ensureMysqlIndex(connection, indexName, definition) {
  const [rows] = await connection.execute(`
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'docs_client_block'
      AND index_name = ?
  `, [indexName])

  if (!rows.length) {
    await connection.execute(definition)
  }
}

async function ensureMysqlTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS docs_client_block (
      id bigint NOT NULL AUTO_INCREMENT,
      uuid varchar(128) NOT NULL,
      block_type varchar(128) NOT NULL,
      display_name varchar(120) NOT NULL,
      category varchar(64) NOT NULL DEFAULT 'custom',
      source_kind varchar(64) NOT NULL DEFAULT 'mokelay-editor',
      source_package varchar(128) NOT NULL DEFAULT 'mokelay-editor',
      source_file text NOT NULL,
      component_name varchar(128) NOT NULL DEFAULT '',
      tool_symbol varchar(128) NOT NULL DEFAULT '',
      description text NOT NULL,
      status varchar(32) NOT NULL DEFAULT 'active',
      editor_enabled tinyint(1) NOT NULL DEFAULT 1,
      toolbox_visible tinyint(1) NOT NULL DEFAULT 1,
      sort_order int NOT NULL DEFAULT 0,
      registration json NOT NULL,
      toolbox json NOT NULL,
      initial_props json NOT NULL,
      default_data json NOT NULL,
      property_schema json NOT NULL,
      event_schema json NOT NULL,
      method_schema json NOT NULL,
      data_fields_schema json NOT NULL,
      save_schema json NOT NULL,
      examples json NOT NULL,
      source_refs json NOT NULL,
      raw_meta json NOT NULL,
      created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY uk_docs_client_block_uuid (uuid),
      UNIQUE KEY uk_docs_client_block_block_type (block_type),
      KEY idx_docs_client_block_category (category),
      KEY idx_docs_client_block_source_kind (source_kind),
      KEY idx_docs_client_block_editor_enabled (editor_enabled),
      KEY idx_docs_client_block_toolbox_visible (toolbox_visible)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='客户端 Block 文档表'
  `)

  await ensureMysqlColumn(connection, 'source_package', "source_package varchar(128) NOT NULL DEFAULT 'mokelay-editor'")
  await ensureMysqlColumn(connection, 'component_name', "component_name varchar(128) NOT NULL DEFAULT ''")
  await ensureMysqlColumn(connection, 'tool_symbol', "tool_symbol varchar(128) NOT NULL DEFAULT ''")
  await ensureMysqlColumn(connection, 'editor_enabled', 'editor_enabled tinyint(1) NOT NULL DEFAULT 1')
  await ensureMysqlColumn(connection, 'toolbox_visible', 'toolbox_visible tinyint(1) NOT NULL DEFAULT 1')
  await ensureMysqlColumn(connection, 'sort_order', 'sort_order int NOT NULL DEFAULT 0')
  await ensureMysqlJsonColumn(connection, 'registration', 'registration json NULL', 'JSON_OBJECT()')
  await ensureMysqlJsonColumn(connection, 'default_data', 'default_data json NULL', 'COALESCE(initial_props, JSON_OBJECT())')
  await ensureMysqlJsonColumn(connection, 'save_schema', 'save_schema json NULL', 'JSON_ARRAY()')
  await ensureMysqlIndex(connection, 'idx_docs_client_block_editor_enabled', 'CREATE INDEX idx_docs_client_block_editor_enabled ON docs_client_block (editor_enabled)')
  await ensureMysqlIndex(connection, 'idx_docs_client_block_toolbox_visible', 'CREATE INDEX idx_docs_client_block_toolbox_visible ON docs_client_block (toolbox_visible)')
}

async function ensurePostgresTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS docs_client_block (
      id bigserial PRIMARY KEY,
      uuid varchar(128) NOT NULL UNIQUE,
      block_type varchar(128) NOT NULL UNIQUE,
      display_name varchar(120) NOT NULL,
      category varchar(64) NOT NULL DEFAULT 'custom',
      source_kind varchar(64) NOT NULL DEFAULT 'mokelay-editor',
      source_package varchar(128) NOT NULL DEFAULT 'mokelay-editor',
      source_file text NOT NULL DEFAULT '',
      component_name varchar(128) NOT NULL DEFAULT '',
      tool_symbol varchar(128) NOT NULL DEFAULT '',
      description text NOT NULL DEFAULT '',
      status varchar(32) NOT NULL DEFAULT 'active',
      editor_enabled boolean NOT NULL DEFAULT true,
      toolbox_visible boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      registration jsonb NOT NULL DEFAULT '{}'::jsonb,
      toolbox jsonb NOT NULL DEFAULT '{}'::jsonb,
      initial_props jsonb NOT NULL DEFAULT '{}'::jsonb,
      default_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      property_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      event_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      method_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      data_fields_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      save_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      examples jsonb NOT NULL DEFAULT '[]'::jsonb,
      source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
      raw_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `
  await sql`ALTER TABLE docs_client_block ADD COLUMN IF NOT EXISTS source_package varchar(128) NOT NULL DEFAULT 'mokelay-editor'`
  await sql`ALTER TABLE docs_client_block ADD COLUMN IF NOT EXISTS component_name varchar(128) NOT NULL DEFAULT ''`
  await sql`ALTER TABLE docs_client_block ADD COLUMN IF NOT EXISTS tool_symbol varchar(128) NOT NULL DEFAULT ''`
  await sql`ALTER TABLE docs_client_block ADD COLUMN IF NOT EXISTS editor_enabled boolean NOT NULL DEFAULT true`
  await sql`ALTER TABLE docs_client_block ADD COLUMN IF NOT EXISTS toolbox_visible boolean NOT NULL DEFAULT true`
  await sql`ALTER TABLE docs_client_block ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0`
  await sql`ALTER TABLE docs_client_block ADD COLUMN IF NOT EXISTS registration jsonb NOT NULL DEFAULT '{}'::jsonb`
  await sql`ALTER TABLE docs_client_block ADD COLUMN IF NOT EXISTS default_data jsonb NOT NULL DEFAULT '{}'::jsonb`
  await sql`ALTER TABLE docs_client_block ADD COLUMN IF NOT EXISTS save_schema jsonb NOT NULL DEFAULT '[]'::jsonb`
  await sql`CREATE INDEX IF NOT EXISTS idx_docs_client_block_category ON docs_client_block (category)`
  await sql`CREATE INDEX IF NOT EXISTS idx_docs_client_block_source_kind ON docs_client_block (source_kind)`
  await sql`CREATE INDEX IF NOT EXISTS idx_docs_client_block_editor_enabled ON docs_client_block (editor_enabled)`
  await sql`CREATE INDEX IF NOT EXISTS idx_docs_client_block_toolbox_visible ON docs_client_block (toolbox_visible)`
}

function docParams(doc, encodeJson) {
  return [
    doc.uuid,
    doc.block_type,
    doc.display_name,
    doc.category,
    doc.source_kind,
    doc.source_package,
    doc.source_file,
    doc.component_name,
    doc.tool_symbol,
    doc.description,
    doc.status,
    doc.editor_enabled ? 1 : 0,
    doc.toolbox_visible ? 1 : 0,
    doc.sort_order,
    encodeJson(doc.registration),
    encodeJson(doc.toolbox),
    encodeJson(doc.initial_props),
    encodeJson(doc.default_data),
    encodeJson(doc.property_schema),
    encodeJson(doc.event_schema),
    encodeJson(doc.method_schema),
    encodeJson(doc.data_fields_schema),
    encodeJson(doc.save_schema),
    encodeJson(doc.examples),
    encodeJson(doc.source_refs),
    encodeJson(doc.raw_meta),
  ]
}

async function upsertMysql(connection, docs) {
  const query = `
    INSERT INTO docs_client_block (
      uuid, block_type, display_name, category, source_kind, source_package, source_file,
      component_name, tool_symbol, description, status, editor_enabled, toolbox_visible, sort_order,
      registration, toolbox, initial_props, default_data, property_schema, event_schema, method_schema,
      data_fields_schema, save_schema, examples, source_refs, raw_meta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      block_type = VALUES(block_type),
      display_name = VALUES(display_name),
      category = VALUES(category),
      source_kind = VALUES(source_kind),
      source_package = VALUES(source_package),
      source_file = VALUES(source_file),
      component_name = VALUES(component_name),
      tool_symbol = VALUES(tool_symbol),
      description = VALUES(description),
      status = VALUES(status),
      registration = VALUES(registration),
      toolbox = VALUES(toolbox),
      initial_props = VALUES(initial_props),
      default_data = VALUES(default_data),
      property_schema = VALUES(property_schema),
      event_schema = VALUES(event_schema),
      method_schema = VALUES(method_schema),
      data_fields_schema = VALUES(data_fields_schema),
      save_schema = VALUES(save_schema),
      examples = VALUES(examples),
      source_refs = VALUES(source_refs),
      raw_meta = VALUES(raw_meta),
      updated_at = CURRENT_TIMESTAMP(6)
  `

  for (const doc of docs) {
    await connection.execute(query, docParams(doc, JSON.stringify))
  }
}

async function upsertPostgres(sql, docs) {
  for (const doc of docs) {
    await sql`
      INSERT INTO docs_client_block (
        uuid, block_type, display_name, category, source_kind, source_package, source_file,
        component_name, tool_symbol, description, status, editor_enabled, toolbox_visible, sort_order,
        registration, toolbox, initial_props, default_data, property_schema, event_schema, method_schema,
        data_fields_schema, save_schema, examples, source_refs, raw_meta
      ) VALUES (
        ${doc.uuid}, ${doc.block_type}, ${doc.display_name}, ${doc.category}, ${doc.source_kind},
        ${doc.source_package}, ${doc.source_file}, ${doc.component_name}, ${doc.tool_symbol},
        ${doc.description}, ${doc.status}, ${doc.editor_enabled}, ${doc.toolbox_visible}, ${doc.sort_order},
        ${sql.json(doc.registration)}, ${sql.json(doc.toolbox)}, ${sql.json(doc.initial_props)},
        ${sql.json(doc.default_data)}, ${sql.json(doc.property_schema)}, ${sql.json(doc.event_schema)},
        ${sql.json(doc.method_schema)}, ${sql.json(doc.data_fields_schema)}, ${sql.json(doc.save_schema)},
        ${sql.json(doc.examples)}, ${sql.json(doc.source_refs)}, ${sql.json(doc.raw_meta)}
      )
      ON CONFLICT (uuid) DO UPDATE SET
        block_type = excluded.block_type,
        display_name = excluded.display_name,
        category = excluded.category,
        source_kind = excluded.source_kind,
        source_package = excluded.source_package,
        source_file = excluded.source_file,
        component_name = excluded.component_name,
        tool_symbol = excluded.tool_symbol,
        description = excluded.description,
        status = excluded.status,
        registration = excluded.registration,
        toolbox = excluded.toolbox,
        initial_props = excluded.initial_props,
        default_data = excluded.default_data,
        property_schema = excluded.property_schema,
        event_schema = excluded.event_schema,
        method_schema = excluded.method_schema,
        data_fields_schema = excluded.data_fields_schema,
        save_schema = excluded.save_schema,
        examples = excluded.examples,
        source_refs = excluded.source_refs,
        raw_meta = excluded.raw_meta,
        updated_at = now()
    `
  }
}

async function pruneMysql(connection, docs) {
  const uuids = docs.map((doc) => doc.uuid)
  if (!uuids.length) return
  const placeholders = uuids.map(() => '?').join(', ')
  await connection.execute(
    `DELETE FROM docs_client_block WHERE source_kind IN ('editorjs', 'editorjs-plugin', 'mokelay-editor') AND uuid NOT IN (${placeholders})`,
    uuids,
  )
}

async function prunePostgres(sql, docs) {
  const uuids = docs.map((doc) => doc.uuid)
  if (!uuids.length) return
  await sql`
    DELETE FROM docs_client_block
    WHERE source_kind IN ('editorjs', 'editorjs-plugin', 'mokelay-editor')
      AND uuid NOT IN ${sql(uuids)}
  `
}

async function removeLayoutDocsMysql(connection) {
  await connection.execute(
    `DELETE FROM docs_client_block WHERE source_kind = 'layout' OR source_file LIKE ?`,
    ['submodule/mokelay-editor/src/layouts/%'],
  )
}

async function removeLayoutDocsPostgres(sql) {
  await sql`
    DELETE FROM docs_client_block
    WHERE source_kind = 'layout'
      OR source_file LIKE ${'submodule/mokelay-editor/src/layouts/%'}
  `
}

export async function writeClientBlockDocsToDatabase(docs, prune = false) {
  const databaseUrl = process.env.Mokelay_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('Mokelay_DATABASE_URL is not configured.')
  }

  const type = databaseType(databaseUrl)
  if (type === 'mysql') {
    const connection = await mysql.createConnection(databaseUrl)
    try {
      await ensureMysqlTable(connection)
      await removeLayoutDocsMysql(connection)
      await upsertMysql(connection, docs)
      if (prune) await pruneMysql(connection, docs)
    } finally {
      await connection.end()
    }
    return type
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false })
  try {
    await ensurePostgresTable(sql)
    await removeLayoutDocsPostgres(sql)
    await upsertPostgres(sql, docs)
    if (prune) await prunePostgres(sql, docs)
  } finally {
    await sql.end()
  }
  return type
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const dryRun = args.has('--dry-run')
  const prune = args.has('--prune')
  if (args.has('--write-editor-cache')) {
    throw new Error('--write-editor-cache has been removed; the editor loads client Block docs from the document API.')
  }

  const docs = await collectClientBlockDocs()

  if (dryRun) {
    console.log(JSON.stringify({
      count: docs.length,
      blockTypes: docs.map((doc) => doc.block_type),
    }, null, 2))
    return
  }

  const type = await writeClientBlockDocsToDatabase(docs, prune)
  console.log(`Imported ${docs.length} client block docs into ${type} database.`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
