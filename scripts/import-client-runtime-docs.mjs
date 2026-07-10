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

const actionRequiredFields = [
  'version', 'actionName', 'displayName', 'actionType', 'category', 'description',
  'inputs', 'outputs', 'errors', 'config', 'nodeSchema', 'runtime', 'examples',
]
const processorRequiredFields = [
  'version', 'processorName', 'displayName', 'category', 'description',
  'inputs', 'params', 'outputs', 'errors', 'config', 'runtime', 'examples',
]

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toPosixPath(value) {
  return value.split(path.sep).join('/')
}

function workspaceRelative(filePath) {
  return toPosixPath(path.relative(workspaceRoot, filePath))
}

async function readText(filePath) {
  return await readFile(filePath, 'utf8')
}

function parseSource(filePath, source) {
  const scriptKind = filePath.endsWith('.vue') ? ts.ScriptKind.TS : ts.ScriptKind.TS
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind)
}

function unwrapExpression(expression) {
  let current = expression
  while (
    ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isParenthesizedExpression(current)
    || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(current))
  ) {
    current = current.expression
  }
  return current
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

function cleanJsDoc(rawComment) {
  return rawComment
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join('\n')
}

function parseDocComment(rawComment, tag, filePath) {
  const cleaned = cleanJsDoc(rawComment)
  const tagIndex = cleaned.indexOf(tag)
  if (tagIndex < 0) {
    throw new Error(`Missing ${tag} in ${workspaceRelative(filePath)}.`)
  }

  const jsonText = cleaned.slice(tagIndex + tag.length).trim()
  const start = jsonText.indexOf('{')
  const end = jsonText.lastIndexOf('}')
  if (start < 0 || end < start) {
    throw new Error(`${tag} in ${workspaceRelative(filePath)} must contain a JSON object.`)
  }

  try {
    return JSON.parse(jsonText.slice(start, end + 1))
  } catch (error) {
    throw new Error(`Invalid ${tag} in ${workspaceRelative(filePath)}: ${error.message}`)
  }
}

function leadingDocComment(sourceFile, node, tag, filePath) {
  const fullText = sourceFile.getFullText()
  const candidates = [node, node.parent, node.parent?.parent].filter(Boolean)
  const comments = candidates
    .flatMap((candidate) => ts.getLeadingCommentRanges(fullText, candidate.pos) ?? [])
    .map((range) => fullText.slice(range.pos, range.end))
    .filter((comment) => comment.includes(tag))

  if (comments.length === 0) {
    throw new Error(`Missing ${tag} for declaration in ${workspaceRelative(filePath)}.`)
  }
  if (comments.length > 1) {
    throw new Error(`Multiple ${tag} comments found before declaration in ${workspaceRelative(filePath)}.`)
  }
  return parseDocComment(comments[0], tag, filePath)
}

function findVariableDeclaration(sourceFile, variableName) {
  let found
  function visit(node) {
    if (found) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) {
      found = node
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function findFunctionDeclaration(sourceFile, functionName) {
  let found
  function visit(node) {
    if (found) return
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      found = node
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function collectNamedImports(sourceFile) {
  const imports = new Map()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      imports.set(element.name.text, statement.moduleSpecifier.text)
    }
  }
  return imports
}

async function resolveImportPath(fromFile, moduleSpecifier) {
  const base = path.resolve(path.dirname(fromFile), moduleSpecifier)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ]
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8')
      return candidate
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Cannot resolve import ${moduleSpecifier} from ${workspaceRelative(fromFile)}.`)
}

async function resolveAlias(moduleSpecifier) {
  if (!moduleSpecifier.startsWith('@/')) {
    throw new Error(`Expected an editor alias import, received ${moduleSpecifier}.`)
  }
  const relative = moduleSpecifier.slice(2)
  const candidates = [
    path.join(editorRoot, 'src', relative),
    path.join(editorRoot, 'src', `${relative}.ts`),
    path.join(editorRoot, 'src', `${relative}.js`),
  ]
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8')
      return candidate
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Cannot resolve editor alias ${moduleSpecifier}.`)
}

