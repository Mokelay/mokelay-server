import { describe, expect, it } from 'vitest'
import {
  buildCanonicalPageGraph,
  extractPageReferences,
  pageNodeKey,
} from '../../server/utils/pageRelations'

const pageA = '11111111-1111-4111-8111-111111111111'
const pageB = '22222222-2222-4222-8222-222222222222'
const pageC = '33333333-3333-4333-8333-333333333333'

function user(uuid: string, blocks: unknown[] = []) {
  return { source: 'user' as const, uuid, blocks }
}

function tabs(...targets: Array<{ uuid: string; source?: 'user' | 'system' }>) {
  return [{
    type: 'MTabs',
    data: {
      tabs: targets.map(target => ({
        pageUUID: target.uuid,
        ...(target.source ? { pageSource: target.source } : {}),
      })),
    },
  }]
}

describe('page relation extraction', () => {
  it('extracts only direct embedded references, recursively and deterministically', () => {
    const references = extractPageReferences([{
      type: 'MTabs',
      data: { tabs: [{ pageUUID: pageB }] },
      events: {
        click: {
          action: 'jump_url',
          inputs: { url: `#/pages/${pageC}` },
          nextAction: {
            action: 'open_dialog',
            inputs: { pageUuid: 'system_child', pageSource: 'system' },
          },
        },
      },
    }])

    expect(references.map(({ uuid, source }) => ({ uuid, source }))).toEqual([
      { uuid: pageB, source: 'user' },
      { uuid: 'system_child', source: 'system' },
    ])
    expect(references[1].path).toContain('/nextAction/inputs/pageUuid')
  })

  it('rejects missing, dynamic and ambiguous embedded targets with their paths', () => {
    expect(() => extractPageReferences(tabs({ uuid: '' }))).toThrowError()
    expect(() => extractPageReferences([{
      action: 'open_dialog',
      inputs: { pageUUID: { template: '{{page}}' } },
    }])).toThrowError()
    expect(() => extractPageReferences([{
      action: 'open_dialog',
      inputs: { pageUUID: 'page}}' },
    }])).toThrowError()
    expect(() => extractPageReferences([{
      action: 'open_dialog',
      inputs: { pageUUID: pageB, pageUuid: pageC },
    }])).toThrowError()

    try {
      extractPageReferences([{
        action: 'open_dialog',
        inputs: { pageUUID: pageB, pageSource: 'remote' },
      }])
    } catch (error) {
      expect(error).toMatchObject({
        data: {
          code: 'BLOCK_PAGE_REFERENCE_SOURCE_INVALID',
          details: { value: 'remote' },
        },
      })
    }
  })

  it('supports the legacy pageUuid alias consistently for tabs and dialogs', () => {
    const references = extractPageReferences([{
      type: 'MTabs',
      data: { tabs: [{ pageUuid: ' legacy_system ', pageSource: 'system' }] },
    }, {
      action: 'open_dialog',
      inputs: { pageUuid: 'dialog_system', pageSource: 'system' },
    }])
    expect(references.map(reference => reference.uuid)).toEqual(['dialog_system', 'legacy_system'])
  })
})

describe('canonical page graph', () => {
  it('canonicalizes readable user page slugs across nodes and references', () => {
    const graph = buildCanonicalPageGraph([
      user(' Customer_Orders ', tabs({ uuid: ' ORDER_DETAIL ' })),
      user('Order_Detail'),
    ])

    expect(graph.get(pageNodeKey('user', 'customer_orders'))).toEqual({
      dependencies: ['order_detail'], quotes: [], subPage: false,
    })
    expect(graph.get(pageNodeKey('user', 'order_detail'))).toEqual({
      dependencies: [], quotes: ['customer_orders'], subPage: true,
    })
  })

  it.each([
    '',
    'customer.orders',
    'customer/orders',
    'customer orders',
    '客户页面',
    'a'.repeat(129),
  ])('rejects invalid user page slug %j', (uuid) => {
    expect(() => buildCanonicalPageGraph([user(uuid)]))
      .toThrowError()
  })

  it('derives direct dependencies, reverse quotes and subPage for reusable pages', () => {
    const graph = buildCanonicalPageGraph([
      user(pageA, tabs({ uuid: pageB })),
      user(pageB, tabs({ uuid: pageC })),
      user(pageC),
      user('44444444-4444-4444-8444-444444444444', tabs({ uuid: pageB })),
    ])

    expect(graph.get(pageNodeKey('user', pageA))).toEqual({
      dependencies: [pageB], quotes: [], subPage: false,
    })
    expect(graph.get(pageNodeKey('user', pageB))).toEqual({
      dependencies: [pageC],
      quotes: [pageA, '44444444-4444-4444-8444-444444444444'],
      subPage: true,
    })
    expect(graph.get(pageNodeKey('user', pageC))).toEqual({
      dependencies: [], quotes: [pageB], subPage: true,
    })
  })

  it('supports user-to-system references and merges their reverse edge', () => {
    const graph = buildCanonicalPageGraph([
      { source: 'system', uuid: 'system_parent', blocks: tabs({ uuid: 'system_child', source: 'system' }) },
      { source: 'system', uuid: 'system_child', blocks: [] },
      user(pageA, tabs({ uuid: 'system_child', source: 'system' })),
    ])

    expect(graph.get('system:system_child')).toEqual({
      dependencies: [],
      quotes: [pageA, 'system_parent'],
      subPage: true,
    })
  })

  it('rejects dangling, self, cyclic and cross-namespace-collision graphs', () => {
    expect(() => buildCanonicalPageGraph([user(pageA, tabs({ uuid: pageB }))]))
      .toThrowError()
    expect(() => buildCanonicalPageGraph([user(pageA, tabs({ uuid: pageA }))]))
      .toThrowError()

    try {
      buildCanonicalPageGraph([
        user(pageA, tabs({ uuid: pageB })),
        user(pageB, tabs({ uuid: pageA })),
      ])
    } catch (error) {
      expect(error).toMatchObject({
        data: {
          code: 'BLOCK_PAGE_REFERENCE_CYCLE',
          details: { cycle: [pageA, pageB, pageA] },
        },
      })
    }

    try {
      buildCanonicalPageGraph([
        user(' System_Page '),
        { source: 'system', uuid: 'system_page', blocks: [] },
      ])
      throw new Error('expected cross-source collision')
    }
    catch (error) {
      expect(error).toMatchObject({
        statusCode: 409,
        data: {
          code: 'BLOCK_DUPLICATE_RECORD',
          details: { uuid: 'system_page', conflictSource: 'system' },
        },
      })
    }
  })

  it('adds the owning page identity to graph-level extraction errors', () => {
    try {
      buildCanonicalPageGraph([user(pageA, [{
        action: 'open_dialog',
        inputs: { pageUUID: '{{dynamicUuid}}' },
      }])])
      throw new Error('expected graph validation to fail')
    }
    catch (error) {
      expect(error).toMatchObject({
        data: {
          code: 'BLOCK_PAGE_REFERENCE_DYNAMIC',
          details: {
            pageUuid: pageA,
            pageSource: 'user',
            path: '/blocks/0/inputs/pageUUID',
            value: '{{dynamicUuid}}',
          },
        },
      })
    }
  })
})
