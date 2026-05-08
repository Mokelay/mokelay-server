import { defineEventHandler, setResponseStatus } from 'h3'
import { mokelayError, toMokelayErrorResponse } from '../../../utils/mokelay-error'

export default defineEventHandler((event) => {
  setResponseStatus(event, 200)
  return toMokelayErrorResponse(mokelayError('API_JSON_UUID_INVALID', 'API_JSON_UUID 无效或不能为空。', 400))
})
