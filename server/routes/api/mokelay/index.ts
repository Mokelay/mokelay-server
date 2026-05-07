import { createError, defineEventHandler } from 'h3'

export default defineEventHandler(() => {
  throw createError({
    statusCode: 400,
    message: 'API_JSON_UUID 无效或不能为空。',
  })
})
