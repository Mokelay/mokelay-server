import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import postgres from 'postgres'
import ts from 'typescript'

const scriptPath = fileURLToPath(import.meta.url)
const scriptDir = path.dirname(scriptPath)
const serverRoot = path.resolve(scriptDir, '..')
const workspaceRoot = path.resolve(serverRoot, '../..')

let dotenvLoaded = false

function loadEnv() {
  if (!dotenvLoaded) {
    dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true })
    dotenvLoaded = true
  }
}

const requiredDocFields = [
  'version',
  'functionName',
  'displayName',
  'category',
  'description',
  'inputs',
  'outputs',
  'errors',
  'config',
  'runtime',
  'examples',
]

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toPosixPath(value) {
  return value.split(path.sep).join('/')
}

function workspaceRelative(filePath) {
  const relative = path.relative(workspaceRoot, filePath)
  return toPosixPath(relative.startsWith('..') ? filePath : relative)
}

async function pathExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function firstExistingPath(candidates, description) {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  throw new Error(`Cannot find ${description}. Checked: ${candidates.join(', ')}`)
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
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }

  return undefined
}

function objectProperty(objectExpression, propertyName) {
  const objectLiteral = unwrapExpression(objectExpression)
  if (!ts.isObjectLiteralExpression(objectLiteral)) {
    return undefined
  }

  return objectLiteral.properties.find((property) => (
    ts.isPropertyAssignment(property)
    && propertyNameText(property.name) === propertyName
  ))
}

function collectNamedImports(sourceFile) {
  const imports = new Map()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }

    const namedBindings = statement.importClause?.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue
    }

    for (const element of namedBindings.elements) {
      imports.set(element.name.text, statement.moduleSpecifier.text)
    }
  }

  return imports
}

function parseSourceFile(filePath, sourceText) {
  const scriptKind = filePath.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind)
}

async function readSourceFile(filePath) {
  const sourceText = await readFile(filePath, 'utf8')
  return parseSourceFile(filePath, sourceText)
}

async function resolveImportPath(fromFile, moduleSpecifier) {
  if (!moduleSpecifier.startsWith('.')) {
    throw new Error(`Only relative block imports are supported in ${workspaceRelative(fromFile)}: ${moduleSpecifier}`)
  }

  const base = path.resolve(path.dirname(fromFile), moduleSpecifier)
  const candidates = [
    base,
    base.endsWith('.js') ? `${base.slice(0, -3)}.ts` : `${base}.ts`,
    base.endsWith('.ts') ? `${base.slice(0, -3)}.js` : `${base}.js`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ]

  return await firstExistingPath(candidates, `import ${moduleSpecifier} from ${workspaceRelative(fromFile)}`)
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

async function parseStringArrayExpression(expression, sourceFile, filePath, importMap, cache) {
  const unwrapped = unwrapExpression(expression)

  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.map((element) => {
      if (!ts.isStringLiteral(element)) {
        throw new Error(`allowedOutputs in ${workspaceRelative(filePath)} must contain only string literals.`)
      }
      return element.text
    })
  }

  if (ts.isIdentifier(unwrapped)) {
    const importedFrom = importMap.get(unwrapped.text)
    const sourcePath = importedFrom
      ? await resolveImportPath(filePath, importedFrom)
      : filePath
    const cacheKey = `${sourcePath}#${unwrapped.text}`
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)
    }

    const importedSourceFile = sourcePath === filePath ? sourceFile : await readSourceFile(sourcePath)
    const declaration = findVariableDeclaration(importedSourceFile, unwrapped.text)

    if (!declaration?.initializer) {
      throw new Error(`Cannot resolve string array ${unwrapped.text} from ${workspaceRelative(sourcePath)}.`)
    }

    const value = await parseStringArrayExpression(
      declaration.initializer,
      importedSourceFile,
      sourcePath,
      collectNamedImports(importedSourceFile),
      cache,
    )
    cache.set(cacheKey, value)
    return value
  }

  throw new Error(`allowedOutputs in ${workspaceRelative(filePath)} must be an array literal or exported string array.`)
}

