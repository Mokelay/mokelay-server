import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import postgres from 'postgres'
import ts from 'typescript'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(scriptDir, '..')
const workspaceRoot = path.resolve(serverRoot, '../..')
const editorRoot = path.resolve(serverRoot, '../mokelay-editor')

dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true })

const runtimeProps = new Set([
  'edit',
  'currentBlockId',
  'getAvailableBlockDataSources',
  'previewRuntime',
])

const manualEditorJsDocs = [
  {
    uuid: 'editorjs-paragraph',
    block_type: 'paragraph',
    display_name: '段落',
    category: 'content',
    source_kind: 'editorjs',
    source_file: 'EditorJS default paragraph tool',
    description: 'EditorJS 默认段落 block。MPage 预览态会直接把 data.text 渲染为段落 HTML。',
    status: 'active',
    toolbox: {
      title: { zh: '段落', en: 'Paragraph', raw: 'EditorJS default paragraph' },
    },
    initial_props: {},
    property_schema: [
      {
        key: 'text',
        label: { zh: '段落内容', en: 'Text', raw: 'data.text' },
        type: 'html',
        valueType: 'string',
        source: 'EditorPreviewBlock.vue renders block.data.text',
      },
    ],
    event_schema: [],
    method_schema: [],
    data_fields_schema: [
      { label: 'text', variable: 'text', dataType: 'string', source: 'inferred from data.text' },
    ],
    examples: [
      { id: 'paragraph-example', type: 'paragraph', data: { text: 'Hello Mokelay' } },
    ],
    source_refs: [
      { file: 'submodule/mokelay-editor/src/blocks/MPage.vue', reason: 'registers EditorJS' },
      { file: 'submodule/mokelay-editor/src/blocks/components/EditorPreviewBlock.vue', reason: 'renders paragraph' },
    ],
    raw_meta: {
      managedBy: 'import-block-component-docs.mjs',
      notes: ['Non-custom EditorJS block, not registered as runtime method target.'],
    },
  },
  {
    uuid: 'editorjs-table',
    block_type: 'table',
    display_name: '表格',
    category: 'content',
    source_kind: 'editorjs-plugin',
    source_file: '@editorjs/table',
    description: 'EditorJS Table 插件 block。MPage 预览态读取 data.content 并按 withHeadings 渲染表格。',
    status: 'active',
    toolbox: {
      title: { zh: '表格', en: 'Table', raw: '@editorjs/table' },
    },
    initial_props: {},
    property_schema: [
      {
        key: 'content',
        label: { zh: '表格内容', en: 'Content', raw: 'data.content' },
        type: 'array',
        valueType: 'json',
        source: '@editorjs/table saved data',
      },
      {
        key: 'withHeadings',
        label: { zh: '首行为表头', en: 'With headings', raw: 'data.withHeadings' },
        type: 'checkbox',
        valueType: 'boolean',
        source: '@editorjs/table saved data',
      },
    ],
    event_schema: [],
    method_schema: [],
    data_fields_schema: [
      { label: 'content', variable: 'content', dataType: 'array', source: 'inferred from table data' },
      { label: 'withHeadings', variable: 'withHeadings', dataType: 'boolean', source: 'inferred from table data' },
    ],
    examples: [
      {
        id: 'table-example',
        type: 'table',
        data: { withHeadings: true, content: [['列1', '列2'], ['值1', '值2']] },
      },
    ],
    source_refs: [
      { file: 'submodule/mokelay-editor/src/blocks/MPage.vue', reason: 'registers @editorjs/table' },
      { file: 'submodule/mokelay-editor/src/blocks/components/EditorPreviewBlock.vue', reason: 'renders table' },
    ],
    raw_meta: {
      managedBy: 'import-block-component-docs.mjs',
      notes: ['Non-custom EditorJS plugin block, not registered as runtime method target.'],
    },
  },
  {
    uuid: 'editorjs-columns',
    block_type: 'columns',
    display_name: '多列容器',
    category: 'layout',
    source_kind: 'editorjs-plugin',
    source_file: '@calumk/editorjs-columns',
    description: 'EditorJS Columns 插件 block。每列的 data.cols[].blocks 继续保存一组 EditorJS blocks。',
    status: 'active',
    toolbox: {
      title: { zh: '多列容器', en: 'Columns', raw: '@calumk/editorjs-columns' },
    },
    initial_props: {},
    property_schema: [
      {
        key: 'cols',
        label: { zh: '列配置', en: 'Columns', raw: 'data.cols' },
        type: 'array',
        valueType: 'json',
        source: '@calumk/editorjs-columns saved data',
      },
    ],
    event_schema: [],
    method_schema: [],
    data_fields_schema: [
      { label: 'cols', variable: 'cols', dataType: 'array', source: 'inferred from columns data' },
    ],
    examples: [
      { id: 'columns-example', type: 'columns', data: { cols: [{ blocks: [] }, { blocks: [] }] } },
    ],
    source_refs: [
      { file: 'submodule/mokelay-editor/src/blocks/MPage.vue', reason: 'registers and renders columns' },
    ],
    raw_meta: {
      managedBy: 'import-block-component-docs.mjs',
      notes: ['Nested blocks under cols[].blocks preserve events through blockEvents utilities.'],
    },
  },
]

