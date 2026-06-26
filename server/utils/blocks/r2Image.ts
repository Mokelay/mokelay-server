import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mokelayError } from 'mokelay-server-core/utils/mokelay-error'
import type { BlockExecutor } from 'mokelay-server-core/utils/orchestration-schema'
import {
  isRecord,
  normalizeR2Directory,
  normalizeR2FileName,
} from 'mokelay-server-core/utils/blocks/shared'

const defaultImagePrefix = 'mokelay-images'
const defaultMaxImageBytes = 10 * 1024 * 1024
const supportedImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

type R2ImageConfig = {
  bucket: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  prefix: string
  publicBaseUrl?: string
}

type UploadedImage = {
  data: Buffer
  mimeType: string
  fileName: string
  size: number
}

let cachedClient: { key: string, client: S3Client } | undefined

function normalizeEnvValue(value: string | undefined) {
  const normalizedValue = value?.trim()
  return normalizedValue || undefined
}

function normalizeR2Prefix(value: string | undefined) {
  const prefix = (normalizeEnvValue(value) ?? defaultImagePrefix).replace(/^\/+|\/+$/g, '')
  return prefix || defaultImagePrefix
}

function getR2ImageConfig(env: NodeJS.ProcessEnv = process.env): R2ImageConfig | undefined {
  const accountId = normalizeEnvValue(env.CLOUDFLARE_R2_ACCOUNT_ID)
  const endpoint = normalizeEnvValue(env.CLOUDFLARE_R2_ENDPOINT)
  const accessKeyId = normalizeEnvValue(env.CLOUDFLARE_R2_ACCESS_KEY_ID)
  const secretAccessKey = normalizeEnvValue(env.CLOUDFLARE_R2_SECRET_ACCESS_KEY)
  const bucket = normalizeEnvValue(env.MOKELAY_IMAGES_R2_BUCKET) ?? normalizeEnvValue(env.MOKELAY_APIS_R2_BUCKET)
  const publicBaseUrl = normalizeEnvValue(env.MOKELAY_IMAGES_PUBLIC_BASE_URL)?.replace(/\/+$/g, '')

  if (!accessKeyId || !secretAccessKey || !bucket || (!accountId && !endpoint)) {
    return undefined
  }

  return {
    bucket,
    endpoint: endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId,
    secretAccessKey,
    prefix: normalizeR2Prefix(env.MOKELAY_IMAGES_R2_PREFIX),
    ...(publicBaseUrl ? { publicBaseUrl } : {}),
  }
}

function getR2Client(config: R2ImageConfig) {
  const key = `${config.endpoint}\n${config.accessKeyId}\n${config.secretAccessKey}`

  if (cachedClient?.key === key) {
    return cachedClient.client
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })

  cachedClient = { key, client }
  return client
}

function normalizeUploadedImage(value: unknown, maxSizeBytes: number): UploadedImage {
  if (!isRecord(value)) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', 'image 必须通过 multipart/form-data 上传。', 400)
  }

  const data = value.data
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType : ''
  const fileName = typeof value.fileName === 'string' ? value.fileName : ''
  const size = typeof value.size === 'number' ? value.size : Buffer.isBuffer(data) ? data.byteLength : 0

  if (!Buffer.isBuffer(data) || data.byteLength === 0) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', '请上传 image 图片文件。', 400)
  }

  if (!supportedImageMimeTypes.has(mimeType)) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', '仅支持 JPEG、PNG、WebP 或 GIF 图片。', 400)
  }

  if (data.byteLength > maxSizeBytes) {
    throw mokelayError('BLOCK_AI_INPUT_INVALID', `图片大小不能超过 ${Math.floor(maxSizeBytes / 1024 / 1024)}MB。`, 400)
  }

  return {
    data,
    mimeType,
    fileName,
    size,
  }
}

function mimeExtension(mimeType: string) {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  return ''
}

