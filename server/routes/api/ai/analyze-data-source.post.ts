import { createError, defineEventHandler, getHeader, readMultipartFormData } from 'h3'
import {
  AiDataSourceConfigError,
  AiDataSourceModelOutputError,
  AiDataSourceProviderError,
  AiDataSourceUnrecognizedError,
  analyzeDataSourceImage,
  isSupportedImageMimeType,
  maxImageBytes,
} from '../../../utils/ai-data-source'

export default defineEventHandler(async (event) => {
  const contentType = getHeader(event, 'content-type') || ''

  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw createError({
      statusCode: 400,
      message: '请使用 multipart/form-data 上传图片。',
    })
  }

  const formData = await readMultipartFormData(event)
  const image = formData?.find((item) => item.name === 'image' && item.filename)

  if (!image?.data?.byteLength) {
    throw createError({
      statusCode: 400,
      message: '请上传 image 图片文件。',
    })
  }

  const mimeType = image.type || ''

  if (!isSupportedImageMimeType(mimeType)) {
    throw createError({
      statusCode: 400,
      message: '仅支持 JPEG、PNG 或 WebP 图片。',
    })
  }

  if (image.data.byteLength > maxImageBytes) {
    throw createError({
      statusCode: 400,
      message: '图片大小不能超过 10MB。',
    })
  }

  try {
    return await analyzeDataSourceImage({
      data: image.data,
      mimeType,
    })
  } catch (error) {
    if (error instanceof AiDataSourceUnrecognizedError) {
      throw createError({
        statusCode: 422,
        message: error.message,
      })
    }

    if (error instanceof AiDataSourceConfigError) {
      throw createError({
        statusCode: 500,
        message: error.message,
      })
    }

    if (error instanceof AiDataSourceProviderError || error instanceof AiDataSourceModelOutputError) {
      throw createError({
        statusCode: 502,
        message: error.message,
      })
    }

    throw error
  }
})
