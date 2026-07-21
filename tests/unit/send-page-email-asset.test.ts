import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('send_page_email API asset', () => {
  it('loads and renders the requested page before sending it to the fixed recipient', async () => {
    const api = JSON.parse(await readFile(
      resolve(process.cwd(), 'server/assets/mokelay-apis/send_page_email.json'),
      'utf8',
    ))

    expect(api).toMatchObject({ uuid: 'send_page_email', method: 'GET' })
    expect(api.request.query).toEqual([
      { key: 'pageUUID', processors: ['trim', 'is_not_null'] },
    ])
    expect(api.blocks).toEqual(expect.arrayContaining([
      { uuid: 'starter', nextBlock: 'require_tenant_context' },
      expect.objectContaining({
        uuid: 'require_tenant_context',
        functionName: 'requireTenantContext',
        inputs: { datasource: 'Mokelay' },
        outputs: ['enterpriseUuid'],
        nextBlock: 'normalize_page_uuid_block',
      }),
      expect.objectContaining({
        uuid: 'normalize_page_uuid_block',
        functionName: 'normalizePageUuid',
        inputs: { uuid: { template: '{{request.query.pageUUID}}' } },
        outputs: ['uuid'],
        nextBlock: 'read_page_block',
      }),
      expect.objectContaining({
        uuid: 'read_page_block',
        functionName: 'read',
        inputs: expect.objectContaining({ datasource: 'Mokelay', table: 'pages' }),
        nextBlock: 'normalize_page_row_block',
      }),
      expect.objectContaining({
        uuid: 'normalize_page_row_block',
        functionName: 'normalizePageRows',
        nextBlock: 'render_page_block',
      }),
      expect.objectContaining({
        uuid: 'render_page_block',
        functionName: 'renderPage',
        inputs: {
          page: { template: "{{blocks['normalize_page_row_block'].outputs.page}}" },
        },
        outputs: ['html'],
        nextBlock: 'send_email_block',
      }),
      expect.objectContaining({
        uuid: 'send_email_block',
        functionName: 'sendEmail',
        inputs: {
          to: 'iamcarlchen@gmail.com',
          subject: { template: "{{blocks['normalize_page_row_block'].outputs.page.name}}" },
          html: { template: "{{blocks['render_page_block'].outputs.html}}" },
        },
        outputs: ['messageId', 'accepted', 'rejected'],
        nextBlock: null,
      }),
    ]))
    const readBlock = api.blocks.find((block: { uuid: string }) => block.uuid === 'read_page_block')
    expect(readBlock.inputs.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldName: 'enterprise_uuid',
        fieldValue: { template: "{{blocks['require_tenant_context'].outputs.enterpriseUuid}}" },
      }),
    ]))
    expect(api.responses.send_email_block).toEqual({
      messageId: { template: "{{blocks['send_email_block'].outputs.messageId}}" },
      accepted: { template: "{{blocks['send_email_block'].outputs.accepted}}" },
      rejected: { template: "{{blocks['send_email_block'].outputs.rejected}}" },
    })
  })
})