async function readRegistry(filePath, registryName) {
  const source = await readText(filePath)
  const sourceFile = parseSource(filePath, source)
  const declaration = findVariableDeclaration(sourceFile, registryName)
  const initializer = declaration?.initializer ? unwrapExpression(declaration.initializer) : undefined
  if (!initializer) throw new Error(`Cannot find ${registryName} in ${workspaceRelative(filePath)}.`)
  return { source, sourceFile, initializer }
}

function objectEntries(initializer) {
  if (!ts.isObjectLiteralExpression(initializer)) {
    throw new Error('Expected an object literal registry.')
  }
  return initializer.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property)) return []
    const name = propertyNameText(property.name)
    const value = unwrapExpression(property.initializer)
    if (!name || !ts.isIdentifier(value)) return []
    return [{ name, symbol: value.text }]
  })
}

function arrayObjectEntries(initializer) {
  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error('Expected an array registry.')
  }
  return initializer.elements.flatMap((element) => {
    const value = unwrapExpression(element)
    if (!ts.isObjectLiteralExpression(value)) return []
    let name
    let symbol
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const key = propertyNameText(property.name)
      const expression = unwrapExpression(property.initializer)
      if (key === 'name' && ts.isStringLiteral(expression)) name = expression.text
      if (key === 'execute' && ts.isIdentifier(expression)) symbol = expression.text
    }
    return name && symbol ? [{ name, symbol }] : []
  })
}

function validateDoc(doc, fields, identity, tag) {
  if (!isRecord(doc)) throw new Error(`${tag} for ${identity} must be an object.`)
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(doc, field)) {
      throw new Error(`${identity} ${tag} is missing required field: ${field}.`)
    }
  }
  for (const field of fields.slice(fields.indexOf('inputs'))) {
    if (!Array.isArray(doc[field])) throw new Error(`${identity} ${tag}.${field} must be an array.`)
  }
}

function normalizedSourceRefs(doc, sourceFile, reason) {
  const refs = Array.isArray(doc.sourceRefs) ? doc.sourceRefs : []
  return [{ file: workspaceRelative(sourceFile), reason }, ...refs]
}

function normalizeActionDoc(doc, entry, sourceFile, registryFile) {
  validateDoc(doc, actionRequiredFields, entry.name, '@clientActionDoc')
  if (doc.actionName !== entry.name) {
    throw new Error(`${entry.name} @clientActionDoc.actionName must match the registry.`)
  }
  const uuid = `mokelay-editor-action-${entry.name}`
  return {
    uuid,
    action_name: entry.name,
    display_name: String(doc.displayName),
    action_type: String(doc.actionType),
    category: String(doc.category),
    source_kind: 'mokelay-editor',
    source_package: 'mokelay-editor',
    source_file: workspaceRelative(sourceFile),
    executor_name: entry.symbol,
    description: String(doc.description),
    status: 'active',
    input_schema: doc.inputs,
    output_schema: doc.outputs,
    error_schema: doc.errors,
    config_schema: doc.config,
    node_schema: doc.nodeSchema,
    runtime_schema: doc.runtime,
    examples: doc.examples,
    source_refs: normalizedSourceRefs(doc, sourceFile, 'registered client action'),
    raw_meta: { registryFile: workspaceRelative(registryFile), version: doc.version },
  }
}

function normalizeProcessorDoc(doc, entry, sourceFile, registryFile) {
  validateDoc(doc, processorRequiredFields, entry.name, '@clientProcessorDoc')
  if (doc.processorName !== entry.name) {
    throw new Error(`${entry.name} @clientProcessorDoc.processorName must match the registry.`)
  }
  const uuid = `mokelay-editor-processor-${entry.name}`
  return {
    uuid,
    processor_name: entry.name,
    display_name: String(doc.displayName),
    category: String(doc.category),
    source_kind: 'mokelay-editor',
    source_package: 'mokelay-editor',
    source_file: workspaceRelative(sourceFile),
    executor_name: entry.symbol,
    description: String(doc.description),
    status: 'active',
    input_schema: doc.inputs,
    param_schema: doc.params,
    output_schema: doc.outputs,
    error_schema: doc.errors,
    config_schema: doc.config,
    runtime_schema: doc.runtime,
    examples: doc.examples,
    source_refs: normalizedSourceRefs(doc, sourceFile, 'registered client processor'),
    raw_meta: { registryFile: workspaceRelative(registryFile), version: doc.version },
  }
}

