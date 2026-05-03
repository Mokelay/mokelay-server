import { defineEventHandler } from 'h3'
import { getUserSession } from '../../utils/session'

export default defineEventHandler((event) => {
  const session = getUserSession(event)

  return {
    loggedIn: Boolean(session.user),
    user: session.user || null,
  }
})
