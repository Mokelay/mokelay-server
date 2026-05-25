import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import 'dotenv/config'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultApiJsonDir = resolve(scriptDir, '../server/assets/mokelay-apis')
const defaultR2Prefix = 'mokelay-apis'

function normalizeEnvValue(value) {
  const normalizedValue = value?.trim()

  return normalizedValue || undefined
}

function normalizePrefix(value) {
  const prefix = (normalizeEnvValue(value) ?? defaultR2Prefix).replace(/^\/+|\/+$/g, '')

  return prefix || defaultR2Prefix
}

export function getR2SyncConfig(env = process.env) {
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

function requireR2SyncConfig(env) {
  const config = getR2SyncConfig(env)

  if (!config) {
    throw new Error(
      'Missing R2 configuration. Set CLOUDFLARE_R2_ACCOUNT_ID or CLOUDFLARE_R2_ENDPOINT, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, and MOKELAY_APIS_R2_BUCKET.',
    )
  }

  return config
}

function getApiJsonUuid(fileName) {
  return basename(fileName, '.json')
}

export function getApiJsonObjectKey(apiJsonUuid, prefix = defaultR2Prefix) {
  return `${normalizePrefix(prefix)}/${apiJsonUuid}.json`
}

function assertValidApiJson(fileName, value) {
  const uuid = getApiJsonUuid(fileName)

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${fileName} must contain a JSON object.`)
  }

  if (value.uuid !== uuid) {
    throw new Error(`${fileName} uuid must equal "${uuid}".`)
  }
}

export async function collectApiJsonObjects(apiJsonDir = defaultApiJsonDir, prefix = defaultR2Prefix) {
  const fileNames = (await readdir(apiJsonDir))
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
  const objects = []

  for (const fileName of fileNames) {
    const body = await readFile(resolve(apiJsonDir, fileName), 'utf8')

    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new Error(`${fileName} is not valid JSON.`)
    }

    assertValidApiJson(fileName, parsed)

    const uuid = getApiJsonUuid(fileName)

    objects.push({
      uuid,
      fileName,
      key: getApiJsonObjectKey(uuid, prefix),
      body,
    })
  }

  return objects
}

function createR2Client(config) {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export async function syncMokelayApisToR2({
  apiJsonDir = defaultApiJsonDir,
  env = process.env,
  client,
  log = console.log,
} = {}) {
  const config = requireR2SyncConfig(env)
  const r2Client = client ?? createR2Client(config)
  const objects = await collectApiJsonObjects(apiJsonDir, config.prefix)

  for (const object of objects) {
    await r2Client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: object.key,
      Body: object.body,
      ContentType: 'application/json',
    }))
    log?.(`Uploaded ${object.key}`)
  }

  return {
    count: objects.length,
    keys: objects.map((object) => object.key),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncMokelayApisToR2()
    .then(({ count }) => {
      console.log(`Uploaded ${count} Mokelay API JSON files to Cloudflare R2.`)
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
