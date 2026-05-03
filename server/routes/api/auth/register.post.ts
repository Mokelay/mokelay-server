import { createError, defineEventHandler, readBody } from 'h3'
import { hashPassword } from '../../../utils/password'
import { setUserSession } from '../../../utils/session'
import { createUser, findUserByEmail, toPublicUser } from '../../../utils/user-store'
import { formatValidationError, registerSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const parsed = registerSchema.safeParse(await readBody(event))

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: formatValidationError(parsed.error),
    })
  }

  const existingUser = await findUserByEmail(parsed.data.email)

  if (existingUser) {
    throw createError({
      statusCode: 409,
      message: '该邮箱已经注册，请直接登录。',
    })
  }

  const passwordHash = await hashPassword(parsed.data.password)

  try {
    const user = await createUser({
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
    })
    const publicUser = toPublicUser(user)

    setUserSession(event, {
      user: publicUser,
      loggedInAt: new Date().toISOString(),
    })

    return { user: publicUser }
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined

    if (code === '23505') {
      throw createError({
        statusCode: 409,
        message: '该邮箱已经注册，请直接登录。',
      })
    }

    throw error
  }
})
