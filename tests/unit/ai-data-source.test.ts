import { describe, expect, it } from 'vitest'
import {
  AiDataSourceModelOutputError,
  AiDataSourceUnrecognizedError,
  analyzeDataSourceText,
  imageBufferToDataUrl,
  normalizeAiDataSourceOutput,
} from '../../server/utils/ai-data-source'

describe('AI data source normalization', () => {
  it('parses JSON model output into rawData', () => {
    expect(normalizeAiDataSourceOutput({
      type: 'JSON',
      rawDataText: '{"name":"Mokelay","items":[{"id":1}]}',
    })).toEqual({
      type: 'JSON',
      rawData: {
        name: 'Mokelay',
        items: [{ id: 1 }],
      },
    })
  })

  it('parses JSON text locally without requiring OpenAI configuration', async () => {
    const originalApiKey = process.env.OPENAI_API_KEY

    delete process.env.OPENAI_API_KEY

    try {
      await expect(analyzeDataSourceText(' { "ok": true, "count": 2 } ')).resolves.toEqual({
        type: 'JSON',
        rawData: {
          ok: true,
          count: 2,
        },
      })
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = originalApiKey
      }
    }
  })

  it('normalizes API model output', () => {
    expect(normalizeAiDataSourceOutput({
      type: 'API',
      domain: 'https://api.mokelay.com/',
      path: 'api/me?debug=true',
      method: 'post',
      headerData: [
        { key: ' H1 ', mock: undefined },
        { key: '', mock: 'ignored' },
      ],
      bodyData: [
        { key: ' b1 ', dataType: 'string', mock: 'value' },
        { key: ' b2 ', dataType: 'number', mock: '' },
        { key: ' active ', dataType: 'bool' },
      ],
      queryData: [
        { key: ' q1 ', mock: null },
      ],
    })).toEqual({
      type: 'API',
      domain: 'https://api.mokelay.com',
      path: '/api/me',
      method: 'POST',
      headerData: [
        { key: 'H1', mock: '' },
      ],
      bodyData: [
        { key: 'b1', dataType: 'string', mock: 'value' },
        { key: 'b2', dataType: 'number', mock: 0 },
        { key: 'active', dataType: 'boolean', mock: false },
      ],
      queryData: [
        { key: 'q1', mock: '' },
      ],
    })
  })

  it('maps UNKNOWN output to an unrecognized error', () => {
    expect(() => normalizeAiDataSourceOutput({
      type: 'UNKNOWN',
    })).toThrow(AiDataSourceUnrecognizedError)
  })

  it('rejects invalid JSON raw data', () => {
    expect(() => normalizeAiDataSourceOutput({
      type: 'JSON',
      rawDataText: '{bad json',
    })).toThrow(AiDataSourceModelOutputError)
  })

  it('builds a data URL from image bytes', () => {
    expect(imageBufferToDataUrl(Buffer.from('image'), 'image/png')).toBe('data:image/png;base64,aW1hZ2U=')
  })
})