async function parseBlockRegistry(config) {
  const sourceFile = await readSourceFile(config.indexPath)
  const importMap = collectNamedImports(sourceFile)
  const arrayCache = new Map()
  const registry = findVariableDeclaration(sourceFile, config.registryName)
  const initializer = registry?.initializer ? unwrapExpression(registry.initializer) : undefined

  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    throw new Error(`Cannot find ${config.registryName} object in ${workspaceRelative(config.indexPath)}.`)
  }

  const entries = []

  for (const property of initializer.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue
    }

    const functionName = propertyNameText(property.name)
    const definition = unwrapExpression(property.initializer)

    if (!functionName || !ts.isObjectLiteralExpression(definition)) {
      continue
    }

    const executorProperty = objectProperty(definition, 'executor')
    const allowedOutputsProperty = objectProperty(definition, 'allowedOutputs')

    if (!executorProperty || !allowedOutputsProperty) {
      throw new Error(`${config.registryName}.${functionName} must define executor and allowedOutputs.`)
    }

    const executorExpression = unwrapExpression(executorProperty.initializer)
    if (!ts.isIdentifier(executorExpression)) {
      throw new Error(`${config.registryName}.${functionName}.executor must be an imported identifier.`)
    }

    const moduleSpecifier = importMap.get(executorExpression.text)
    if (!moduleSpecifier) {
      throw new Error(`Cannot resolve executor import ${executorExpression.text} for ${functionName}.`)
    }

    const sourceFilePath = await resolveImportPath(config.indexPath, moduleSpecifier)
    const allowedOutputs = await parseStringArrayExpression(
      allowedOutputsProperty.initializer,
      sourceFile,
      config.indexPath,
      importMap,
      arrayCache,
    )
    const requiresDatasourceProperty = objectProperty(definition, 'requiresDatasource')
    const requiresDatasource = requiresDatasourceProperty
      ? unwrapExpression(requiresDatasourceProperty.initializer).kind === ts.SyntaxKind.TrueKeyword
      : false

    entries.push({
      functionName,
      executorName: executorExpression.text,
      allowedOutputs,
      requiresDatasource,
      sourceFilePath,
      sourceKind: config.sourceKind,
      sourcePackage: config.sourcePackage,
      registryFile: config.indexPath,
    })
  }

  return entries
}

function cleanJsDoc(rawComment) {
  return rawComment
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join('\n')
}

export function parseServerBlockDocComment(rawComment, filePath = 'unknown') {
  const cleaned = cleanJsDoc(rawComment)
  const tagIndex = cleaned.indexOf('@serverBlockDoc')

  if (tagIndex < 0) {
    throw new Error(`Missing @serverBlockDoc in ${workspaceRelative(filePath)}.`)
  }

  const jsonText = cleaned.slice(tagIndex + '@serverBlockDoc'.length).trim()
  const start = jsonText.indexOf('{')
  const end = jsonText.lastIndexOf('}')

  if (start < 0 || end < start) {
    throw new Error(`@serverBlockDoc in ${workspaceRelative(filePath)} must contain a JSON object.`)
  }

  try {
    return JSON.parse(jsonText.slice(start, end + 1))
  } catch (error) {
    throw new Error(`Invalid @serverBlockDoc JSON in ${workspaceRelative(filePath)}: ${error.message}`)
  }
}

function leadingServerBlockDocComment(sourceFile, node, filePath) {
  const fullText = sourceFile.getFullText()
  const candidates = [
    node,
    node.parent,
    node.parent?.parent,
  ].filter(Boolean)
  const ranges = candidates.flatMap((candidate) => ts.getLeadingCommentRanges(fullText, candidate.pos) ?? [])
  const matching = ranges
    .map((range) => fullText.slice(range.pos, range.end))
    .filter((comment) => comment.includes('@serverBlockDoc'))

  if (matching.length === 0) {
    return undefined
  }

  if (matching.length > 1) {
    throw new Error(`Multiple @serverBlockDoc comments found before executor in ${workspaceRelative(filePath)}.`)
  }

  return matching[0]
}

