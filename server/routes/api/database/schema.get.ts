import { defineEventHandler, getQuery } from 'h3'
import { listDatabaseSchema } from '../../../utils/database-schema'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const datasource = typeof query.datasource === 'string' ? query.datasource : undefined
  const tables = await listDatabaseSchema(datasource)

  return { tables }
})
