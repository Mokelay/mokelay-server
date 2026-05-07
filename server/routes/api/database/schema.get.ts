import { defineEventHandler } from 'h3'
import { listDatabaseSchema } from '../../../utils/database-schema'

export default defineEventHandler(async () => {
  const tables = await listDatabaseSchema()

  return { tables }
})
