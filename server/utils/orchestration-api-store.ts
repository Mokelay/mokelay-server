import { readdir, readFile } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { and, desc, eq } from 'drizzle-orm'
import { orchestrationApis, orchestrationApiVersions, type OrchestrationApiRecord, type OrchestrationApiVersionRecord } from '../database/schema'
import { useDb } from './db'
import { mokelayError } from './mokelay-error'

const apiJsonUuidPattern = /^[A-Za-z0-9_-]{1,128}$/

export type OrchestrationApiSummary = {
  uuid: string
  alias: string
  method: string
  source: 'database' | 'asset'
  status: 'draft' | 'published' | 'asset'
  latestVersion: number | null
  createdAt?: string
  updatedAt?: string
  publishedAt?: string | null
}

export type OrchestrationApiDetail = OrchestrationApiSummary & {
  draftState: Record<string, unknown>
  draftJson: Record<string, unknown>
  publishedJson: Record<string, unknown> | null
  versions: OrchestrationApiVersionSummary[]
}

export type OrchestrationApiVersionSummary = {
  id: string
  version: number
  changeNote: string
  createdAt: string
}

export type SaveDraftInput = {
  uuid: string
  apiJson: Record<string, unknown>
  builderState?: Record<string, unknown>
}

export type PublishInput = SaveDraftInput & {
  changeNote?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function iso(value: Date | string | null | undefined) {
  if (!value) {
    return value === null ? null : undefined
  }

  return value instanceof Date ? value.toISOString() : value
}

export function assertOrchestrationApiUuid(value: string | undefined) {
  if (!value || !apiJsonUuidPattern.test(value)) {
    throw mokelayError('API_JSON_UUID_INVALID', 'API JSON UUID 无效或不能为空。', 400)
  }

  return value
}

export function getApiJsonMetadata(apiJson: Record<string, unknown>) {
  return {
    alias: typeof apiJson.alias === 'string' ? apiJson.alias : '',
    method: typeof apiJson.method === 'string' && apiJson.method.trim()
      ? apiJson.method.trim().toUpperCase()
      : 'GET',
  }
}

function bundledApiJsonDir() {
  return resolve(process.cwd(), 'server/assets/mokelay-apis')
}

function bundledApiJsonPath(uuid: string) {
  const apiJsonDir = bundledApiJsonDir()
  const filePath = resolve(apiJsonDir, `${assertOrchestrationApiUuid(uuid)}.json`)

  if (!filePath.startsWith(`${apiJsonDir}${sep}`)) {
    throw mokelayError('API_JSON_UUID_INVALID', 'API JSON UUID 无效。', 400)
  }

  return filePath
}

export async function readBundledApiJson(uuid: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(bundledApiJsonPath(uuid), 'utf8')
    const parsed = JSON.parse(raw) as unknown

    return asRecord(parsed)
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}

export async function listBundledApiSummaries() {
  let files: string[] = []

  try {
    files = await readdir(bundledApiJsonDir())
  } catch {
    return [] satisfies OrchestrationApiSummary[]
  }

  const summaries: OrchestrationApiSummary[] = []

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue
    }

    const uuid = basename(file, '.json')
    const apiJson = await readBundledApiJson(uuid)

    if (!apiJson) {
      continue
    }

    const metadata = getApiJsonMetadata(apiJson)
    summaries.push({
      uuid,
      alias: metadata.alias,
      method: metadata.method,
      source: 'asset',
      status: 'asset',
      latestVersion: null,
    })
  }

  return summaries.sort((a, b) => a.uuid.localeCompare(b.uuid))
}

function summarizeVersion(version: OrchestrationApiVersionRecord): OrchestrationApiVersionSummary {
  return {
    id: version.id,
    version: version.version,
    changeNote: version.changeNote,
    createdAt: iso(version.createdAt) || '',
  }
}

function summarizeStoredApi(
  api: OrchestrationApiRecord,
  latestVersion: OrchestrationApiVersionRecord | undefined,
): OrchestrationApiSummary {
  return {
    uuid: api.uuid,
    alias: api.alias,
    method: api.method,
    source: 'database',
    status: api.publishedVersionId ? 'published' : 'draft',
    latestVersion: latestVersion?.version ?? null,
    createdAt: iso(api.createdAt) ?? undefined,
    updatedAt: iso(api.updatedAt) ?? undefined,
    publishedAt: iso(api.publishedAt),
  }
}

async function selectStoredVersions(uuid: string) {
  return await useDb()
    .select()
    .from(orchestrationApiVersions)
    .where(eq(orchestrationApiVersions.apiUuid, uuid))
    .orderBy(desc(orchestrationApiVersions.version))
}

async function selectStoredApi(uuid: string) {
  const [api] = await useDb()
    .select()
    .from(orchestrationApis)
    .where(eq(orchestrationApis.uuid, uuid))
    .limit(1)

  return api
}

export async function listStoredApiSummaries(): Promise<OrchestrationApiSummary[]> {
  const apis = await useDb()
    .select()
    .from(orchestrationApis)
    .orderBy(desc(orchestrationApis.updatedAt))

  const summaries: OrchestrationApiSummary[] = []

  for (const api of apis) {
    const versions = await selectStoredVersions(api.uuid)
    summaries.push(summarizeStoredApi(api, versions[0]))
  }

  return summaries
}

