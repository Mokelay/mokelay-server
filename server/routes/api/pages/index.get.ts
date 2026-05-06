import { createError, defineEventHandler, getQuery } from 'h3'
import { listPages, toPublicPage } from '../../../utils/page-store'
import { formatValidationError, listPagesQuerySchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const parsedQuery = listPagesQuerySchema.safeParse(getQuery(event))

  if (!parsedQuery.success) {
    throw createError({
      statusCode: 400,
      message: formatValidationError(parsedQuery.error),
    })
  }

  const { page, pageSize } = parsedQuery.data
  const result = await listPages({ page, pageSize })
  const totalPages = Math.ceil(result.total / pageSize)

  return {
    pages: result.pages.map(toPublicPage),
    pagination: {
      page,
      pageSize,
      total: result.total,
      totalPages,
      hasPreviousPage: page > 1 && totalPages > 0,
      hasNextPage: page < totalPages,
    },
  }
})
