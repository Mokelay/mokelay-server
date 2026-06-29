import { assertApiJsonUuid, type BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import {
  getMokelayApiAssetStorage,
  type MokelayApiAssetStorage,
} from './listMokelayApiJsons'
import { parseMokelayLayoutJsonAsset } from './listMokelayLayoutJsons'

export async function readMokelayLayoutJson(uuid: unknown, storage?: MokelayApiAssetStorage) {
  const layoutJsonUuid = assertApiJsonUuid(typeof uuid === 'string' ? uuid : undefined)
  const fileName = `${layoutJsonUuid}.json`
  const assetStorage = storage ?? await getMokelayApiAssetStorage()
  let value: unknown

  try {
    value = await assetStorage.getItem(`mokelay-layouts/${fileName}`)
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined

    if (code !== 'ENOENT') {
      throw error
    }
  }

  if (value === null || value === undefined) {
    throw mokelayError('API_JSON_NOT_FOUND', `布局 JSON 资产 ${fileName} 不存在。`, 404)
  }

  return parseMokelayLayoutJsonAsset(fileName, value)
}

export const executeReadMokelayLayoutJsonBlock: BlockExecutor = async ({ inputs }) => {
  return {
    layout: await readMokelayLayoutJson(inputs.uuid),
  }
}
