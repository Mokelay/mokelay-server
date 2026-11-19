import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'
import postgres from 'postgres'

function config(raw, label) {
  if (!raw) throw new Error(`${label} is required`)
  const url = new URL(raw)
  const dialect = url.protocol === 'mysql:' ? 'mysql' : ['postgres:', 'postgresql:'].includes(url.protocol) ? 'postgres' : null
  const name = decodeURIComponent(url.pathname.slice(1))
  if (!dialect || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid ${label}`)
  return { url, dialect, name }
}

async function connect({ url, dialect }) {
  if (dialect === 'mysql') {
    const client = await mysql.createConnection({ uri: url.href, dateStrings: true, timezone: 'Z', multipleStatements: true })
    await client.query("SET time_zone = '+00:00'")
    return {
      query: async (sql, values = []) => (await client.query(sql, values))[0],
      close: () => client.end(),
    }
  }
  const client = postgres(url.href, { max: 1, onnotice: () => {},
    types: { timestamp: { to: 1184, from: [1184], serialize: value => value, parse: value => value } },
  })
  await client.unsafe("SET TIME ZONE 'UTC'")
  return { query: (sql, values = []) => client.unsafe(sql, values), close: () => client.end() }
}

const tables = [
  { name: 'reimbursement_categories', key: 'value', fields: ['value', 'label', 'active', 'position'] },
  { name: 'reimbursement_applications', key: 'id', fields: ['id', 'enterprise_uuid', 'employee_id', 'version', 'status', 'show_help', 'category', 'fiat', 'crypto', 'loan', 'note', 'updated_at'], generated: ['settlement'] },
]

export async function initializeLarkDatabase({ copyExisting = false, env = process.env } = {}) {
  const target = config(env.Lark_DATABASE_URL, 'Lark_DATABASE_URL')
  const platform = env.Mokelay_DATABASE_URL ? config(env.Mokelay_DATABASE_URL, 'Mokelay_DATABASE_URL') : undefined
  if (target.name.toLowerCase() === 'mokelay' || (platform && target.name === platform.name && target.url.host === platform.url.host)) {
    throw new Error('Lark must use a separate business database')
  }
  if (copyExisting && (!platform || platform.dialect !== target.dialect)) {
    throw new Error('Copy requires a platform database using the same database engine')
  }
  const quote = name => target.dialect === 'mysql' ? `\`${name}\`` : `"${name}"`
  const placeholders = fields => fields.map((_, i) => target.dialect === 'mysql' ? '?' : `$${i + 1}`).join(', ')
  const adminUrl = new URL(target.url)
  adminUrl.pathname = target.dialect === 'mysql' ? '/' : '/postgres'
  const admin = await connect({ ...target, url: adminUrl })
  try {
    if (target.dialect === 'mysql') {
      await admin.query(`CREATE DATABASE IF NOT EXISTS ${quote(target.name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    } else {
      const rows = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [target.name])
      if (!rows.length) await admin.query(`CREATE DATABASE ${quote(target.name)}`)
    }
  } finally { await admin.close() }

  const database = await connect(target)
  let source
  const copied = {}
  try {
    const schema = await readFile(new URL(`../server/database/lark/${target.dialect}.sql`, import.meta.url), 'utf8')
    await database.query(schema)
    if (copyExisting) {
      source = await connect(platform)
      await source.query(target.dialect === 'mysql' ? 'START TRANSACTION WITH CONSISTENT SNAPSHOT' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    }
    await database.query('BEGIN')
    for (const table of tables) {
      if (!source) continue
      const columns = [...table.fields, ...(table.generated ?? [])]
      const rows = await source.query(`SELECT ${columns.map(quote).join(', ')} FROM ${quote(table.name)} ORDER BY ${quote(table.key)}`)
      const select = `SELECT ${columns.map(quote).join(', ')} FROM ${quote(table.name)} WHERE ${quote(table.key)} = ${target.dialect === 'mysql' ? '?' : '$1'}`
      for (const row of rows) {
        let [existing] = await database.query(select, [row[table.key]])
        if (!existing) {
          await database.query(`INSERT INTO ${quote(table.name)} (${table.fields.map(quote).join(', ')}) VALUES (${placeholders(table.fields)})`, table.fields.map(field => row[field]))
          ;[existing] = await database.query(select, [row[table.key]])
        }
        if (!existing || columns.some(field => row[field] === null ? existing[field] !== null : String(row[field]) !== String(existing[field]))) {
          throw new Error(`Existing data differs in ${table.name}; copy aborted without overwriting records`)
        }
      }
      copied[table.name] = rows.length
    }
    await database.query(await readFile(new URL(`../server/database/lark/${target.dialect}-seed.sql`, import.meta.url), 'utf8'))
    await database.query('COMMIT')
    if (source) await source.query('COMMIT')
    const counts = {}
    for (const { name } of [...tables, { name: 'reimbursement_write_locks' }]) {
      counts[name] = Number((await database.query(`SELECT COUNT(*) AS count FROM ${quote(name)}`))[0].count)
    }
    return { database: target.name, dialect: target.dialect, verified: copied, counts }
  } catch (error) {
    await database.query('ROLLBACK').catch(() => {})
    if (source) await source.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await database.close()
    if (source) await source.close()
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--copy-existing')) throw new Error('Usage: npm run db:lark:init -- [--copy-existing]')
  initializeLarkDatabase({ copyExisting: args.includes('--copy-existing') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
