import { describe, expect, it } from 'vitest'
import { mapDatabaseSchemaRows } from '../../server/utils/database-schema'

describe('database schema utilities', () => {
  it('groups columns by table while preserving query order', () => {
    const tables = mapDatabaseSchemaRows([
      { tableName: 'apis', columnName: 'uuid', columnType: 'character varying(128)' },
      { tableName: 'apis', columnName: 'api_json', columnType: 'jsonb' },
      { tableName: 'apis_snapshot', columnName: 'id', columnType: 'uuid' },
      { tableName: 'apis_snapshot', columnName: 'api_uuid', columnType: 'character varying(128)' },
      { tableName: 'apis_snapshot', columnName: 'api_json', columnType: 'jsonb' },
      { tableName: 'pages', columnName: 'uuid', columnType: 'uuid' },
      { tableName: 'pages', columnName: 'name', columnType: 'character varying(120)' },
      { tableName: 'users', columnName: 'id', columnType: 'uuid' },
      { tableName: 'users', columnName: 'email', columnType: 'character varying(255)' },
    ])

    expect(tables).toEqual([
      {
        name: 'apis',
        columns: [
          { name: 'uuid', type: 'character varying(128)', dataType: 'character varying(128)' },
          { name: 'api_json', type: 'jsonb', dataType: 'jsonb' },
        ],
      },
      {
        name: 'apis_snapshot',
        columns: [
          { name: 'id', type: 'uuid', dataType: 'uuid' },
          { name: 'api_uuid', type: 'character varying(128)', dataType: 'character varying(128)' },
          { name: 'api_json', type: 'jsonb', dataType: 'jsonb' },
        ],
      },
      {
        name: 'pages',
        columns: [
          { name: 'uuid', type: 'uuid', dataType: 'uuid' },
          { name: 'name', type: 'character varying(120)', dataType: 'character varying(120)' },
        ],
      },
      {
        name: 'users',
        columns: [
          { name: 'id', type: 'uuid', dataType: 'uuid' },
          { name: 'email', type: 'character varying(255)', dataType: 'character varying(255)' },
        ],
      },
    ])
  })

  it('returns empty column lists for tables without columns', () => {
    const tables = mapDatabaseSchemaRows([
      { tableName: 'empty_table', columnName: null, columnType: null },
    ])

    expect(tables).toEqual([
      {
        name: 'empty_table',
        columns: [],
      },
    ])
  })
})
