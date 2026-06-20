import { assertApiJsonUuid, type BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import {
  getMokelayApiAssetStorage,
  type MokelayApiAssetStorage,
} from './listMokelayApiJsons'
import { parseMokelayPageJsonAsset } from './listMokelayPageJsons'

export async function readMokelayPageJson(uuid: unknown, storage?: MokelayApiAssetStorage) {
  const pageJsonUuid = assertApiJsonUuid(typeof uuid === 'string' ? uuid : undefined)
  const fileName = `${pageJsonUuid}.json`
  const assetStorage = storage ?? await getMokelayApiAssetStorage()
  let value: unknown

  try {
    value = await assetStorage.getItem(`mokelay-pages/${fileName}`)
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined

    if (code !== 'ENOENT') {
      throw error
    }
  }

  if (value === null || value === undefined) {
    throw mokelayError('API_JSON_NOT_FOUND', `页面 JSON 资产 ${fileName} 不存在。`, 404)
  }

  return parseMokelayPageJsonAsset(fileName, value)
}

export const executeReadMokelayPageJsonBlock: BlockExecutor = async ({ inputs }) => {
  return {
    page: await readMokelayPageJson(inputs.uuid),
  }
}