async function collectActionDocs() {
  const executorFile = path.join(editorRoot, 'src/actions/executors.ts')
  const controllerFile = path.join(editorRoot, 'src/actions/controllers.ts')
  const executorRegistry = await readRegistry(executorFile, 'actionExecutors')
  const controllerRegistry = await readRegistry(controllerFile, 'controllerActionDefinitions')
  const entries = [
    ...objectEntries(executorRegistry.initializer),
    ...objectEntries(controllerRegistry.initializer),
  ]
  const seen = new Set()
  const docs = []
  for (const entry of entries) {
    if (seen.has(entry.name)) throw new Error(`Duplicate client action registry name: ${entry.name}.`)
    seen.add(entry.name)
    const sourceFile = entry.name in Object.fromEntries(objectEntries(executorRegistry.initializer).map((item) => [item.name, true]))
      ? executorFile
      : controllerFile
    const source = sourceFile === executorFile ? executorRegistry.sourceFile : controllerRegistry.sourceFile
    const declaration = findVariableDeclaration(source, entry.symbol) ?? findFunctionDeclaration(source, entry.symbol)
    if (!declaration) throw new Error(`Cannot find ${entry.symbol} for client action ${entry.name}.`)
    const doc = leadingDocComment(source, declaration, '@clientActionDoc', sourceFile)
    docs.push(normalizeActionDoc(doc, entry, sourceFile, sourceFile))
  }
  return docs.sort((left, right) => left.category.localeCompare(right.category) || left.action_name.localeCompare(right.action_name))
}

async function collectProcessorDocs() {
  const registryFile = path.join(editorRoot, 'src/processors/registry.ts')
  const registry = await readRegistry(registryFile, 'processorDefinitions')
  const importMap = collectNamedImports(registry.sourceFile)
  const docs = []
  const seen = new Set()
  for (const entry of arrayObjectEntries(registry.initializer)) {
    if (seen.has(entry.name)) throw new Error(`Duplicate client processor registry name: ${entry.name}.`)
    seen.add(entry.name)
    const moduleSpecifier = importMap.get(entry.symbol)
    if (!moduleSpecifier) throw new Error(`Cannot resolve processor executor ${entry.symbol}.`)
    const sourceFile = moduleSpecifier.startsWith('@/')
      ? await resolveAlias(moduleSpecifier)
      : await resolveImportPath(registryFile, moduleSpecifier)
    const source = parseSource(sourceFile, await readText(sourceFile))
    const declaration = findVariableDeclaration(source, entry.symbol)
    if (!declaration) throw new Error(`Cannot find ${entry.symbol} for client processor ${entry.name}.`)
    const doc = leadingDocComment(source, declaration, '@clientProcessorDoc', sourceFile)
    docs.push(normalizeProcessorDoc(doc, entry, sourceFile, registryFile))
  }
  return docs.sort((left, right) => left.category.localeCompare(right.category) || left.processor_name.localeCompare(right.processor_name))
}

export async function collectClientRuntimeDocs() {
  const [actions, processors] = await Promise.all([collectActionDocs(), collectProcessorDocs()])
  const uuids = new Set()
  for (const doc of [...actions, ...processors]) {
    if (uuids.has(doc.uuid)) throw new Error(`Duplicate client runtime doc uuid: ${doc.uuid}.`)
    uuids.add(doc.uuid)
  }
  return { actions, processors }
}

export async function collectClientActionDocs() {
  return await collectActionDocs()
}

export async function collectClientProcessorDocs() {
  return await collectProcessorDocs()
}

