import { describe, expect, it } from 'vitest'
import { loadGatewayConfig } from './gateway-config.js'

describe('relay gateway configuration', () => {
  it('always starts as an unconfigured managed relay gateway', () => {
    expect(loadGatewayConfig({})).toMatchObject({
      mode: 'relay',
      provider: 'openai_compatible',
      upstreamConfigured: false,
      timeoutMs: 60_000,
    })
  })

  it('allows transport and context tuning without accepting process-wide relay credentials', () => {
    expect(loadGatewayConfig({
      AI_OPS_GATEWAY_MODE: 'relay',
      AI_OPS_GATEWAY_DEFAULT_STREAMING: 'true',
      AI_OPS_GATEWAY_TIMEOUT_MS: '240000',
      AI_OPS_CONTEXT_OPTIMIZATION_ENABLED: 'false',
      AI_OPS_CONTEXT_MAX_INPUT_CHARS: '64000',
      AI_OPS_CONTEXT_MAX_MESSAGES: '48',
      AI_OPS_GATEWAY_UPSTREAM_BASE_URL: 'https://ignored.example/v1',
      AI_OPS_GATEWAY_UPSTREAM_API_KEY: 'ignored-secret',
    })).toMatchObject({
      mode: 'relay',
      upstreamConfigured: false,
      timeoutMs: 240_000,
      defaultStreaming: true,
      context: { enabled: false, maxInputChars: 64_000, maxMessages: 48 },
    })
  })

  it('rejects retired gateway modes and malformed active tuning values', () => {
    expect(() => loadGatewayConfig({ AI_OPS_GATEWAY_MODE: 'retired-mode' })).toThrow('仅支持 relay')
    expect(() => loadGatewayConfig({ AI_OPS_GATEWAY_TIMEOUT_MS: '999' })).toThrow('AI_OPS_GATEWAY configuration is invalid')
    expect(() => loadGatewayConfig({ AI_OPS_GATEWAY_DEFAULT_STREAMING: 'yes' })).toThrow('AI_OPS_GATEWAY configuration is invalid')
  })
})
