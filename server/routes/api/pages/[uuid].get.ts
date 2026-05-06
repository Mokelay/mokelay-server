import { createError, defineEventHandler, getRouterParam } from 'h3'
import { findPageByUuid, toPublicPage } from '../../../utils/page-store'
import { formatValidationError, pageUuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const parsedUuid = pageUuidSchema.safeParse(getRouterParam(event, 'uuid'))

  if (!parsedUuid.success) {
    throw createError({
      statusCode: 400,
      message: formatValidationError(parsedUuid.error),
    })
  }

  const page = await findPageByUuid(parsedUuid.data)

  if (!page) {
    throw createError({
      statusCode: 404,
      message: '页面不存在。',
    })
  }

  return {
    page: toPublicPage(page),
  }
})