function databaseType(databaseUrl) {
  const protocol = new URL(databaseUrl).protocol.replace(':', '')
  if (protocol === 'mysql') return 'mysql'
  if (protocol === 'postgres' || protocol === 'postgresql') return 'postgres'
  throw new Error(`Unsupported Mokelay_DATABASE_URL protocol: ${protocol}`)
}

async function ensureMysqlTables(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS docs_client_action (
      id bigint NOT NULL AUTO_INCREMENT, uuid varchar(128) NOT NULL, action_name varchar(128) NOT NULL,
      display_name varchar(120) NOT NULL, action_type varchar(32) NOT NULL DEFAULT 'action', category varchar(64) NOT NULL DEFAULT 'custom',
      source_kind varchar(64) NOT NULL, source_package varchar(128) NOT NULL, source_file text NOT NULL, executor_name varchar(128) NOT NULL,
      description text NOT NULL, status varchar(32) NOT NULL DEFAULT 'active', input_schema json NOT NULL, output_schema json NOT NULL,
      error_schema json NOT NULL, config_schema json NOT NULL, node_schema json NOT NULL, runtime_schema json NOT NULL,
      examples json NOT NULL, source_refs json NOT NULL, raw_meta json NOT NULL, created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (id),
      UNIQUE KEY uk_docs_client_action_uuid (uuid), UNIQUE KEY uk_docs_client_action_name (action_name), KEY idx_docs_client_action_category (category),
      KEY idx_docs_client_action_source_kind (source_kind)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='客户端 Action 文档表'
  `)
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS docs_client_processor (
      id bigint NOT NULL AUTO_INCREMENT, uuid varchar(128) NOT NULL, processor_name varchar(128) NOT NULL,
      display_name varchar(120) NOT NULL, category varchar(64) NOT NULL DEFAULT 'custom', source_kind varchar(64) NOT NULL,
      source_package varchar(128) NOT NULL, source_file text NOT NULL, executor_name varchar(128) NOT NULL, description text NOT NULL,
      status varchar(32) NOT NULL DEFAULT 'active', input_schema json NOT NULL, param_schema json NOT NULL, output_schema json NOT NULL,
      error_schema json NOT NULL, config_schema json NOT NULL, runtime_schema json NOT NULL, examples json NOT NULL, source_refs json NOT NULL,
      raw_meta json NOT NULL, created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id), UNIQUE KEY uk_docs_client_processor_uuid (uuid), UNIQUE KEY uk_docs_client_processor_name (processor_name),
      KEY idx_docs_client_processor_category (category), KEY idx_docs_client_processor_source_kind (source_kind)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='客户端 Processor 文档表'
  `)
}

async function ensurePostgresTables(sql) {
  await sql`CREATE TABLE IF NOT EXISTS docs_client_action (
    id bigserial PRIMARY KEY, uuid varchar(128) NOT NULL UNIQUE, action_name varchar(128) NOT NULL UNIQUE,
    display_name varchar(120) NOT NULL, action_type varchar(32) NOT NULL DEFAULT 'action', category varchar(64) NOT NULL DEFAULT 'custom',
    source_kind varchar(64) NOT NULL, source_package varchar(128) NOT NULL, source_file text NOT NULL DEFAULT '', executor_name varchar(128) NOT NULL,
    description text NOT NULL DEFAULT '', status varchar(32) NOT NULL DEFAULT 'active', input_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
    output_schema jsonb NOT NULL DEFAULT '[]'::jsonb, error_schema jsonb NOT NULL DEFAULT '[]'::jsonb, config_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
    node_schema jsonb NOT NULL DEFAULT '[]'::jsonb, runtime_schema jsonb NOT NULL DEFAULT '[]'::jsonb, examples jsonb NOT NULL DEFAULT '[]'::jsonb,
    source_refs jsonb NOT NULL DEFAULT '[]'::jsonb, raw_meta jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`
  await sql`CREATE TABLE IF NOT EXISTS docs_client_processor (
    id bigserial PRIMARY KEY, uuid varchar(128) NOT NULL UNIQUE, processor_name varchar(128) NOT NULL UNIQUE,
    display_name varchar(120) NOT NULL, category varchar(64) NOT NULL DEFAULT 'custom', source_kind varchar(64) NOT NULL,
    source_package varchar(128) NOT NULL, source_file text NOT NULL DEFAULT '', executor_name varchar(128) NOT NULL, description text NOT NULL DEFAULT '',
    status varchar(32) NOT NULL DEFAULT 'active', input_schema jsonb NOT NULL DEFAULT '[]'::jsonb, param_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
    output_schema jsonb NOT NULL DEFAULT '[]'::jsonb, error_schema jsonb NOT NULL DEFAULT '[]'::jsonb, config_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
    runtime_schema jsonb NOT NULL DEFAULT '[]'::jsonb, examples jsonb NOT NULL DEFAULT '[]'::jsonb, source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    raw_meta jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`
  await sql`CREATE INDEX IF NOT EXISTS idx_docs_client_action_category ON docs_client_action (category)`
  await sql`CREATE INDEX IF NOT EXISTS idx_docs_client_action_source_kind ON docs_client_action (source_kind)`
  await sql`CREATE INDEX IF NOT EXISTS idx_docs_client_processor_category ON docs_client_processor (category)`
  await sql`CREATE INDEX IF NOT EXISTS idx_docs_client_processor_source_kind ON docs_client_processor (source_kind)`
}

