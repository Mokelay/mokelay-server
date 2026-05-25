import { type BlockExecutor } from '../orchestration-schema'
import { mokelayError } from '../mokelay-error'
import { setSessionValue } from '../session'
import { getSessionKey } from './shared'

/**
 * addSession block
 * 作用：把指定 key/value 写入编排 session cookie。
 * inputs：key 非空字符串；value 必须显式提供，可为任意 JSON 可序列化值。
 * outputs：无业务输出。
 */
export const executeAddSessionBlock: BlockExecutor = async ({ event, inputs }) => {
  const key = getSessionKey(inputs.key)

  if (!Object.prototype.hasOwnProperty.call(inputs, 'value')) {
    throw mokelayError('BLOCK_SESSION_VALUE_MISSING', 'value 不能为空。', 400)
  }

  setSessionValue(event, key, inputs.value)

  return {}
}