function findExecutorDeclaration(sourceFile, executorName) {
  let found

  function visit(node) {
    if (found) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === executorName) {
      found = node
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

async function readExecutorDoc(entry) {
  const sourceText = await readFile(entry.sourceFilePath, 'utf8')
  const sourceFile = parseSourceFile(entry.sourceFilePath, sourceText)
  const declaration = findExecutorDeclaration(sourceFile, entry.executorName)

  if (!declaration) {
    throw new Error(`Cannot find executor ${entry.executorName} in ${workspaceRelative(entry.sourceFilePath)}.`)
  }

  const comment = leadingServerBlockDocComment(sourceFile, declaration, entry.sourceFilePath)
  if (!comment) {
    throw new Error(`Missing @serverBlockDoc for ${entry.functionName} (${entry.executorName}) in ${workspaceRelative(entry.sourceFilePath)}.`)
  }

  return parseServerBlockDocComment(comment, entry.sourceFilePath)
}

function validateArrayField(doc, fieldName, functionName) {
  if (!Array.isArray(doc[fieldName])) {
    throw new Error(`${functionName} @serverBlockDoc.${fieldName} must be an array.`)
  }
}

function validateRequiredFields(doc, functionName) {
  for (const fieldName of requiredDocFields) {
    if (!Object.prototype.hasOwnProperty.call(doc, fieldName)) {
      throw new Error(`${functionName} @serverBlockDoc is missing required field: ${fieldName}.`)
    }
  }

  for (const fieldName of ['inputs', 'outputs', 'errors', 'config', 'runtime', 'examples']) {
    validateArrayField(doc, fieldName, functionName)
  }
}

function outputKeys(outputs, functionName) {
  return outputs.map((output) => {
    if (!isRecord(output) || typeof output.key !== 'string' || !output.key.trim()) {
      throw new Error(`${functionName} @serverBlockDoc.outputs[] must be objects with a non-empty key.`)
    }
    return output.key
  })
}

function runtimeRequiresDatasource(runtime, functionName) {
  const item = runtime.find((entry) => isRecord(entry) && entry.key === 'requiresDatasource')

  if (!isRecord(item) || typeof item.value !== 'boolean') {
    throw new Error(`${functionName} @serverBlockDoc.runtime must include { key: "requiresDatasource", value: boolean }.`)
  }

  return item.value
}

function assertSameArray(actual, expected, message) {
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new Error(`${message} Expected [${expected.join(', ')}], received [${actual.join(', ')}].`)
  }
}

function validateDocAgainstRegistry(doc, entry) {
  if (!isRecord(doc)) {
    throw new Error(`${entry.functionName} @serverBlockDoc must be a JSON object.`)
  }

  validateRequiredFields(doc, entry.functionName)

  if (doc.functionName !== entry.functionName) {
    throw new Error(`${entry.executorName} documents functionName "${doc.functionName}", expected "${entry.functionName}".`)
  }

  const documentedOutputs = outputKeys(doc.outputs, entry.functionName)
  assertSameArray(
    documentedOutputs,
    entry.allowedOutputs,
    `${entry.functionName} documented outputs must match registry allowedOutputs.`,
  )

  const documentedRequiresDatasource = runtimeRequiresDatasource(doc.runtime, entry.functionName)
  if (documentedRequiresDatasource !== entry.requiresDatasource) {
    throw new Error(`${entry.functionName} documented requiresDatasource=${documentedRequiresDatasource}, expected ${entry.requiresDatasource}.`)
  }
}

function normalizeDoc(entry, doc) {
  const sourceFile = workspaceRelative(entry.sourceFilePath)
  const sourceRefs = Array.isArray(doc.sourceRefs) ? [...doc.sourceRefs] : []

  if (!sourceRefs.some((ref) => isRecord(ref) && ref.file === sourceFile)) {
    sourceRefs.unshift({
      file: sourceFile,
      symbol: entry.executorName,
      reason: 'executor',
    })
  }

  return {
    uuid: typeof doc.uuid === 'string' && doc.uuid.trim() ? doc.uuid.trim() : `server-block-${entry.functionName}`,
    function_name: entry.functionName,
    display_name: doc.displayName,
    category: doc.category,
    source_kind: typeof doc.sourceKind === 'string' && doc.sourceKind.trim() ? doc.sourceKind.trim() : entry.sourceKind,
    source_package: typeof doc.sourcePackage === 'string' && doc.sourcePackage.trim() ? doc.sourcePackage.trim() : entry.sourcePackage,
    source_file: sourceFile,
    executor_name: entry.executorName,
    description: doc.description,
    status: typeof doc.status === 'string' && doc.status.trim() ? doc.status.trim() : 'active',
    requires_datasource: entry.requiresDatasource,
    input_schema: doc.inputs,
    output_schema: doc.outputs,
    error_schema: doc.errors,
    config_schema: doc.config,
    runtime_schema: doc.runtime,
    examples: doc.examples,
    source_refs: sourceRefs,
    raw_meta: {
      version: doc.version,
      managedBy: 'import-server-block-docs.mjs',
      sourceKind: entry.sourceKind,
      registryFile: workspaceRelative(entry.registryFile),
      allowedOutputs: entry.allowedOutputs,
      counts: {
        inputs: doc.inputs.length,
        outputs: doc.outputs.length,
        errors: doc.errors.length,
        config: doc.config.length,
        runtime: doc.runtime.length,
        examples: doc.examples.length,
      },
      importedFromCodeAt: new Date().toISOString(),
    },
  }
}

export async function defaultRegistryConfigs() {
  const coreBlocksRoot = await firstExistingPath([
    path.resolve(serverRoot, '../mokelay-server-core/src/utils/blocks'),
    path.resolve(serverRoot, 'node_modules/mokelay-server-core/src/utils/blocks'),
    path.resolve(serverRoot, 'node_modules/mokelay-server-core/dist/utils/blocks'),
  ], 'mokelay-server-core blocks root')
  const serverBlocksRoot = path.resolve(serverRoot, 'server/utils/blocks')

  return [
    {
      indexPath: await firstExistingPath([
        path.join(coreBlocksRoot, 'index.ts'),
        path.join(coreBlocksRoot, 'index.js'),
      ], 'mokelay-server-core block registry'),
      registryName: 'blockDefinitions',
      sourceKind: 'core',
      sourcePackage: 'mokelay-server-core',
    },
    {
      indexPath: await firstExistingPath([
        path.join(serverBlocksRoot, 'index.ts'),
        path.join(serverBlocksRoot, 'index.js'),
      ], 'mokelay-server block registry'),
      registryName: 'serverBlockDefinitions',
      sourceKind: 'server',
      sourcePackage: 'mokelay-server',
    },
  ]
}

export async function collectServerBlockDocs(options = {}) {
  const registries = options.registries ?? await defaultRegistryConfigs()
  const entries = (await Promise.all(registries.map((registry) => parseBlockRegistry(registry)))).flat()
  const docs = []
  const seenFunctionNames = new Set()
  const seenUuids = new Set()

  for (const entry of entries) {
    if (seenFunctionNames.has(entry.functionName)) {
      throw new Error(`Duplicate registered server block functionName: ${entry.functionName}.`)
    }
    seenFunctionNames.add(entry.functionName)

    const rawDoc = await readExecutorDoc(entry)
    validateDocAgainstRegistry(rawDoc, entry)
    const doc = normalizeDoc(entry, rawDoc)

    if (seenUuids.has(doc.uuid)) {
      throw new Error(`Duplicate server block doc uuid: ${doc.uuid}.`)
    }
    seenUuids.add(doc.uuid)
    docs.push(doc)
  }

  return docs.sort((a, b) => (
    a.source_kind.localeCompare(b.source_kind)
    || a.category.localeCompare(b.category)
    || a.function_name.localeCompare(b.function_name)
  ))
}

function databaseType(databaseUrl) {
  const protocol = new URL(databaseUrl).protocol.replace(/:$/, '')
  if (protocol === 'mysql') return 'mysql'
  if (protocol === 'postgres' || protocol === 'postgresql') return 'postgres'
  throw new Error(`Unsupported Mokelay_DATABASE_URL protocol: ${protocol}`)
}

async function ensureMysqlTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS server_block_docs (
      id bigint NOT NULL AUTO_INCREMENT,
      uuid varchar(128) NOT NULL,
      function_name varchar(128) NOT NULL,
      display_name varchar(120) NOT NULL,
      category varchar(64) NOT NULL DEFAULT 'custom',
      source_kind varchar(64) NOT NULL,
      source_package varchar(128) NOT NULL,
      source_file text NOT NULL,
      executor_name varchar(128) NOT NULL,
      description text NOT NULL,
      status varchar(32) NOT NULL DEFAULT 'active',
      requires_datasource tinyint(1) NOT NULL DEFAULT 0,
      input_schema json NOT NULL,
      output_schema json NOT NULL,
      error_schema json NOT NULL,
      config_schema json NOT NULL,
      runtime_schema json NOT NULL,
      examples json NOT NULL,
      source_refs json NOT NULL,
      raw_meta json NOT NULL,
      created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY uk_server_block_docs_uuid (uuid),
      UNIQUE KEY uk_server_block_docs_function_name (function_name),
      KEY idx_server_block_docs_category (category),
      KEY idx_server_block_docs_source_kind (source_kind),
      KEY idx_server_block_docs_requires_datasource (requires_datasource)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='服务端 Block 文档表'
  `)
}

async function ensurePostgresTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS server_block_docs (
      id bigserial PRIMARY KEY,
      uuid varchar(128) NOT NULL UNIQUE,
      function_name varchar(128) NOT NULL UNIQUE,
      display_name varchar(120) NOT NULL,
      category varchar(64) NOT NULL DEFAULT 'custom',
      source_kind varchar(64) NOT NULL,
      source_package varchar(128) NOT NULL,
      source_file text NOT NULL DEFAULT '',
      executor_name varchar(128) NOT NULL,
      description text NOT NULL DEFAULT '',
      status varchar(32) NOT NULL DEFAULT 'active',
      requires_datasource boolean NOT NULL DEFAULT false,
      input_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      output_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      error_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      config_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      runtime_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
      examples jsonb NOT NULL DEFAULT '[]'::jsonb,
      source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
      raw_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_server_block_docs_category ON server_block_docs (category)`
  await sql`CREATE INDEX IF NOT EXISTS idx_server_block_docs_source_kind ON server_block_docs (source_kind)`
  await sql`CREATE INDEX IF NOT EXISTS idx_server_block_docs_requires_datasource ON server_block_docs (requires_datasource)`
}

function docParams(doc, encodeJson) {
  return [
    doc.uuid,
    doc.function_name,
    doc.display_name,
    doc.category,
    doc.source_kind,
    doc.source_package,
    doc.source_file,
    doc.executor_name,
    doc.description,
    doc.status,
    doc.requires_datasource ? 1 : 0,
    encodeJson(doc.input_schema),
    encodeJson(doc.output_schema),
    encodeJson(doc.error_schema),
    encodeJson(doc.config_schema),
    encodeJson(doc.runtime_schema),
    encodeJson(doc.examples),
    encodeJson(doc.source_refs),
    encodeJson(doc.raw_meta),
  ]
}

async function upsertMysql(connection, docs) {
  const query = `
    INSERT INTO server_block_docs (
      uuid, function_name, display_name, category, source_kind, source_package, source_file,
      executor_name, description, status, requires_datasource, input_schema, output_schema,
      error_schema, config_schema, runtime_schema, examples, source_refs, raw_meta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      function_name = VALUES(function_name),
      display_name = VALUES(display_name),
      category = VALUES(category),
      source_kind = VALUES(source_kind),
      source_package = VALUES(source_package),
      source_file = VALUES(source_file),
      executor_name = VALUES(executor_name),
      description = VALUES(description),
      status = VALUES(status),
      requires_datasource = VALUES(requires_datasource),
      input_schema = VALUES(input_schema),
      output_schema = VALUES(output_schema),
      error_schema = VALUES(error_schema),
      config_schema = VALUES(config_schema),
      runtime_schema = VALUES(runtime_schema),
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
      INSERT INTO server_block_docs (
        uuid, function_name, display_name, category, source_kind, source_package, source_file,
        executor_name, description, status, requires_datasource, input_schema, output_schema,
        error_schema, config_schema, runtime_schema, examples, source_refs, raw_meta
      ) VALUES (
        ${doc.uuid}, ${doc.function_name}, ${doc.display_name}, ${doc.category}, ${doc.source_kind},
        ${doc.source_package}, ${doc.source_file}, ${doc.executor_name}, ${doc.description}, ${doc.status},
        ${doc.requires_datasource}, ${sql.json(doc.input_schema)}, ${sql.json(doc.output_schema)},
        ${sql.json(doc.error_schema)}, ${sql.json(doc.config_schema)}, ${sql.json(doc.runtime_schema)},
        ${sql.json(doc.examples)}, ${sql.json(doc.source_refs)}, ${sql.json(doc.raw_meta)}
      )
      ON CONFLICT (uuid) DO UPDATE SET
        function_name = excluded.function_name,
        display_name = excluded.display_name,
        category = excluded.category,
        source_kind = excluded.source_kind,
        source_package = excluded.source_package,
        source_file = excluded.source_file,
        executor_name = excluded.executor_name,
        description = excluded.description,
        status = excluded.status,
        requires_datasource = excluded.requires_datasource,
        input_schema = excluded.input_schema,
        output_schema = excluded.output_schema,
        error_schema = excluded.error_schema,
        config_schema = excluded.config_schema,
        runtime_schema = excluded.runtime_schema,
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
  await connection.execute(`DELETE FROM server_block_docs WHERE uuid NOT IN (${placeholders})`, uuids)
}

async function prunePostgres(sql, docs) {
  const uuids = docs.map((doc) => doc.uuid)
  if (!uuids.length) return
  await sql`DELETE FROM server_block_docs WHERE uuid NOT IN ${sql(uuids)}`
}

export async function writeServerBlockDocsToDatabase(docs, prune = false) {
  loadEnv()

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
  const docs = await collectServerBlockDocs()

  if (dryRun) {
    console.log(JSON.stringify({
      count: docs.length,
      functionNames: docs.map((doc) => doc.function_name),
    }, null, 2))
    return
  }

  const type = await writeServerBlockDocsToDatabase(docs, prune)
  console.log(`Imported ${docs.length} server block docs into ${type} database.`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