function actionParams(doc, encode) {
  return [doc.uuid, doc.action_name, doc.display_name, doc.action_type, doc.category, doc.source_kind, doc.source_package, doc.source_file, doc.executor_name, doc.description, doc.status, encode(doc.input_schema), encode(doc.output_schema), encode(doc.error_schema), encode(doc.config_schema), encode(doc.node_schema), encode(doc.runtime_schema), encode(doc.examples), encode(doc.source_refs), encode(doc.raw_meta)]
}

function processorParams(doc, encode) {
  return [doc.uuid, doc.processor_name, doc.display_name, doc.category, doc.source_kind, doc.source_package, doc.source_file, doc.executor_name, doc.description, doc.status, encode(doc.input_schema), encode(doc.param_schema), encode(doc.output_schema), encode(doc.error_schema), encode(doc.config_schema), encode(doc.runtime_schema), encode(doc.examples), encode(doc.source_refs), encode(doc.raw_meta)]
}

async function writeMysql(connection, actions, processors, prune, scope = {}) {
  const actionSql = `INSERT INTO docs_client_action (uuid, action_name, display_name, action_type, category, source_kind, source_package, source_file, executor_name, description, status, input_schema, output_schema, error_schema, config_schema, node_schema, runtime_schema, examples, source_refs, raw_meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE action_name=VALUES(action_name), display_name=VALUES(display_name), action_type=VALUES(action_type), category=VALUES(category), source_kind=VALUES(source_kind), source_package=VALUES(source_package), source_file=VALUES(source_file), executor_name=VALUES(executor_name), description=VALUES(description), status=VALUES(status), input_schema=VALUES(input_schema), output_schema=VALUES(output_schema), error_schema=VALUES(error_schema), config_schema=VALUES(config_schema), node_schema=VALUES(node_schema), runtime_schema=VALUES(runtime_schema), examples=VALUES(examples), source_refs=VALUES(source_refs), raw_meta=VALUES(raw_meta), updated_at=CURRENT_TIMESTAMP(6)`
  const processorSql = `INSERT INTO docs_client_processor (uuid, processor_name, display_name, category, source_kind, source_package, source_file, executor_name, description, status, input_schema, param_schema, output_schema, error_schema, config_schema, runtime_schema, examples, source_refs, raw_meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE processor_name=VALUES(processor_name), display_name=VALUES(display_name), category=VALUES(category), source_kind=VALUES(source_kind), source_package=VALUES(source_package), source_file=VALUES(source_file), executor_name=VALUES(executor_name), description=VALUES(description), status=VALUES(status), input_schema=VALUES(input_schema), param_schema=VALUES(param_schema), output_schema=VALUES(output_schema), error_schema=VALUES(error_schema), config_schema=VALUES(config_schema), runtime_schema=VALUES(runtime_schema), examples=VALUES(examples), source_refs=VALUES(source_refs), raw_meta=VALUES(raw_meta), updated_at=CURRENT_TIMESTAMP(6)`
  for (const doc of actions) await connection.execute(actionSql, actionParams(doc, JSON.stringify))
  for (const doc of processors) await connection.execute(processorSql, processorParams(doc, JSON.stringify))
  if (!prune) return
  if (scope.pruneActions) {
    const actionCondition = scope.actionType ? ' AND action_type = ?' : ''
    const actionParams = scope.actionType ? [scope.actionType] : []
    if (actions.length) {
      await connection.query(
        `DELETE FROM docs_client_action WHERE uuid NOT IN (${actions.map(() => '?').join(',')})${actionCondition}`,
        [...actions.map((doc) => doc.uuid), ...actionParams],
      )
    } else {
      await connection.query(`DELETE FROM docs_client_action WHERE 1 = 1${actionCondition}`, actionParams)
    }
  }
  if (scope.pruneProcessors) {
    if (processors.length) {
      await connection.query(`DELETE FROM docs_client_processor WHERE uuid NOT IN (${processors.map(() => '?').join(',')})`, processors.map((doc) => doc.uuid))
    } else {
      await connection.query('DELETE FROM docs_client_processor', [])
    }
  }
}

