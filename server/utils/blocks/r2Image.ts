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

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "saveImageToR2",
 *   "displayName": "保存图片到 R2",
 *   "category": "storage",
 *   "description": "校验 multipart 上传图片并保存到 Cloudflare R2，返回公开 URL 或 data URL。",
 *   "inputs": [
 *     { "key": "image", "type": "UploadedImage", "required": true, "description": "multipart/form-data 上传图片，支持 JPEG、PNG、WebP、GIF。" },
 *     { "key": "directory", "type": "string", "required": false, "description": "R2 目录；默认使用 MOKELAY_IMAGES_R2_PREFIX 或 mokelay-images。" },
 *     { "key": "fileName", "type": "string", "required": false, "description": "期望文件名；未传时使用上传文件名。" },
 *     { "key": "maxSizeBytes", "type": "number|string", "required": false, "defaultValue": 10485760, "description": "最大图片字节数，默认 10MB。" }
 *   ],
 *   "outputs": [
 *     { "key": "key", "type": "string", "description": "R2 object key。" },
 *     { "key": "directory", "type": "string", "description": "保存目录。" },
 *     { "key": "fileName", "type": "string", "description": "最终文件名，包含唯一后缀。" },
 *     { "key": "bucket", "type": "string", "description": "R2 bucket。" },
 *     { "key": "size", "type": "number", "description": "图片字节数。" },
 *     { "key": "mimeType", "type": "string", "description": "图片 MIME 类型。" },
 *     { "key": "url", "type": "string", "description": "公开 URL；未配置公开域名时为 data URL。" },
 *     { "key": "dataUrl", "type": "string", "description": "图片 data URL。" },
 *     { "key": "etag", "type": "string|null", "description": "R2 返回的 ETag。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_R2_CONFIG_MISSING", "description": "Cloudflare R2 图片配置缺失。" },
 *     { "code": "BLOCK_AI_INPUT_INVALID", "description": "image 缺失、类型不支持或超过大小限制。" },
 *     { "code": "BLOCK_R2_DIRECTORY_INVALID", "description": "directory 不是合法 R2 目录。" },
 *     { "code": "BLOCK_R2_FILE_NAME_INVALID", "description": "fileName 不是合法 R2 文件名。" },
 *     { "code": "BLOCK_R2_SAVE_FAILED", "description": "上传到 R2 失败。" }
 *   ],
 *   "config": [
 *     { "key": "CLOUDFLARE_R2_ACCOUNT_ID", "type": "string", "required": false, "description": "R2 账号 ID；也可用 CLOUDFLARE_R2_ENDPOINT 替代 endpoint。" },
 *     { "key": "CLOUDFLARE_R2_ENDPOINT", "type": "string", "required": false, "description": "自定义 R2 endpoint。" },
 *     { "key": "CLOUDFLARE_R2_ACCESS_KEY_ID", "type": "string", "required": true, "description": "R2 access key id。" },
 *     { "key": "CLOUDFLARE_R2_SECRET_ACCESS_KEY", "type": "string", "required": true, "description": "R2 secret access key。" },
 *     { "key": "MOKELAY_IMAGES_R2_BUCKET", "type": "string", "required": false, "description": "图片 bucket；未配置时回退 MOKELAY_APIS_R2_BUCKET。" },
 *     { "key": "MOKELAY_IMAGES_PUBLIC_BASE_URL", "type": "string", "required": false, "description": "图片公开访问 base URL。" }
 *   ],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "sideEffect", "type": "string", "value": "r2-put-object", "description": "会向 Cloudflare R2 写入图片对象。" }
 *   ],
 *   "examples": [
 *     { "title": "上传图片", "block": { "uuid": "save_image_to_r2_block", "functionName": "saveImageToR2", "inputs": { "image": { "template": "{{request.body.image}}" }, "directory": "mokelay-images" }, "outputs": ["key", "directory", "fileName", "bucket", "size", "mimeType", "url", "dataUrl", "etag"], "nextBlock": null } }
 *   ]
 * }
 */
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

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "readImageFromR2",
 *   "displayName": "读取 R2 图片",
 *   "category": "storage",
 *   "description": "从 Cloudflare R2 读取图片对象，返回公开 URL 或 data URL。",
 *   "inputs": [
 *     { "key": "key", "type": "string", "required": false, "description": "完整 R2 object key；传入后优先使用。" },
 *     { "key": "directory", "type": "string", "required": false, "description": "R2 目录；未传 key 时与 fileName 组合。" },
 *     { "key": "fileName", "type": "string", "required": false, "description": "R2 文件名；未传 key 时必填。" }
 *   ],
 *   "outputs": [
 *     { "key": "key", "type": "string", "description": "R2 object key。" },
 *     { "key": "directory", "type": "string", "description": "对象目录。" },
 *     { "key": "fileName", "type": "string", "description": "对象文件名。" },
 *     { "key": "bucket", "type": "string", "description": "R2 bucket。" },
 *     { "key": "size", "type": "number", "description": "读取字节数。" },
 *     { "key": "mimeType", "type": "string", "description": "对象 MIME 类型。" },
 *     { "key": "url", "type": "string", "description": "公开 URL；未配置公开域名时为 data URL。" },
 *     { "key": "dataUrl", "type": "string", "description": "图片 data URL。" },
 *     { "key": "etag", "type": "string|null", "description": "R2 返回的 ETag。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_R2_CONFIG_MISSING", "description": "Cloudflare R2 图片配置缺失。" },
 *     { "code": "BLOCK_R2_DIRECTORY_INVALID", "description": "directory 不是合法 R2 目录。" },
 *     { "code": "BLOCK_R2_FILE_NAME_INVALID", "description": "fileName 不是合法 R2 文件名。" },
 *     { "code": "BLOCK_R2_SAVE_FAILED", "description": "从 R2 读取图片失败。" }
 *   ],
 *   "config": [
 *     { "key": "CLOUDFLARE_R2_ACCOUNT_ID", "type": "string", "required": false, "description": "R2 账号 ID；也可用 CLOUDFLARE_R2_ENDPOINT 替代 endpoint。" },
 *     { "key": "CLOUDFLARE_R2_ENDPOINT", "type": "string", "required": false, "description": "自定义 R2 endpoint。" },
 *     { "key": "CLOUDFLARE_R2_ACCESS_KEY_ID", "type": "string", "required": true, "description": "R2 access key id。" },
 *     { "key": "CLOUDFLARE_R2_SECRET_ACCESS_KEY", "type": "string", "required": true, "description": "R2 secret access key。" },
 *     { "key": "MOKELAY_IMAGES_R2_BUCKET", "type": "string", "required": false, "description": "图片 bucket；未配置时回退 MOKELAY_APIS_R2_BUCKET。" },
 *     { "key": "MOKELAY_IMAGES_PUBLIC_BASE_URL", "type": "string", "required": false, "description": "图片公开访问 base URL。" }
 *   ],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "network", "type": "string", "value": "Cloudflare R2 GetObject", "description": "会从 R2 读取对象内容。" }
 *   ],
 *   "examples": [
 *     { "title": "读取图片", "block": { "uuid": "read_image_from_r2_block", "functionName": "readImageFromR2", "inputs": { "key": { "template": "{{request.query.key}}" } }, "outputs": ["key", "directory", "fileName", "bucket", "size", "mimeType", "url", "dataUrl", "etag"], "nextBlock": null } }
 *   ]
 * }
 */
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
