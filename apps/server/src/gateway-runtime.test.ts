import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGatewayRuntime, normalizeGatewayUrl } from './gateway-runtime.js'
import { loadGatewayConfig } from './gateway-config.js'

const originalSecret = process.env.AI_OPS_KEY_ENCRYPTION_SECRET
const originalMode = process.env.AI_OPS_GATEWAY_MODE
const originalCpaBase = process.env.AI_OPS_GATEWAY_CPA_BASE_URL
const originalCpaKey = process.env.AI_OPS_GATEWAY_CPA_API_KEY
const originalNewApiKey = process.env.AI_OPS_GATEWAY_NEW_API_API_KEY

afterEach(() => {
  if (originalSecret === undefined) delete process.env.AI_OPS_KEY_ENCRYPTION_SECRET
  else process.env.AI_OPS_KEY_ENCRYPTION_SECRET = originalSecret
  if (originalMode === undefined) delete process.env.AI_OPS_GATEWAY_MODE
  else process.env.AI_OPS_GATEWAY_MODE = originalMode
  if (originalCpaBase === undefined) delete process.env.AI_OPS_GATEWAY_CPA_BASE_URL
  else process.env.AI_OPS_GATEWAY_CPA_BASE_URL = originalCpaBase
  if (originalCpaKey === undefined) delete process.env.AI_OPS_GATEWAY_CPA_API_KEY
  else process.env.AI_OPS_GATEWAY_CPA_API_KEY = originalCpaKey
  if (originalNewApiKey === undefined) delete process.env.AI_OPS_GATEWAY_NEW_API_API_KEY
  else process.env.AI_OPS_GATEWAY_NEW_API_API_KEY = originalNewApiKey
})

describe('gateway runtime credential store', () => {
  it('persists encrypted pipeline credentials and restores both environment values', () => {
    process.env.AI_OPS_KEY_ENCRYPTION_SECRET = 'runtime-test-secret'
    const directory = mkdtempSync(join(tmpdir(), 'ai-ops-gateway-'))
    const filePath = join(directory, 'gateway-runtime.json')
    try {
      const runtime = createGatewayRuntime(filePath)
      runtime.persist({ cpa: { baseUrl: 'http://127.0.0.1:8317/v1', apiKey: 'cpa-test-secret' }, newApi: { baseUrl: 'http://127.0.0.1:3000/v1', apiKey: 'new-api-test-secret' } })
      const stored = readFileSync(filePath, 'utf8')
      expect(stored).not.toContain('cpa-test-secret')

      const env: NodeJS.ProcessEnv = {}
      runtime.applyToEnvironment(env)
      expect(env.AI_OPS_GATEWAY_MODE).toBe('new_api')
      expect(env.AI_OPS_GATEWAY_CPA_BASE_URL).toBe('http://127.0.0.1:8317/v1')
      expect(env.AI_OPS_GATEWAY_CPA_API_KEY).toBe('cpa-test-secret')
      expect(env.AI_OPS_GATEWAY_NEW_API_BASE_URL).toBe('http://127.0.0.1:3000/v1')
      expect(env.AI_OPS_GATEWAY_NEW_API_API_KEY).toBe('new-api-test-secret')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('applies a verified connector to the live gateway config without exposing client credentials', () => {
    const runtime = createGatewayRuntime(join(tmpdir(), `ai-ops-runtime-${Date.now()}.json`))
    const config = loadGatewayConfig({ AI_OPS_GATEWAY_CLIENT_API_KEY: 'client-key' })
    runtime.applyInput({ cpa: { baseUrl: 'http://127.0.0.1:8317/v1', apiKey: 'cpa-key' }, newApi: { baseUrl: 'http://127.0.0.1:3000/v1', apiKey: 'new-api-key', managementBaseUrl: 'http://127.0.0.1:3000' } }, config)
    expect(config).toMatchObject({ mode: 'new_api', baseUrl: 'http://127.0.0.1:3000/v1', upstreamApiKey: 'new-api-key', upstreamConfigured: true })
    expect(process.env.AI_OPS_GATEWAY_MODE).toBe('new_api')
    expect(process.env.AI_OPS_GATEWAY_NEW_API_API_KEY).toBe('new-api-key')
    expect(process.env.AI_OPS_GATEWAY_CLIENT_API_KEY).not.toBe('new-api-key')
  })

  it('rejects non-http gateway addresses', () => {
    expect(() => normalizeGatewayUrl('file:///tmp/credentials')).toThrow('HTTP 或 HTTPS')
  })
})