const manualLayoutDocs = [
  {
    type: 'MPageSlot',
    displayName: '页面插槽',
    description: 'LayoutRenderer 使用的页面内容插槽 block，用于把当前页面 blocks 渲染到 layout 指定位置。',
    propertySchema: [],
    sourceFile: 'submodule/mokelay-editor/src/layouts/layoutBlockRegistry.ts',
  },
  {
    type: 'MIf',
    displayName: '条件渲染',
    description: 'LayoutRenderer 使用的条件 block，按 layout 运行时上下文渲染 slots。',
    propertySchema: [
      { key: 'condition', label: { zh: '条件表达式', en: 'Condition', raw: 'data.condition' }, type: 'text' },
    ],
    sourceFile: 'submodule/mokelay-editor/src/layouts/layoutBlockRegistry.ts',
  },
]

function toPosixPath(value) {
  return value.split(path.sep).join('/')
}

function workspaceRelative(filePath) {
  return toPosixPath(path.relative(workspaceRoot, filePath))
}

async function readText(filePath) {
  return await readFile(filePath, 'utf8')
}

function extractScriptContent(filePath, source) {
  if (!filePath.endsWith('.vue')) {
    return source
  }

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

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function propertyName(name) {
  if (!name) return ''
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return name.getText()
}

function objectProperty(objectLiteral, name) {
  return objectLiteral.properties.find((property) => propertyName(property.name) === name)
}

function propertyExpression(property) {
  if (!property) return undefined
  if (ts.isPropertyAssignment(property)) return property.initializer
  if (ts.isGetAccessor(property)) {
    const statement = property.body?.statements.find(ts.isReturnStatement)
    return statement?.expression
  }
  return undefined
}

function visit(node, callback) {
  callback(node)
  ts.forEachChild(node, (child) => visit(child, callback))
}

function findVariableObject(sourceFile, variableName) {
  let result

  visit(sourceFile, (node) => {
    if (result || !ts.isVariableDeclaration(node)) return
    if (!ts.isIdentifier(node.name) || node.name.text !== variableName) return
    const initializer = node.initializer ? unwrapExpression(node.initializer) : undefined
    if (initializer && ts.isObjectLiteralExpression(initializer)) {
      result = initializer
    }
  })

  return result
}

function findVariableInitializer(sourceFile, variableName) {
  let result

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === variableName && declaration.initializer) {
        result = declaration.initializer
      }
    }
  }

  return result
}

function unwrapExpression(expression) {
  let current = expression

  while (
    ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }

  return current
}

function objectLiteralToValue(objectLiteral, sourceFile, messages) {
  const result = {}

  for (const property of objectLiteral.properties) {
    if (ts.isSpreadAssignment(property)) {
      result[`...${property.expression.getText(sourceFile)}`] = true
      continue
    }

    const name = propertyName(property.name)
    const expression = propertyExpression(property)

    if (!name || !expression) continue
    result[name] = expressionToValue(expression, sourceFile, messages)
  }

  return result
}

function expressionToValue(expression, sourceFile, messages) {
  expression = unwrapExpression(expression)

  if (ts.isStringLiteralLike(expression)) return expression.text
  if (ts.isNumericLiteral(expression)) return Number(expression.text)
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null

  if (ts.isIdentifier(expression)) {
    const initializer = findVariableInitializer(sourceFile, expression.text)
    if (initializer) {
      return expressionToValue(initializer, sourceFile, messages)
    }
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.map((element) => expressionToValue(element, sourceFile, messages))
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return objectLiteralToValue(expression, sourceFile, messages)
  }

  const i18nKey = i18nCallKey(expression)
  if (i18nKey) {
    return {
      raw: expression.getText(sourceFile),
      zh: getMessage(messages.zh, i18nKey) ?? i18nKey,
      en: getMessage(messages.en, i18nKey) ?? i18nKey,
    }
  }

  return {
    raw: expression.getText(sourceFile),
  }
}

function i18nCallKey(expression) {
  if (!ts.isCallExpression(expression) || expression.arguments.length === 0) return ''
  const firstArg = expression.arguments[0]
  if (!ts.isStringLiteralLike(firstArg)) return ''

  const callee = expression.expression
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === 't') {
    return firstArg.text
  }

  return ''
}

function expressionSummary(expression, sourceFile, messages) {
  if (!expression) return undefined
  const value = expressionToValue(expression, sourceFile, messages)

  if (typeof value === 'string') {
    return {
      raw: expression.getText(sourceFile),
      zh: value,
      en: value,
    }
  }

  if (typeof value === 'object' && value !== null && ('zh' in value || 'en' in value || 'raw' in value)) {
    return value
  }

  return {
    raw: expression.getText(sourceFile),
    value,
  }
}