function sanitizeFileName(value: string, mimeType: string) {
  const baseName = value.trim().split(/[\\/]/).pop() || `image${mimeExtension(mimeType)}`
  const sanitized = baseName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  const withExtension = /\.[A-Za-z0-9]+$/.test(sanitized)
    ? sanitized
    : `${sanitized || 'image'}${mimeExtension(mimeType)}`

  return normalizeR2FileName(withExtension)
}

function uniqueFileName(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  if (dotIndex <= 0) {
    return normalizeR2FileName(`${suffix}-${fileName}`)
  }

  return normalizeR2FileName(`${fileName.slice(0, dotIndex)}-${suffix}${fileName.slice(dotIndex)}`)
}

function toPublicUrl(config: R2ImageConfig, key: string) {
  return config.publicBaseUrl ? `${config.publicBaseUrl}/${encodeURI(key)}` : ''
}

function toDataUrl(data: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${data.toString('base64')}`
}

function normalizePositiveInteger(value: unknown, fallback: number) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : fallback

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const executeSaveImageToR2Block: BlockExecutor = async ({ inputs }) => {
  const config = getR2ImageConfig()

  if (!config) {
    throw mokelayError('BLOCK_R2_CONFIG_MISSING', 'Cloudflare R2 图片配置缺失。', 500)
  }

  const directory = normalizeR2Directory(inputs.directory ?? config.prefix)
  const maxSizeBytes = normalizePositiveInteger(inputs.maxSizeBytes, defaultMaxImageBytes)
  const image = normalizeUploadedImage(inputs.image, maxSizeBytes)
  const requestedFileName = typeof inputs.fileName === 'string' && inputs.fileName.trim()
    ? inputs.fileName
    : image.fileName
  const fileName = uniqueFileName(sanitizeFileName(requestedFileName, image.mimeType))
  const key = `${directory}/${fileName}`

  try {
    const result = await getR2Client(config).send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: image.data,
      ContentType: image.mimeType,
    }))
    const publicUrl = toPublicUrl(config, key)
    const dataUrl = toDataUrl(image.data, image.mimeType)

    return {
      key,
      directory,
      fileName,
      bucket: config.bucket,
      size: image.size,
      mimeType: image.mimeType,
      url: publicUrl || dataUrl,
      dataUrl,
      etag: result.ETag ?? null,
    }
  } catch (error) {
    throw mokelayError('BLOCK_R2_SAVE_FAILED', '保存图片到 Cloudflare R2 失败。', 500, error)
  }
}

export const executeReadImageFromR2Block: BlockExecutor = async ({ inputs }) => {
  const config = getR2ImageConfig()

  if (!config) {
    throw mokelayError('BLOCK_R2_CONFIG_MISSING', 'Cloudflare R2 图片配置缺失。', 500)
  }

  const key = typeof inputs.key === 'string' && inputs.key.trim()
    ? inputs.key.trim().replace(/^\/+/, '')
    : `${normalizeR2Directory(inputs.directory ?? config.prefix)}/${normalizeR2FileName(inputs.fileName)}`

  try {
    const response = await getR2Client(config).send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }))
    const body = await response.Body?.transformToByteArray()
    const data = Buffer.from(body ?? [])
    const mimeType = response.ContentType || 'application/octet-stream'
    const fileName = key.split('/').pop() || 'image'
    const dataUrl = toDataUrl(data, mimeType)
    const publicUrl = toPublicUrl(config, key)

    return {
      key,
      directory: key.split('/').slice(0, -1).join('/'),
      fileName,
      bucket: config.bucket,
      size: data.byteLength,
      mimeType,
      url: publicUrl || dataUrl,
      dataUrl,
      etag: response.ETag ?? null,
    }
  } catch (error) {
    throw mokelayError('BLOCK_R2_SAVE_FAILED', '从 Cloudflare R2 读取图片失败。', 500, error)
  }
}