export async function listApiSummaries(): Promise<OrchestrationApiSummary[]> {
  const bundled = await listBundledApiSummaries()
  let stored: OrchestrationApiSummary[] = []

  try {
    stored = await listStoredApiSummaries()
  } catch {
    stored = []
  }
  const byUuid = new Map<string, OrchestrationApiSummary>()

  bundled.forEach((summary) => byUuid.set(summary.uuid, summary))
  stored.forEach((summary) => byUuid.set(summary.uuid, summary))

  return Array.from(byUuid.values()).sort((a, b) => a.uuid.localeCompare(b.uuid))
}

export async function getApiDetail(uuidInput: string): Promise<OrchestrationApiDetail | undefined> {
  const uuid = assertOrchestrationApiUuid(uuidInput)
  let api: OrchestrationApiRecord | undefined

  try {
    api = await selectStoredApi(uuid)
  } catch {
    api = undefined
  }

  if (api) {
    const versions = await selectStoredVersions(uuid)
    const publishedVersion = api.publishedVersionId
      ? versions.find((version) => version.id === api.publishedVersionId)
      : undefined

    return {
      ...summarizeStoredApi(api, versions[0]),
      draftState: asRecord(api.draftState),
      draftJson: asRecord(api.draftJson),
      publishedJson: publishedVersion ? asRecord(publishedVersion.apiJson) : null,
      versions: versions.map(summarizeVersion),
    }
  }

  const bundled = await readBundledApiJson(uuid)

  if (!bundled) {
    return undefined
  }

  const metadata = getApiJsonMetadata(bundled)

  return {
    uuid,
    alias: metadata.alias,
    method: metadata.method,
    source: 'asset',
    status: 'asset',
    latestVersion: null,
    draftState: { apiJson: bundled },
    draftJson: bundled,
    publishedJson: bundled,
    versions: [],
  }
}

export async function saveApiDraft(input: SaveDraftInput) {
  const uuid = assertOrchestrationApiUuid(input.uuid)
  const metadata = getApiJsonMetadata(input.apiJson)
  const now = new Date()
  const builderState = input.builderState ?? { apiJson: input.apiJson }

  const [api] = await useDb()
    .insert(orchestrationApis)
    .values({
      uuid,
      alias: metadata.alias,
      method: metadata.method,
      draftState: builderState,
      draftJson: input.apiJson,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: orchestrationApis.uuid,
      set: {
        alias: metadata.alias,
        method: metadata.method,
        draftState: builderState,
        draftJson: input.apiJson,
        updatedAt: now,
      },
    })
    .returning()

  return api
}

export async function publishApiDraft(input: PublishInput) {
  const uuid = assertOrchestrationApiUuid(input.uuid)
  const api = await saveApiDraft(input)
  const versions = await selectStoredVersions(uuid)
  const nextVersion = (versions[0]?.version ?? 0) + 1
  const now = new Date()
  const builderState = input.builderState ?? { apiJson: input.apiJson }

  const [version] = await useDb()
    .insert(orchestrationApiVersions)
    .values({
      apiUuid: uuid,
      version: nextVersion,
      apiJson: input.apiJson,
      builderState,
      changeNote: input.changeNote ?? '',
    })
    .returning()

  await useDb()
    .update(orchestrationApis)
    .set({
      alias: api.alias,
      method: api.method,
      draftState: builderState,
      draftJson: input.apiJson,
      publishedVersionId: version.id,
      publishedAt: now,
      updatedAt: now,
    })
    .where(eq(orchestrationApis.uuid, uuid))

  return version
}

export async function rollbackApiVersion(uuidInput: string, versionInput: number) {
  const uuid = assertOrchestrationApiUuid(uuidInput)
  const [version] = await useDb()
    .select()
    .from(orchestrationApiVersions)
    .where(and(
      eq(orchestrationApiVersions.apiUuid, uuid),
      eq(orchestrationApiVersions.version, versionInput),
    ))
    .limit(1)

  if (!version) {
    throw mokelayError('API_MANAGEMENT_NOT_FOUND', 'API version not found.', 404)
  }

  const metadata = getApiJsonMetadata(asRecord(version.apiJson))
  const now = new Date()

  await useDb()
    .update(orchestrationApis)
    .set({
      alias: metadata.alias,
      method: metadata.method,
      draftState: asRecord(version.builderState),
      draftJson: asRecord(version.apiJson),
      publishedVersionId: version.id,
      publishedAt: now,
      updatedAt: now,
    })
    .where(eq(orchestrationApis.uuid, uuid))

  return version
}

export async function tryLoadPublishedApiJson(uuidInput: string) {
  const uuid = assertOrchestrationApiUuid(uuidInput)

  try {
    const api = await selectStoredApi(uuid)

    if (!api?.publishedVersionId) {
      return undefined
    }

    const [version] = await useDb()
      .select()
      .from(orchestrationApiVersions)
      .where(eq(orchestrationApiVersions.id, api.publishedVersionId))
      .limit(1)

    return version ? asRecord(version.apiJson) : undefined
  } catch {
    return undefined
  }
}