function getMessage(messages, key) {
  return key.split('.').reduce((current, segment) => (
    current && typeof current === 'object' && segment in current ? current[segment] : undefined
  ), messages)
}

async function loadMessages(filePath, variableName) {
  const source = await readText(filePath)
  const sourceFile = parseSource(filePath, source)
  const objectLiteral = findVariableObject(sourceFile, variableName)
  return objectLiteral ? objectLiteralToValue(objectLiteral, sourceFile, { zh: {}, en: {} }) : {}
}

function parseImportMap(sourceFile) {
  const symbols = new Map()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
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

function resolveAlias(modulePath) {
  const withoutAlias = modulePath.replace(/^@\//, '')
  const candidates = [
    path.join(editorRoot, 'src', withoutAlias),
    path.join(editorRoot, 'src', `${withoutAlias}.ts`),
    path.join(editorRoot, 'src', `${withoutAlias}.vue`),
  ]
  return candidates
}

async function existingPath(candidates) {
  for (const candidate of candidates) {
    try {
      await readFile(candidate)
      return candidate
    } catch {
      // keep looking
    }
  }

  return candidates[0]
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

    if (!blockType || !ts.isObjectLiteralExpression(node.initializer)) return

    const spread = node.initializer.properties.find((property) => (
      ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression) && property.expression.text.endsWith('EditorTool')
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

function findDefineEditorToolArg(sourceFile) {
  let result

  visit(sourceFile, (node) => {
    if (result || !ts.isCallExpression(node)) return
    if (!ts.isIdentifier(node.expression) || node.expression.text !== 'defineEditorTool') return
    const [argument] = node.arguments
    if (argument && ts.isObjectLiteralExpression(argument)) {
      result = argument
    }
  })

  return result
}

function findDefineEditorToolType(sourceFile) {
  let result = ''

  visit(sourceFile, (node) => {
    if (result || !ts.isCallExpression(node)) return
    if (!ts.isIdentifier(node.expression) || node.expression.text !== 'defineEditorTool') return
    const [typeArg] = node.typeArguments ?? []
    if (typeArg) {
      result = typeArg.getText(sourceFile)
    }
  })

  return result
}

function findTypeMembers(sourceFile, typeName, sourceLabel) {
  if (!typeName) return []
  const members = []

  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === typeName) {
      for (const member of statement.members) {
        const name = propertyName(member.name)
        if (!name || runtimeProps.has(name)) continue

        members.push({
          key: name,
          optional: Boolean(member.questionToken),
          tsType: member.type?.getText(sourceFile) ?? 'unknown',
          source: sourceLabel,
          line: lineOf(sourceFile, member),
        })
      }
    }

    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName && ts.isTypeLiteralNode(statement.type)) {
      for (const member of statement.type.members) {
        const name = propertyName(member.name)
        if (!name || runtimeProps.has(name)) continue

        members.push({
          key: name,
          optional: Boolean(member.questionToken),
          tsType: member.type?.getText(sourceFile) ?? 'unknown',
          source: sourceLabel,
          line: lineOf(sourceFile, member),
        })
      }
    }
  }

  return members
}

function extractToolbox(toolArg, sourceFile, messages, blockType) {
  const toolboxExpression = propertyExpression(objectProperty(toolArg, 'toolbox'))
  if (!toolboxExpression || !ts.isObjectLiteralExpression(toolboxExpression)) {
    return {
      title: { zh: blockType, en: blockType, raw: blockType },
      hasIcon: false,
    }
  }

  const title = expressionSummary(propertyExpression(objectProperty(toolboxExpression, 'title')), sourceFile, messages)
    ?? { zh: blockType, en: blockType, raw: blockType }
  const iconExpression = propertyExpression(objectProperty(toolboxExpression, 'icon'))

  return {
    title,
    hasIcon: Boolean(iconExpression),
    iconSource: iconExpression?.getText(sourceFile).slice(0, 120),
  }
}

function returnedObjectExpression(functionLike) {
  if (!functionLike) return undefined

  if (ts.isArrowFunction(functionLike)) {
    if (ts.isParenthesizedExpression(functionLike.body) && ts.isObjectLiteralExpression(functionLike.body.expression)) {
      return functionLike.body.expression
    }

    if (ts.isObjectLiteralExpression(functionLike.body)) {
      return functionLike.body
    }
  }

  if (functionLike.body && ts.isBlock(functionLike.body)) {
    const statement = functionLike.body.statements.find(ts.isReturnStatement)
    if (statement?.expression && ts.isObjectLiteralExpression(statement.expression)) {
      return statement.expression
    }
  }

  return undefined
}

function extractInitialProps(toolArg, sourceFile, messages) {
  const property = objectProperty(toolArg, 'createInitialProps')
  const expression = propertyExpression(property)
  const objectLiteral = returnedObjectExpression(expression)
  return objectLiteral ? objectLiteralToValue(objectLiteral, sourceFile, messages) : {}
}

function extractPropertyFields(sourceFile, messages, sourceLabel) {
  const fields = []

  visit(sourceFile, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return
    const keyExpression = propertyExpression(objectProperty(node, 'key'))
    const labelExpression = propertyExpression(objectProperty(node, 'label'))
    if (!keyExpression || !labelExpression || !ts.isStringLiteralLike(keyExpression)) return

    const typeExpression = propertyExpression(objectProperty(node, 'type'))
    const valueTypeExpression = propertyExpression(objectProperty(node, 'valueType'))
    const placeholderExpression = propertyExpression(objectProperty(node, 'placeholder'))
    const validationExpression = propertyExpression(objectProperty(node, 'validationMessage'))
    const componentExpression = propertyExpression(objectProperty(node, 'component'))
    const optionsExpression = propertyExpression(objectProperty(node, 'options'))

    fields.push({
      key: keyExpression.text,
      label: expressionSummary(labelExpression, sourceFile, messages),
      type: readLiteralText(typeExpression, sourceFile) ?? 'text',
      valueType: readLiteralText(valueTypeExpression, sourceFile),
      placeholder: placeholderExpression ? expressionSummary(placeholderExpression, sourceFile, messages) : undefined,
      validationMessage: validationExpression ? expressionSummary(validationExpression, sourceFile, messages) : undefined,
      component: componentExpression?.getText(sourceFile),
      options: optionsExpression ? expressionToValue(optionsExpression, sourceFile, messages) : undefined,
      source: sourceLabel,
      line: lineOf(sourceFile, node),
    })
  })

  return dedupeBy(fields, (field) => `${field.key}:${field.source}:${field.line}`)
}

