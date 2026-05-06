import { createError, defineEventHandler, getHeader, readBody, readMultipartFormData, type H3Event } from 'h3'
import {
  AiDataSourceConfigError,
  AiDataSourceModelOutputError,
  AiDataSourceProviderError,
  AiDataSourceUnrecognizedError,
  analyzeDataSourceImage,
  analyzeDataSourceText,
  isSupportedImageMimeType,
  maxImageBytes,
  maxTextBytes,
} from '../../../utils/ai-data-source'

export default defineEventHandler(async (event) => {
  const contentType = (getHeader(event, 'content-type') || '').toLowerCase()

  if (contentType.startsWith('multipart/form-data')) {
    return await handleAnalyzeError(async () => await analyzeImageRequest(event))
  }

  if (contentType.startsWith('application/json')) {
    return await handleAnalyzeError(async () => await analyzeTextRequest(event))
  }

  throw createError({
    statusCode: 400,
    message: '请使用 multipart/form-data 上传图片，或使用 application/json 传入文本。',
  })
})

async function analyzeImageRequest(event: H3Event) {
  const formData = await readMultipartFormData(event)
  const image = formData?.find((item) => item.name === 'image' && item.filename)
  const text = formData?.find((item) => item.name === 'text' && item.data.byteLength)

  if (image && text) {
    throw createError({
      statusCode: 400,
      message: '图片和文本不能同时提交。',
    })
  }

  if (!image && text) {
    throw createError({
      statusCode: 400,
      message: '文本分析请使用 application/json 请求体。',
    })
  }

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

  return await analyzeDataSourceImage({
    data: image.data,
    mimeType,
  })
}

async function analyzeTextRequest(event: H3Event) {
  const body = await readBody<unknown>(event)

  if (!isPlainRecord(body) || typeof body.text !== 'string') {
    throw createError({
      statusCode: 400,
      message: '请传入 text 文本内容。',
    })
  }

  if ('image' in body && body.image !== undefined && body.image !== null) {
    throw createError({
      statusCode: 400,
      message: '图片和文本不能同时提交。',
    })
  }

  const text = body.text.trim()

  if (!text) {
    throw createError({
      statusCode: 400,
      message: 'text 文本不能为空。',
    })
  }

  if (Buffer.byteLength(text, 'utf8') > maxTextBytes) {
    throw createError({
      statusCode: 400,
      message: 'text 文本不能超过 100KB。',
    })
  }

  return await analyzeDataSourceText(text)
}

async function handleAnalyzeError(action: () => Promise<unknown>) {
  try {
    return await action()
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
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
