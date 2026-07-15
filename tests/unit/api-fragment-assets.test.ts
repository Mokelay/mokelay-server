import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listMokelayApiJsons } from '../../server/utils/blocks/listMokelayApiJsons'

const root = process.cwd()

async function text(path: string) {
  return await readFile(resolve(root, path), 'utf8')
}

async function json(path: string) {
  return JSON.parse(await text(path)) as Record<string, unknown>
}

describe('Fragment server assets and migrations', () => {
  it('persists fragment metadata without seeding built-in definitions into the user database', async () => {
    const [postgresMigration, mysqlMigration, postgresSchema, mysqlSchema, builtInFragment] = await Promise.all([
      text('server/database/migrations/0028_api_fragments.sql'),
      text('data/mysql_migrations/0028_api_fragments.sql'),
      text('data/postgres_schema.sql'),
      text('data/mysql_schema.sql'),
      json('server/assets/mokelay-apis/fragment/provision_new_user.json'),
    ])

    for (const source of [postgresMigration, mysqlMigration]) {
      expect(source).toContain('fragment')
      expect(source).not.toContain('provision_new_user')
      expect(source).not.toContain('api_builder_samples')
      expect(source).not.toContain('INSERT INTO')
    }
    expect(builtInFragment).toMatchObject({
      uuid: 'provision_new_user',
      fragment: true,
      params: ['enterprise_name', 'name', 'email', 'password_hash'],
      response: {
        user: expect.any(Object),
        free_datasource_uuid: expect.any(Object),
      },
    })
    expect(postgresSchema).toContain('fragment boolean DEFAULT false NOT NULL')
    expect(postgresSchema).toContain('idx_apis_fragment_status')
    expect(mysqlSchema).toContain('`fragment` tinyint(1) NOT NULL DEFAULT \'0\'')
    expect(mysqlSchema).toContain('`idx_apis_fragment_status`')
  })

  it('routes password and OAuth registration through executeFragment', async () => {
    const assets = await Promise.all([
      json('server/assets/mokelay-apis/register.json'),
      json('server/assets/mokelay-apis/oauth_google_callback.json'),
      json('server/assets/mokelay-apis/oauth_github_callback.json'),
    ])

    for (const asset of assets) {
      const blocks = asset.blocks as Array<Record<string, unknown>>
      const executeFragment = blocks.find(block => block.functionName === 'executeFragment')
      expect(executeFragment).toMatchObject({
        inputs: { fragmentUuid: 'provision_new_user' },
        outputs: ['result'],
      })
    }

    expect(await json('server/assets/mokelay-apis/fragment/provision_new_user.json')).toMatchObject({
      uuid: 'provision_new_user',
      fragment: true,
    })

    for (const oauth of assets.slice(1)) {
      const blocks = oauth.blocks as Array<Record<string, unknown>>
      expect(blocks.find(block => block.functionName === 'oauthCallback')).toMatchObject({
        inputs: { deferNewUserProvisioning: true },
      })
      expect(blocks.find(block => block.functionName === 'executeFragment')).toMatchObject({
        errorNextBlock: null,
      })
      const linkIdentity = blocks.find(block => block.functionName === 'linkOAuthIdentity')
      expect(linkIdentity).toMatchObject({ errorNextBlock: null })
      const sessionBlock = blocks.find(block => block.functionName === 'addSession')
      expect(sessionBlock).toMatchObject({
        errorNextBlock: expect.stringMatching(/_session_error_controller$/),
      })
      const sessionErrorController = blocks.find(block => block.uuid === sessionBlock?.errorNextBlock)
      const sessionErrorNode = (sessionErrorController?.nodes as Array<Record<string, unknown>> | undefined)?.[0]
      expect(sessionErrorNode).toMatchObject({ nextBlock: null })
      expect(oauth.responses).toMatchObject({
        [String(blocks.find(block => block.functionName === 'executeFragment')?.uuid)]: {
          redirect: {
            statusCode: 302,
            url: '/login?oauth_error=registration_failed',
          },
        },
        [String(linkIdentity?.uuid)]: {
          redirect: {
            statusCode: 302,
            url: '/login?oauth_error=identity_link_failed',
          },
        },
        [String(sessionErrorNode?.uuid)]: {
          redirect: {
            statusCode: 302,
            url: '/login?oauth_error=session_failed',
          },
        },
      })
    }
  })

  it('statically resolves every built-in caller against nested built-in Fragments', async () => {
    const [endpoints, fragments] = await Promise.all([
      listMokelayApiJsons(false),
      listMokelayApiJsons(true),
    ])

    expect(endpoints.apis).toEqual(expect.arrayContaining([
      expect.objectContaining({ uuid: 'register', method: 'POST' }),
      expect.objectContaining({ uuid: 'oauth_google_callback', method: 'GET' }),
      expect.objectContaining({ uuid: 'oauth_github_callback', method: 'GET' }),
    ]))
    expect(fragments).toEqual({
      apis: [expect.objectContaining({ uuid: 'provision_new_user', fragment: true })],
      count: 1,
    })
  })

  it('exposes fragment in API persistence and filtering assets', async () => {
    const [saveApi, readApi, listApis] = await Promise.all([
      json('server/assets/mokelay-apis/save_api.json'),
      json('server/assets/mokelay-apis/read_api_by_uuid.json'),
      json('server/assets/mokelay-apis/list_apis.json'),
    ])

    expect(JSON.stringify(saveApi)).toContain('validateApiDefinition')
    expect(JSON.stringify(saveApi)).toContain('fragment')
    const saveBlocks = saveApi.blocks as Array<Record<string, any>>
    const publishByKind = saveBlocks.find(block => block.uuid === 'publish_fragment_controller')
    expect(publishByKind?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: true,
        nextBlock: 'save_api_block',
      }),
      expect.objectContaining({
        value: false,
        nextBlock: 'publish_api_json_to_r2_block',
      }),
    ]))
    expect(JSON.stringify(readApi)).toContain('fragment')
    expect(JSON.stringify(listApis)).toContain('boolean_value')
    expect(JSON.stringify(listApis)).toContain('fragment')
  })

  it('defines a dedicated machine-checkable executeFragment JSON Schema', async () => {
    const schema = await json('server/assets/mokelay-schema/page-api-dsl.schema.json') as any
    expect(schema.$defs.api.oneOf).toEqual([
      { $ref: '#/$defs/endpointApi' },
      { $ref: '#/$defs/fragmentApi' },
    ])
    expect(schema.$defs.standardBlock.properties.functionName.not).toEqual({ const: 'executeFragment' })
    expect(schema.$defs.standardBlock.properties.errorNextBlock).toEqual({ $ref: '#/$defs/nextBlock' })
    expect(schema.$defs.executeFragmentBlock).toMatchObject({
      required: ['uuid', 'functionName', 'inputs', 'outputs', 'nextBlock'],
      properties: {
        functionName: { const: 'executeFragment' },
        inputs: {
          required: ['fragmentUuid', 'params'],
          properties: {
            fragmentUuid: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' },
            params: { type: 'object' },
          },
        },
        outputs: { const: ['result'] },
        errorNextBlock: { $ref: '#/$defs/nextBlock' },
      },
    })
  })
})