function readLiteralText(expression, sourceFile) {
  if (!expression) return undefined
  if (ts.isStringLiteralLike(expression)) return expression.text
  if (ts.isAsExpression(expression)) return readLiteralText(expression.expression, sourceFile)
  return expression.getText(sourceFile)
}

function extractDefineEmits(sourceFile, sourceLabel) {
  const events = []

  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return
    if (!ts.isIdentifier(node.expression) || node.expression.text !== 'defineEmits') return

    const typeText = node.typeArguments?.[0]?.getText(sourceFile) ?? ''
    const eventNames = [...typeText.matchAll(/event:\s*['"]([^'"]+)['"]/g)].map((match) => match[1])

    for (const eventName of eventNames) {
      events.push({
        event: eventName,
        payload: extractEventPayload(typeText, eventName),
        trigger: 'Vue component emit',
        source: sourceLabel,
        line: lineOf(sourceFile, node),
      })
    }

    const firstArg = node.arguments[0]
    if (firstArg && ts.isArrayLiteralExpression(firstArg)) {
      for (const element of firstArg.elements) {
        if (ts.isStringLiteralLike(element)) {
          events.push({
            event: element.text,
            payload: 'unknown',
            trigger: 'Vue component emit',
            source: sourceLabel,
            line: lineOf(sourceFile, node),
          })
        }
      }
    }
  })

  return dedupeBy(events, (event) => event.event)
}

function extractEventPayload(typeText, eventName) {
  const escaped = eventName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = typeText.match(new RegExp(`event:\\s*['"]${escaped}['"]\\s*,\\s*([^)]*)\\)`, 'm'))
  return match?.[1]?.trim() || 'void'
}

function extractDefineExpose(sourceFile, sourceText, sourceLabel) {
  const methods = []

  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return
    if (!ts.isIdentifier(node.expression) || node.expression.text !== 'defineExpose') return
    const [argument] = node.arguments
    if (!argument || !ts.isObjectLiteralExpression(argument)) return

    for (const property of argument.properties) {
      const name = ts.isShorthandPropertyAssignment(property)
        ? property.name.text
        : propertyName(property.name)
      if (!name) continue

      methods.push({
        name,
        exposed: true,
        async: new RegExp(`async\\s+function\\s+${name}\\b`).test(sourceText),
        params: 'not declared in defineExpose object',
        returns: 'unknown',
        source: sourceLabel,
        line: lineOf(sourceFile, property),
      })
    }
  })

  return dedupeBy(methods, (method) => method.name)
}