async function writePostgres(sql, actions, processors, prune, scope = {}) {
  for (const doc of actions) {
    await sql`INSERT INTO docs_client_action (uuid, action_name, display_name, action_type, category, source_kind, source_package, source_file, executor_name, description, status, input_schema, output_schema, error_schema, config_schema, node_schema, runtime_schema, examples, source_refs, raw_meta) VALUES (${doc.uuid}, ${doc.action_name}, ${doc.display_name}, ${doc.action_type}, ${doc.category}, ${doc.source_kind}, ${doc.source_package}, ${doc.source_file}, ${doc.executor_name}, ${doc.description}, ${doc.status}, ${sql.json(doc.input_schema)}, ${sql.json(doc.output_schema)}, ${sql.json(doc.error_schema)}, ${sql.json(doc.config_schema)}, ${sql.json(doc.node_schema)}, ${sql.json(doc.runtime_schema)}, ${sql.json(doc.examples)}, ${sql.json(doc.source_refs)}, ${sql.json(doc.raw_meta)}) ON CONFLICT (uuid) DO UPDATE SET action_name=excluded.action_name, display_name=excluded.display_name, action_type=excluded.action_type, category=excluded.category, source_kind=excluded.source_kind, source_package=excluded.source_package, source_file=excluded.source_file, executor_name=excluded.executor_name, description=excluded.description, status=excluded.status, input_schema=excluded.input_schema, output_schema=excluded.output_schema, error_schema=excluded.error_schema, config_schema=excluded.config_schema, node_schema=excluded.node_schema, runtime_schema=excluded.runtime_schema, examples=excluded.examples, source_refs=excluded.source_refs, raw_meta=excluded.raw_meta, updated_at=now()`
  }
  for (const doc of processors) {
    await sql`INSERT INTO docs_client_processor (uuid, processor_name, display_name, category, source_kind, source_package, source_file, executor_name, description, status, input_schema, param_schema, output_schema, error_schema, config_schema, runtime_schema, examples, source_refs, raw_meta) VALUES (${doc.uuid}, ${doc.processor_name}, ${doc.display_name}, ${doc.category}, ${doc.source_kind}, ${doc.source_package}, ${doc.source_file}, ${doc.executor_name}, ${doc.description}, ${doc.status}, ${sql.json(doc.input_schema)}, ${sql.json(doc.param_schema)}, ${sql.json(doc.output_schema)}, ${sql.json(doc.error_schema)}, ${sql.json(doc.config_schema)}, ${sql.json(doc.runtime_schema)}, ${sql.json(doc.examples)}, ${sql.json(doc.source_refs)}, ${sql.json(doc.raw_meta)}) ON CONFLICT (uuid) DO UPDATE SET processor_name=excluded.processor_name, display_name=excluded.display_name, category=excluded.category, source_kind=excluded.source_kind, source_package=excluded.source_package, source_file=excluded.source_file, executor_name=excluded.executor_name, description=excluded.description, status=excluded.status, input_schema=excluded.input_schema, param_schema=excluded.param_schema, output_schema=excluded.output_schema, error_schema=excluded.error_schema, config_schema=excluded.config_schema, runtime_schema=excluded.runtime_schema, examples=excluded.examples, source_refs=excluded.source_refs, raw_meta=excluded.raw_meta, updated_at=now()`
  }
  if (scope.pruneActions) {
    if (actions.length && scope.actionType) {
      await sql`DELETE FROM docs_client_action WHERE action_type = ${scope.actionType} AND uuid NOT IN ${sql(actions.map((doc) => doc.uuid))}`
    } else if (actions.length) {
      await sql`DELETE FROM docs_client_action WHERE uuid NOT IN ${sql(actions.map((doc) => doc.uuid))}`
    } else if (scope.actionType) {
      await sql`DELETE FROM docs_client_action WHERE action_type = ${scope.actionType}`
    } else {
      await sql`DELETE FROM docs_client_action`
    }
  }
  if (scope.pruneProcessors) {
    if (processors.length) {
      await sql`DELETE FROM docs_client_processor WHERE uuid NOT IN ${sql(processors.map((doc) => doc.uuid))}`
    } else {
      await sql`DELETE FROM docs_client_processor`
    }
  }
}

