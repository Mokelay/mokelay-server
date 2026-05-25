import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

const defaultR2Prefix = 'mokelay-apis'

type R2ApiJsonConfig = {
  bucket: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  prefix: string
}

let cachedClient: { key: string, client: S3Client } | undefined

function normalizeEnvValue(value: string | undefined) {
  const normalizedValue = value?.trim()

  return normalizedValue || undefined
}

function normalizePrefix(value: string | undefined) {
  const prefix = (normalizeEnvValue(value) ?? defaultR2Prefix).replace(/^\/+|\/+$/g, '')

  return prefix || defaultR2Prefix
}

export function getR2ApiJsonConfig(env: NodeJS.ProcessEnv = process.env): R2ApiJsonConfig | undefined {
  const accountId = normalizeEnvValue(env.CLOUDFLARE_R2_ACCOUNT_ID)
  const endpoint = normalizeEnvValue(env.CLOUDFLARE_R2_ENDPOINT)
  const accessKeyId = normalizeEnvValue(env.CLOUDFLARE_R2_ACCESS_KEY_ID)
  const secretAccessKey = normalizeEnvValue(env.CLOUDFLARE_R2_SECRET_ACCESS_KEY)
  const bucket = normalizeEnvValue(env.MOKELAY_APIS_R2_BUCKET)

  if (!accessKeyId || !secretAccessKey || !bucket || (!accountId && !endpoint)) {
    return undefined
  }

  return {
    bucket,
    endpoint: endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId,
    secretAccessKey,
    prefix: normalizePrefix(env.MOKELAY_APIS_R2_PREFIX),
  }
}

export function getR2ApiJsonKey(apiJsonUuid: string, prefix: string) {
  return `${prefix}/${apiJsonUuid}.json`
}

function getR2Client(config: R2ApiJsonConfig) {
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

export async function loadApiJsonFromR2(apiJsonUuid: string) {
  const config = getR2ApiJsonConfig()

  if (!config) {
    return undefined
  }

  try {
    const response = await getR2Client(config).send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: getR2ApiJsonKey(apiJsonUuid, config.prefix),
    }))

    return await response.Body?.transformToString()
  } catch {
    return undefined
  }
}