function extractDataFields(sourceFile, sourceText, messages, sourceLabel, blockType) {
  const fields = []
  const valueFieldMatches = [...sourceText.matchAll(/valueBlockDataField\(['"]([^'"]+)['"]\)/g)]

  for (const match of valueFieldMatches) {
    fields.push({
      label: '值',
      variable: 'value',
      dataType: match[1],
      source: sourceLabel,
    })
  }

  visit(sourceFile, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return
    const variableExpression = propertyExpression(objectProperty(node, 'variable'))
    const dataTypeExpression = propertyExpression(objectProperty(node, 'dataType'))
    if (!variableExpression || !dataTypeExpression) return
    const variable = readLiteralText(variableExpression, sourceFile)
    const dataType = readLiteralText(dataTypeExpression, sourceFile)
    if (!variable || !dataType || variable.includes('i18n.')) return

    const labelExpression = propertyExpression(objectProperty(node, 'label'))
    fields.push({
      label: labelExpression ? expressionSummary(labelExpression, sourceFile, messages) : variable,
      variable,
      dataType,
      source: sourceLabel,
      line: lineOf(sourceFile, node),
    })
  })

  if (blockType === 'MForm') {
    fields.push({
      label: { zh: '表单项字段', en: 'Form item field', raw: 'normalizeMFormItems(context.data.items)' },
      variable: '<item.variableName>',
      dataType: 'dynamic',
      source: sourceLabel,
      notes: 'getDataFields maps each configured form item to its variableName and labelName.',
    })
  }

  return dedupeBy(fields, (field) => field.variable)
}

