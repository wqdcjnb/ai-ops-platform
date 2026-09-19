import { describe, expect, it } from 'vitest'
import { loadGatewayConfig } from './gateway-config.js'

describe('gateway configuration', () => {
  it('defaults to an unconfigured standalone OpenAI-compatible mode', () => {
    expect(loadGatewayConfig({})).toMatchObject({
      mode: 'standalone',
      provider: 'openai_compatible',
      upstreamConfigured: false,
    })
  })

  it('reports a configured Ollama upstream without requiring an API key', () => {
    expect(loadGatewayConfig({
      AI_OPS_GATEWAY_MODE: 'standalone',
      AI_OPS_GATEWAY_PROVIDER: 'ollama',
      AI_OPS_GATEWAY_UPSTREAM_BASE_URL: 'http://127.0.0.1:11434/v1',
      AI_OPS_GATEWAY_DEFAULT_MODEL: 'qwen2.5:7b',
    })).toMatchObject({
      mode: 'standalone',
      provider: 'ollama',
      defaultModel: 'qwen2.5:7b',
      upstreamConfigured: true,
    })
  })

  it('keeps client credentials and aliases server-side', () => {
    expect(loadGatewayConfig({
      AI_OPS_GATEWAY_UPSTREAM_BASE_URL: 'http://127.0.0.1:9000/v1',
      AI_OPS_GATEWAY_UPSTREAM_API_KEY: 'upstream-secret',
      AI_OPS_GATEWAY_CLIENT_API_KEY: 'client-secret',
      AI_OPS_GATEWAY_MODEL_ALIASES: 'general=gpt-4o-mini,fast=gpt-4o-mini',
    })).toMatchObject({
      upstreamApiKey: 'upstream-secret',
      clientApiKey: 'client-secret',
      modelAliases: { general: 'gpt-4o-mini', fast: 'gpt-4o-mini' },
      upstreamConfigured: true,
    })
  })

  it('selects connector-specific upstream credentials without mixing connectors', () => {
    expect(loadGatewayConfig({
      AI_OPS_GATEWAY_MODE: 'new_api',
      AI_OPS_GATEWAY_NEW_API_BASE_URL: 'http://127.0.0.1:3000/v1',
      AI_OPS_GATEWAY_NEW_API_API_KEY: 'new-api-key',
    })).toMatchObject({ mode: 'new_api', baseUrl: 'http://127.0.0.1:3000/v1', upstreamApiKey: 'new-api-key', upstreamConfigured: true })
    expect(loadGatewayConfig({
      AI_OPS_GATEWAY_MODE: 'cpa',
      AI_OPS_GATEWAY_CPA_BASE_URL: 'http://127.0.0.1:8317/v1',
      AI_OPS_GATEWAY_CPA_API_KEY: 'cpa-key',
    })).toMatchObject({ mode: 'cpa', baseUrl: 'http://127.0.0.1:8317/v1', upstreamApiKey: 'cpa-key', upstreamConfigured: true })
    expect(loadGatewayConfig({
      AI_OPS_GATEWAY_MODE: 'new_api',
      AI_OPS_GATEWAY_UPSTREAM_BASE_URL: 'http://127.0.0.1:9000/v1',
      AI_OPS_GATEWAY_UPSTREAM_API_KEY: 'generic-key',
      AI_OPS_GATEWAY_NEW_API_BASE_URL: 'http://127.0.0.1:3000/v1',
      AI_OPS_GATEWAY_NEW_API_API_KEY: 'new-api-key',
    })).toMatchObject({ baseUrl: 'http://127.0.0.1:9000/v1', upstreamApiKey: 'generic-key' })
  })

  it('parses an opt-in fallback routing policy', () => {
    expect(loadGatewayConfig({
      AI_OPS_GATEWAY_DEFAULT_MODEL: 'primary-model',
      AI_OPS_GATEWAY_FALLBACK_MODEL: 'backup-model',
      AI_OPS_GATEWAY_ALLOW_FALLBACK: 'true',
    })).toMatchObject({
      defaultModel: 'primary-model',
      fallbackModel: 'backup-model',
      allowFallback: true,
    })
    expect(loadGatewayConfig({ AI_OPS_GATEWAY_ALLOW_FALLBACK: 'false' }).allowFallback).toBe(false)
  })

  it('rejects invalid modes and upstream URLs', () => {
    expect(() => loadGatewayConfig({ AI_OPS_GATEWAY_MODE: 'invalid' })).toThrow('AI_OPS_GATEWAY configuration is invalid')
    expect(() => loadGatewayConfig({ AI_OPS_GATEWAY_UPSTREAM_BASE_URL: 'not-a-url' })).toThrow('AI_OPS_GATEWAY configuration is invalid')
    expect(() => loadGatewayConfig({ AI_OPS_GATEWAY_ALLOW_FALLBACK: 'yes' })).toThrow('AI_OPS_GATEWAY configuration is invalid')
  })
})
