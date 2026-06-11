import { assertApiJsonUuid, type BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import {
  getMokelayApiAssetStorage,
  parseMokelayApiJsonAsset,
  type MokelayApiAssetStorage,
} from './listMokelayApiJsons'

export async function readMokelayApiJson(uuid: unknown, storage?: MokelayApiAssetStorage) {
  const apiJsonUuid = assertApiJsonUuid(typeof uuid === 'string' ? uuid : undefined)
  const fileName = `${apiJsonUuid}.json`
  const assetStorage = storage ?? await getMokelayApiAssetStorage()
  let value: unknown

  try {
    value = await assetStorage.getItem(`mokelay-apis/${fileName}`)
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined

    if (code !== 'ENOENT') {
      throw error
    }
  }

  if (value === null || value === undefined) {
    throw mokelayError('API_JSON_NOT_FOUND', `API JSON 资产 ${fileName} 不存在。`, 404)
  }

  return parseMokelayApiJsonAsset(fileName, value)
}

export const executeReadMokelayApiJsonBlock: BlockExecutor = async ({ inputs }) => {
  return {
    api: await readMokelayApiJson(inputs.uuid),
  }
}