function dedupeBy(items, keyFn) {
  const seen = new Set()
  const result = []

  for (const item of items) {
    const key = keyFn(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result
}

function mergeProperties(typeMembers, propertyFields) {
  const byKey = new Map()

  for (const member of typeMembers) {
    byKey.set(member.key, {
      ...member,
      declaredInProps: true,
      configurable: false,
    })
  }

  for (const field of propertyFields) {
    const existing = byKey.get(field.key) ?? {}
    byKey.set(field.key, {
      ...existing,
      ...field,
      declaredInProps: existing.declaredInProps === true,
      configurable: true,
    })
  }

  return [...byKey.values()].filter((item) => !runtimeProps.has(item.key))
}

function uuidForBlock(type, sourceKind) {
  return `${sourceKind}-${type}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 128)
}

async function readModuleSource(modulePath) {
  const filePath = await existingPath(resolveAlias(modulePath))
  const raw = await readText(filePath)
  const script = extractScriptContent(filePath, raw)
  return {
    filePath,
    source: script,
    sourceFile: parseSource(filePath, script),
    label: workspaceRelative(filePath),
  }
}

async function collectEditorToolDocs(messages) {
  const registryFile = path.join(editorRoot, 'src/editors/editorComponentRegistry.ts')
  const registrySource = await readText(registryFile)
  const registrySourceFile = parseSource(registryFile, registrySource)
  const importMap = parseImportMap(registrySourceFile)
  const entries = extractRegistryEntries(registrySourceFile, importMap)
  const docs = []

  for (const entry of entries) {
    const toolModule = entry.toolModule
    if (!toolModule) continue

    const tool = await readModuleSource(toolModule)
    const component = await readModuleSource(entry.componentModule)
    const toolArg = findDefineEditorToolArg(tool.sourceFile) ?? findDefineEditorToolArg(component.sourceFile)
    if (!toolArg) continue

    const propsType = findDefineEditorToolType(tool.sourceFile) || findDefineEditorToolType(component.sourceFile)
    const typeMembers = [
      ...findTypeMembers(tool.sourceFile, propsType, tool.label),
      ...findTypeMembers(component.sourceFile, propsType, component.label),
    ]
    const propertyFields = dedupeBy([
      ...extractPropertyFields(tool.sourceFile, messages, tool.label),
      ...extractPropertyFields(component.sourceFile, messages, component.label),
    ], (field) => field.key)
    const toolbox = extractToolbox(toolArg, tool.sourceFile, messages, entry.blockType)
    const initialProps = extractInitialProps(toolArg, tool.sourceFile, messages)
    const dataFields = dedupeBy([
      ...extractDataFields(tool.sourceFile, tool.source, messages, tool.label, entry.blockType),
      ...extractDataFields(component.sourceFile, component.source, messages, component.label, entry.blockType),
    ], (field) => field.variable)
    const events = extractDefineEmits(component.sourceFile, component.label)
    const methods = extractDefineExpose(component.sourceFile, component.source, component.label)
    const displayName = typeof toolbox.title?.zh === 'string' ? toolbox.title.zh : entry.blockType

    docs.push({
      uuid: uuidForBlock(entry.blockType, 'mokelay-editor'),
      block_type: entry.blockType,
      display_name: displayName,
      category: inferCategory(entry.blockType),
      source_kind: 'mokelay-editor',
      source_file: component.label,
      description: buildDescription(entry.blockType, displayName, component.label),
      status: 'active',
      toolbox,
      initial_props: initialProps,
      property_schema: mergeProperties(typeMembers, propertyFields),
      event_schema: events,
      method_schema: methods,
      data_fields_schema: dataFields,
      examples: buildExamples(entry.blockType, initialProps),
      source_refs: dedupeBy([
        { file: component.label, reason: 'Vue component implementation' },
        { file: tool.label, reason: 'Editor tool definition' },
        { file: workspaceRelative(registryFile), reason: 'registered editor component' },
      ], (ref) => `${ref.file}:${ref.reason}`),
      raw_meta: {
        managedBy: 'import-block-component-docs.mjs',
        propsType,
        toolSymbol: entry.toolSymbol,
        componentModule: entry.componentModule,
        toolModule,
        configurableEvents: 'All custom editor blocks can store top-level events; only emitted event names can trigger at runtime.',
      },
    })
  }

  return docs
}

function inferCategory(blockType) {
  if (blockType === 'MPage' || blockType === 'MForm' || blockType === 'MEditorSelector') return 'container'
  if (blockType.includes('Table') || blockType.includes('Chart') || blockType.includes('Datasource')) return 'data'
  if (blockType.includes('Field') || blockType === 'MInput' || blockType === 'MAdvanceInput') return 'form'
  if (blockType.includes('Button') || blockType.includes('Action')) return 'action'
  if (blockType.includes('Page')) return 'page'
  return 'content'
}

function buildDescription(blockType, displayName, sourceFile) {
  return `${displayName} (${blockType})，来源于 ${sourceFile}。属性、事件、方法由当前 mokelay-editor 源码自动抽取。`
}

function buildExamples(blockType, initialProps) {
  const data = Object.fromEntries(
    Object.entries(initialProps ?? {}).filter(([key]) => !runtimeProps.has(key)),
  )

  return [{
    id: `${blockType}-example`,
    type: blockType,
    data,
  }]
}

async function collectLayoutDocs(messages) {
  const topNavTypes = await readModuleSource('@/layouts/topNavTypes')
  const topNavProps = findTypeMembers(topNavTypes.sourceFile, 'TopNavProps', topNavTypes.label)
  const registryFile = path.join(editorRoot, 'src/layouts/layoutBlockRegistry.ts')
  const registrySource = await readText(registryFile)
  const layoutTypes = [
    'MSiteTopNav',
    'MEditorTopNav',
    'MWebTopNav',
    'MTopNav',
  ]
  const docs = manualLayoutDocs.map((item) => ({
    uuid: uuidForBlock(item.type, 'layout'),
    block_type: item.type,
    display_name: item.displayName,
    category: 'layout',
    source_kind: 'layout',
    source_file: item.sourceFile,
    description: item.description,
    status: 'active',
    toolbox: { title: { zh: item.displayName, en: item.type, raw: item.type } },
    initial_props: {},
    property_schema: item.propertySchema,
    event_schema: [],
    method_schema: [],
    data_fields_schema: [],
    examples: [{ id: `${item.type}-example`, type: item.type, data: {} }],
    source_refs: [{ file: item.sourceFile, reason: 'registered layout block' }],
    raw_meta: {
      managedBy: 'import-block-component-docs.mjs',
      registryExcerpt: registrySource.includes(item.type) ? 'registered' : 'manual',
    },
  }))

  for (const type of layoutTypes) {
    const component = await readModuleSource(`@/layouts/${type}.vue`)
    docs.push({
      uuid: uuidForBlock(type, 'layout'),
      block_type: type,
      display_name: type,
      category: 'layout',
      source_kind: 'layout',
      source_file: component.label,
      description: `${type} layout navigation block，使用 TopNavProps 并通过 normalizeTopNavProps 归一化数据。`,
      status: 'active',
      toolbox: { title: { zh: type, en: type, raw: type } },
      initial_props: {},
      property_schema: topNavProps,
      event_schema: extractDefineEmits(component.sourceFile, component.label),
      method_schema: extractDefineExpose(component.sourceFile, component.source, component.label),
      data_fields_schema: [],
      examples: [{ id: `${type}-example`, type, data: {} }],
      source_refs: [
        { file: component.label, reason: 'Vue layout component' },
        { file: topNavTypes.label, reason: 'TopNavProps declaration' },
        { file: workspaceRelative(registryFile), reason: 'registered layout block' },
      ],
      raw_meta: {
        managedBy: 'import-block-component-docs.mjs',
        normalizedBy: 'submodule/mokelay-editor/src/layouts/topNavRuntime.ts',
      },
    })
  }

  const adminShell = await readModuleSource('@/layouts/MInternalAdminShell.vue')
  docs.push({
    uuid: uuidForBlock('MInternalAdminShell', 'layout'),
    block_type: 'MInternalAdminShell',
    display_name: '内部管理台壳',
    category: 'layout',
    source_kind: 'layout',
    source_file: adminShell.label,
    description: '内部管理台 layout shell，读取 data/context 渲染侧边栏、顶部工具、标签页和用户信息。',
    status: 'active',
    toolbox: { title: { zh: '内部管理台壳', en: 'Internal Admin Shell', raw: 'MInternalAdminShell' } },
    initial_props: {},
    property_schema: findTypeMembers(adminShell.sourceFile, '', adminShell.label),
    event_schema: extractDefineEmits(adminShell.sourceFile, adminShell.label),
    method_schema: extractDefineExpose(adminShell.sourceFile, adminShell.source, adminShell.label),
    data_fields_schema: [],
    examples: [{ id: 'MInternalAdminShell-example', type: 'MInternalAdminShell', data: {} }],
    source_refs: [
      { file: adminShell.label, reason: 'Vue layout component' },
      { file: workspaceRelative(registryFile), reason: 'registered layout block' },
    ],
    raw_meta: {
      managedBy: 'import-block-component-docs.mjs',
      dataKeys: [
        'environmentLabel',
        'searchPlaceholder',
        'favoriteMenuTitle',
        'sidebarMenu',
        'favoriteMenu',
        'quickMenu',
        'tabs',
        'header',
      ],
    },
  })

  return docs
}

async function collectDocs() {
  const messages = {
    zh: await loadMessages(path.join(editorRoot, 'src/langs/zh.ts'), 'zhMessages'),
    en: await loadMessages(path.join(editorRoot, 'src/langs/en.ts'), 'enMessages'),
  }
  const customDocs = await collectEditorToolDocs(messages)
  const layoutDocs = await collectLayoutDocs(messages)

  return [
    ...manualEditorJsDocs,
    ...customDocs,
    ...layoutDocs,
  ].map(normalizeDoc)
}

function normalizeDoc(doc) {
  const propertyCount = Array.isArray(doc.property_schema) ? doc.property_schema.length : 0
  const eventCount = Array.isArray(doc.event_schema) ? doc.event_schema.length : 0
  const methodCount = Array.isArray(doc.method_schema) ? doc.method_schema.length : 0
  const dataFieldCount = Array.isArray(doc.data_fields_schema) ? doc.data_fields_schema.length : 0

  return {
    uuid: doc.uuid,
    block_type: doc.block_type,
    display_name: doc.display_name || doc.block_type,
    category: doc.category || 'custom',
    source_kind: doc.source_kind || 'mokelay-editor',
    source_file: doc.source_file || '',
    description: doc.description || '',
    status: doc.status || 'active',
    toolbox: doc.toolbox ?? {},
    initial_props: doc.initial_props ?? {},
    property_schema: doc.property_schema ?? [],
    event_schema: doc.event_schema ?? [],
    method_schema: doc.method_schema ?? [],
    data_fields_schema: doc.data_fields_schema ?? [],
    examples: doc.examples ?? [],
    source_refs: doc.source_refs ?? [],
    raw_meta: {
      ...(doc.raw_meta ?? {}),
      counts: {
        properties: propertyCount,
        events: eventCount,
        methods: methodCount,
        dataFields: dataFieldCount,
      },
      importedFromCodeAt: new Date().toISOString(),
    },
  }
}

function databaseType(databaseUrl) {
  const protocol = new URL(databaseUrl).protocol.replace(/:$/, '')
  if (protocol === 'mysql') return 'mysql'
  if (protocol === 'postgres' || protocol === 'postgresql') return 'postgres'
  throw new Error(`Unsupported Mokelay_DATABASE_URL protocol: ${protocol}`)
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
      source_file text NOT NULL,
      description text NOT NULL,
      status varchar(32) NOT NULL DEFAULT 'active',
      toolbox json NOT NULL,
      initial_props json NOT NULL,
      property_schema json NOT NULL,
      event_schema json NOT NULL,
      method_schema json NOT NULL,
      data_fields_schema json NOT NULL,
      examples json NOT NULL,
      source_refs json NOT NULL,
      raw_meta json NOT NULL,
      created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY uk_docs_client_block_uuid (uuid),
      UNIQUE KEY uk_docs_client_block_block_type (block_type),
      KEY idx_docs_client_block_category (category),
      KEY idx_docs_client_block_source_kind (source_kind)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Block 组件文档表'
  `)

  const [idColumns] = await connection.execute(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'docs_client_block'
      AND column_name = 'id'
  `)
  if (!idColumns.length) {
    await connection.execute(`
      ALTER TABLE docs_client_block
        DROP PRIMARY KEY,
        ADD COLUMN id bigint NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST,
        ADD UNIQUE KEY uk_docs_client_block_uuid (uuid)
    `)
  }
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
      source_file text NOT NULL DEFAULT '',
      description text NOT NULL DEFAULT '',
      status varchar(32) NOT NULL DEFAULT 'active',
      toolbox jsonb NOT NULL DEFAULT '{}'::jsonb,
      initial_props jsonb NOT NULL DEFAULT '{}'::jsonb,
      property_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      event_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      method_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      data_fields_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      examples jsonb NOT NULL DEFAULT '[]'::jsonb,
      source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
      raw_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `
  const idColumns = await sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'docs_client_block'
      AND column_name = 'id'
  `
  if (!idColumns.length) {
    await sql`ALTER TABLE docs_client_block DROP CONSTRAINT IF EXISTS docs_client_block_pkey`
    await sql`ALTER TABLE docs_client_block ADD COLUMN id bigserial`
    await sql`ALTER TABLE docs_client_block ADD CONSTRAINT docs_client_block_pkey PRIMARY KEY (id)`
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'docs_client_block'::regclass
            AND conname = 'docs_client_block_uuid_unique'
        ) THEN
          ALTER TABLE docs_client_block ADD CONSTRAINT docs_client_block_uuid_unique UNIQUE (uuid);
        END IF;
      END $$;
    `
  }
  await sql`CREATE INDEX IF NOT EXISTS idx_docs_client_block_category ON docs_client_block (category)`
  await sql`CREATE INDEX IF NOT EXISTS idx_docs_client_block_source_kind ON docs_client_block (source_kind)`
}

async function upsertMysql(connection, docs) {
  const query = `
    INSERT INTO docs_client_block (
      uuid, block_type, display_name, category, source_kind, source_file, description, status,
      toolbox, initial_props, property_schema, event_schema, method_schema, data_fields_schema,
      examples, source_refs, raw_meta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      display_name = VALUES(display_name),
      category = VALUES(category),
      source_kind = VALUES(source_kind),
      source_file = VALUES(source_file),
      description = VALUES(description),
      status = VALUES(status),
      toolbox = VALUES(toolbox),
      initial_props = VALUES(initial_props),
      property_schema = VALUES(property_schema),
      event_schema = VALUES(event_schema),
      method_schema = VALUES(method_schema),
      data_fields_schema = VALUES(data_fields_schema),
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
        uuid, block_type, display_name, category, source_kind, source_file, description, status,
        toolbox, initial_props, property_schema, event_schema, method_schema, data_fields_schema,
        examples, source_refs, raw_meta
      ) VALUES (
        ${doc.uuid}, ${doc.block_type}, ${doc.display_name}, ${doc.category}, ${doc.source_kind},
        ${doc.source_file}, ${doc.description}, ${doc.status},
        ${sql.json(doc.toolbox)}, ${sql.json(doc.initial_props)}, ${sql.json(doc.property_schema)},
        ${sql.json(doc.event_schema)}, ${sql.json(doc.method_schema)}, ${sql.json(doc.data_fields_schema)},
        ${sql.json(doc.examples)}, ${sql.json(doc.source_refs)}, ${sql.json(doc.raw_meta)}
      )
      ON CONFLICT (uuid) DO UPDATE SET
        block_type = excluded.block_type,
        display_name = excluded.display_name,
        category = excluded.category,
        source_kind = excluded.source_kind,
        source_file = excluded.source_file,
        description = excluded.description,
        status = excluded.status,
        toolbox = excluded.toolbox,
        initial_props = excluded.initial_props,
        property_schema = excluded.property_schema,
        event_schema = excluded.event_schema,
        method_schema = excluded.method_schema,
        data_fields_schema = excluded.data_fields_schema,
        examples = excluded.examples,
        source_refs = excluded.source_refs,
        raw_meta = excluded.raw_meta,
        updated_at = now()
    `
  }
}

