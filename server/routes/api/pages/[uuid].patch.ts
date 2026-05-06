import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { toPublicPage, updatePageBlocks } from '../../../utils/page-store'
import { formatValidationError, pageUuidSchema, updatePageBlocksSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const parsedUuid = pageUuidSchema.safeParse(getRouterParam(event, 'uuid'))

  if (!parsedUuid.success) {
    throw createError({
      statusCode: 400,
      message: formatValidationError(parsedUuid.error),
    })
  }

  const parsedBody = updatePageBlocksSchema.safeParse(await readBody(event))

  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      message: formatValidationError(parsedBody.error),
    })
  }

  const page = await updatePageBlocks(parsedUuid.data, parsedBody.data.blocks)

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