export async function writeClientRuntimeDocsToDatabase({ actions, processors }, prune = false, scope = {}) {
  const effectiveScope = Object.keys(scope).length
    ? scope
    : { pruneActions: true, pruneProcessors: true }
  const databaseUrl = process.env.Mokelay_DATABASE_URL
  if (!databaseUrl) throw new Error('Mokelay_DATABASE_URL is not configured.')
  const type = databaseType(databaseUrl)
  if (type === 'mysql') {
    const connection = await mysql.createConnection(databaseUrl)
    try {
      await ensureMysqlTables(connection)
      await writeMysql(connection, actions, processors, prune, effectiveScope)
    } finally {
      await connection.end()
    }
    return type
  }
  const sql = postgres(databaseUrl, { max: 1, prepare: false })
  try {
    await ensurePostgresTables(sql)
    await writePostgres(sql, actions, processors, prune, effectiveScope)
  } finally {
    await sql.end()
  }
  return type
}

export async function runClientRuntimeDocSync(kind = 'all', argv = process.argv.slice(2)) {
  if (!['action', 'processor', 'all'].includes(kind)) {
    throw new Error(`Unsupported client runtime doc sync kind: ${kind}. Use action, processor, or all.`)
  }
  const args = new Set(argv)
  const allDocs = await collectClientRuntimeDocs()
  const docs = kind === 'action'
    ? { actions: allDocs.actions, processors: [] }
    : kind === 'processor'
      ? { actions: [], processors: allDocs.processors }
      : allDocs
  const scope = {
    pruneActions: kind === 'action' || kind === 'all',
    pruneProcessors: kind === 'processor' || kind === 'all',
  }

  if (args.has('--dry-run')) {
    console.log(JSON.stringify({
      kind,
      actions: docs.actions.map((doc) => doc.action_name),
      processors: docs.processors.map((doc) => doc.processor_name),
      counts: { actions: docs.actions.length, processors: docs.processors.length },
    }, null, 2))
    return { docs, database: undefined }
  }

  const database = await writeClientRuntimeDocsToDatabase(docs, args.has('--prune'), scope)
  console.log(JSON.stringify({
    kind,
    database,
    counts: { actions: docs.actions.length, processors: docs.processors.length },
    pruned: args.has('--prune'),
  }, null, 2))
  return { docs, database }
}

async function main() {
  await runClientRuntimeDocSync('all')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
