import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3'
import { createPage, toPublicPage } from '../../../utils/page-store'
import { createPageSchema, formatValidationError } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const parsed = createPageSchema.safeParse(await readBody(event))

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: formatValidationError(parsed.error),
    })
  }

  const page = await createPage({
    name: parsed.data.name,
    blocks: parsed.data.blocks,
  })

  setResponseStatus(event, 201)

  return {
    page: toPublicPage(page),
  }
})
