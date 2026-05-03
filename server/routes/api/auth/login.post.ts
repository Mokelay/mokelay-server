import { createError, defineEventHandler, readBody } from 'h3'
import { verifyPassword } from '../../../utils/password'
import { setUserSession } from '../../../utils/session'
import { findUserByEmail, toPublicUser } from '../../../utils/user-store'
import { formatValidationError, loginSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const parsed = loginSchema.safeParse(await readBody(event))

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: formatValidationError(parsed.error),
    })
  }

  const user = await findUserByEmail(parsed.data.email)

  if (!user || !(await verifyPassword(user.passwordHash, parsed.data.password))) {
    throw createError({
      statusCode: 401,
      message: '邮箱或密码不正确。',
    })
  }

  const publicUser = toPublicUser(user)

  setUserSession(event, {
    user: publicUser,
    loggedInAt: new Date().toISOString(),
  })

  return { user: publicUser }
})
