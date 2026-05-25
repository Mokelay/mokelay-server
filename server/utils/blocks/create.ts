import { sql } from 'drizzle-orm'
import { type BlockExecutor } from '../orchestration-schema'
import { mokelayError } from '../mokelay-error'
import {
  fieldValueSql,
  getCreateIdField,
  getFieldValues,
  identifierSql,
  isDuplicateRecordError,
  isPresentId,
  requireDatabaseType,
} from './shared'

/**
 * create block
 * 作用：向 table 插入一条记录，并把物理 idField 映射为标准输出 uuid。
 * inputs：datasource 数据源；table 表名；fields 待插入字段对象；idField 插入后返回或读取的唯一 ID 字段。
 * outputs：uuid，值为插入记录的唯一 ID。
 */
export const executeCreateBlock: BlockExecutor = async ({ inputs, executeSql, databaseType }) => {
  const actualDatabaseType = requireDatabaseType(databaseType)
  const table = identifierSql(inputs.table, 'table', 'BLOCK_INVALID_TABLE')
  const fields = getFieldValues(inputs.fields)
  const idField = getCreateIdField(inputs.idField)
  const columns = Object.keys(fields)
  const columnSql = sql.join(columns.map((field) => identifierSql(field, 'fields', 'BLOCK_INVALID_FIELDS')), sql`, `)
  const valueSql = sql.join(columns.map((field) => fieldValueSql(fields[field], actualDatabaseType)), sql`, `)

  try {
    const result = actualDatabaseType === 'postgres'
      ? await executeSql(sql`INSERT INTO ${table} (${columnSql}) VALUES (${valueSql}) RETURNING ${idField.fieldSql}`)
      : await executeSql(sql`INSERT INTO ${table} (${columnSql}) VALUES (${valueSql})`)
    const uuid = actualDatabaseType === 'postgres'
      ? result.rows[0]?.[idField.fieldName]
      : isPresentId(result.insertId)
        ? result.insertId
        : fields[idField.fieldName]

    if (uuid === undefined || uuid === null || uuid === '') {
      throw mokelayError('BLOCK_CREATE_MISSING_ID', 'create Block 未返回插入记录的唯一 ID。', 500)
    }

    return { uuid }
  } catch (error) {
    if (isDuplicateRecordError(error)) {
      throw mokelayError('BLOCK_DUPLICATE_RECORD', '记录已经存在。', 409, error)
    }

    throw error
  }
}
