import { defineEventHandler } from 'h3'
import { listDatabaseSchema } from 'mokelay-server-core/utils/database-schema'

export default defineEventHandler(async () => {
  const tables = await listDatabaseSchema()

  return { tables }
})