function docParams(doc, encodeJson) {
  return [
    doc.uuid,
    doc.block_type,
    doc.display_name,
    doc.category,
    doc.source_kind,
    doc.source_file,
    doc.description,
    doc.status,
    encodeJson(doc.toolbox),
    encodeJson(doc.initial_props),
    encodeJson(doc.property_schema),
    encodeJson(doc.event_schema),
    encodeJson(doc.method_schema),
    encodeJson(doc.data_fields_schema),
    encodeJson(doc.examples),
    encodeJson(doc.source_refs),
    encodeJson(doc.raw_meta),
  ]
}

async function pruneMysql(connection, docs) {
  const uuids = docs.map((doc) => doc.uuid)
  if (!uuids.length) return
  const placeholders = uuids.map(() => '?').join(', ')
  await connection.execute(
    `DELETE FROM docs_client_block WHERE source_kind IN ('editorjs', 'editorjs-plugin', 'mokelay-editor', 'layout') AND uuid NOT IN (${placeholders})`,
    uuids,
  )
}

async function prunePostgres(sql, docs) {
  const uuids = docs.map((doc) => doc.uuid)
  if (!uuids.length) return
  await sql`
    DELETE FROM docs_client_block
    WHERE source_kind IN ('editorjs', 'editorjs-plugin', 'mokelay-editor', 'layout')
      AND uuid NOT IN ${sql(uuids)}
  `
}

async function writeToDatabase(docs, prune) {
  const databaseUrl = process.env.Mokelay_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('Mokelay_DATABASE_URL is not configured.')
  }

  const type = databaseType(databaseUrl)
  if (type === 'mysql') {
    const connection = await mysql.createConnection(databaseUrl)
    try {
      await ensureMysqlTable(connection)
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
  const docs = await collectDocs()

  if (dryRun) {
    console.log(JSON.stringify({
      count: docs.length,
      blockTypes: docs.map((doc) => doc.block_type),
    }, null, 2))
    return
  }

  const type = await writeToDatabase(docs, prune)
  console.log(`Imported ${docs.length} block component docs into ${type} database.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
