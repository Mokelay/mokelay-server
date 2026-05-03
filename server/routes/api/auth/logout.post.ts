import { defineEventHandler } from 'h3'
import { clearUserSession } from '../../../utils/session'

export default defineEventHandler((event) => {
  clearUserSession(event)
  return { ok: true }
})
