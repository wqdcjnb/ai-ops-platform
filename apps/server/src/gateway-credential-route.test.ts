import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from './app.js'
import { loadGatewayConfig } from './gateway-config.js'
import { createGatewayRuntime } from './gateway-runtime.js'

const apps: ReturnType<typeof buildApp>[] = []
const runtimeDirectories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of runtimeDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('in-app CPA configuration', () => {
  it('verifies only CPA before saving encrypted credentials', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ops-credential-route-'))
    runtimeDirectories.push(directory)
    const runtimeFile = join(directory, 'gateway-runtime.json')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      expect(String(input)).toBe('http://cpa.test/v1/models')
      return new Response(JSON.stringify({ data: [{ id: 'gpt-5-codex', object: 'model', created: 0, owned_by: 'cpa' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const app = buildApp({
      authMode: 'disabled',
      databasePath: ':memory:',
      gatewayConfig: loadGatewayConfig({ AI_OPS_GATEWAY_MODE: 'cpa', AI_OPS_GATEWAY_TIMEOUT_MS: '1000' }),
      gatewayRuntime: createGatewayRuntime(runtimeFile),
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/upstreams/cpa/configure',
      payload: { baseUrl: 'http://cpa.test/v1', apiKey: 'cpa-route-secret', managementBaseUrl: 'http://cpa.test', managementKey: 'cpa-management-secret' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ cpa: { status: 'healthy', modelCount: 1 }, managementConfigured: true })
    expect(readFileSync(runtimeFile, 'utf8')).not.toContain('cpa-route-secret')
    expect(readFileSync(runtimeFile, 'utf8')).not.toContain('cpa-management-secret')
    expect(JSON.stringify(response.json())).not.toContain('cpa-route-secret')
    expect(JSON.stringify(response.json())).not.toContain('cpa-management-secret')
  })

  it('accepts a CPA-generated auth file without requiring a CPA web login', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('http://cpa.test/v0/management/auth-files')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer cpa-management-secret')
      expect(init?.body).toBeInstanceOf(FormData)
      const uploaded = (init?.body as FormData).get('file')
      expect(uploaded).toBeInstanceOf(Blob)
      expect(await (uploaded as Blob).text()).toBe('{"access_token":"redacted-test-token"}')
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const app = buildApp({ authMode: 'disabled', databasePath: ':memory:' })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/upstreams/cpa/auth-files',
      payload: { fileName: 'codex-account.json', contentBase64: Buffer.from('{"access_token":"redacted-test-token"}').toString('base64'), managementBaseUrl: 'http://cpa.test', managementKey: 'cpa-management-secret' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok', fileName: 'codex-account.json' })
    expect(response.body).not.toContain('redacted-test-token')
  })

  it('converts Codex CLI auth.json and performs a CPA-scoped live verification', async () => {
    let uploadedName = ''
    let uploadedJson: Record<string, unknown> | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === 'http://cpa.test/v0/management/auth-files' && init?.method === 'POST') {
        const uploaded = (init.body as FormData).get('file') as Blob & { name?: string }
        uploadedName = uploaded.name ?? ''
        uploadedJson = JSON.parse(await uploaded.text()) as Record<string, unknown>
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'http://cpa.test/v0/management/auth-files') {
        return new Response(JSON.stringify({ files: [{ name: uploadedName, id: 'codex-auth-1', auth_index: 'auth-index-1', provider: 'codex', type: 'codex', status: 'active', disabled: false, unavailable: false }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'http://cpa.test/v0/management/api-call') {
        const body = JSON.parse(String(init?.body)) as { auth_index: string; url: string; header: Record<string, string> }
        expect(body.auth_index).toBe('auth-index-1')
        expect(body.url).toBe('https://chatgpt.com/backend-api/wham/usage')
        expect(body.header.Authorization).toBe('Bearer $TOKEN$')
        return new Response(JSON.stringify({ status_code: 200, body: JSON.stringify({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 1 } } }) }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected CPA request: ${url}`)
    })
    const app = buildApp({ authMode: 'disabled', databasePath: ':memory:' })
    apps.push(app)
    const codexCliAuth = {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        access_token: 'redacted-access-token',
        refresh_token: 'redacted-refresh-token',
        id_token: 'redacted-id-token',
        account_id: 'account-id-for-test',
      },
      last_refresh: '2026-09-20T10:00:00.000Z',
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/upstreams/cpa/auth-files',
      payload: { fileName: 'auth.json', contentBase64: Buffer.from(JSON.stringify(codexCliAuth)).toString('base64'), managementBaseUrl: 'http://cpa.test', managementKey: 'cpa-management-secret' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok', format: 'codex_cli', converted: true, verification: { status: 'verified', probe: 'codex_usage' } })
    expect(uploadedName).toMatch(/^codex-[a-f0-9]{20}\.json$/)
    expect(uploadedJson).toMatchObject({ type: 'codex', account_id: 'account-id-for-test', disabled: false })
    expect(uploadedJson).not.toHaveProperty('OPENAI_API_KEY')
    expect(response.body).not.toContain('redacted-access-token')
    expect(response.body).not.toContain('redacted-refresh-token')
  })

  it('rejects a Codex CLI API-key auth file instead of treating it as an OAuth account', async () => {
    const app = buildApp({ authMode: 'disabled', databasePath: ':memory:' })
    apps.push(app)
    const response = await app.inject({
      method: 'POST',
      url: '/api/upstreams/cpa/auth-files',
      payload: { fileName: 'auth.json', contentBase64: Buffer.from(JSON.stringify({ auth_mode: 'api_key', OPENAI_API_KEY: 'redacted-api-key' })).toString('base64'), managementBaseUrl: 'http://cpa.test', managementKey: 'cpa-management-secret' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'CPA_AUTH_FILE_UNSUPPORTED_FORMAT' } })
    expect(response.body).not.toContain('redacted-api-key')
  })

  it('keeps CPA auth-file details in sync while redacting credential values in the preview', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer cpa-management-secret')
      if (url === 'http://cpa.test/v0/management/auth-files/download?name=codex-account.json') {
        return new Response(JSON.stringify({ type: 'codex', access_token: 'secret-access-token', refresh_token: 'secret-refresh-token', id_token: 'secret-id-token', prefix: 'codex/', proxy_url: 'socks5://proxy.test:1080', priority: 10, quota: { signals: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'http://cpa.test/v0/management/auth-files') {
        return new Response(JSON.stringify({ files: [{ name: 'codex-account.json', provider: 'codex', success: 8, failed: 1, quota: { signals: { source: 'cpa' } }, recent_requests: [{ time: '18:40–18:50', success: 8, failed: 1 }] }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected CPA request: ${url}`)
    })
    const app = buildApp({ authMode: 'disabled', databasePath: ':memory:' })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/api/upstreams/cpa/auth-files/detail?name=codex-account.json' })

    expect(response.statusCode).toBe(200)
    const body = response.json() as { detail: { infoJson: string; jsonPreview: string; settings: { prefix: string; proxyUrl: string; priority: number | null } } }
    expect(body.detail.settings).toMatchObject({ prefix: 'codex/', proxyUrl: 'socks5://proxy.test:1080', priority: 10 })
    expect(body.detail.infoJson).toContain('18:40–18:50')
    expect(body.detail.infoJson).toContain('"source": "cpa"')
    expect(body.detail.jsonPreview).toContain('"access_token": "[REDACTED]"')
    expect(body.detail.jsonPreview).not.toContain('secret-access-token')
    expect(body.detail.jsonPreview).not.toContain('secret-refresh-token')
    expect(body.detail.jsonPreview).not.toContain('secret-id-token')
  })

  it('keeps the browser OAuth entry point on CPA management API', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('http://cpa.test/v0/management/codex-auth-url?is_webui=true')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer cpa-management-secret')
      return new Response(JSON.stringify({ status: 'ok', url: 'https://auth.test/authorize', state: 'oauth-state-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const app = buildApp({ authMode: 'disabled', databasePath: ':memory:' })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/upstreams/cpa/oauth-url',
      payload: { managementBaseUrl: 'http://cpa.test', managementKey: 'cpa-management-secret' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok', url: 'https://auth.test/authorize', state: 'oauth-state-1' })
  })

  it('uses server-side CPA management configuration when the browser sends no connection fields', async () => {
    vi.stubEnv('CPA_MANAGEMENT_URL', 'http://cpa-env.test/management.html')
    vi.stubEnv('CPA_MANAGEMENT_KEY', 'cpa-env-management-secret')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('http://cpa-env.test/v0/management/codex-auth-url?is_webui=true')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer cpa-env-management-secret')
      return new Response(JSON.stringify({ status: 'ok', url: 'https://auth.test/env-authorize', state: 'oauth-env-state' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const app = buildApp({ authMode: 'disabled', databasePath: ':memory:' })
    apps.push(app)

    const response = await app.inject({ method: 'POST', url: '/api/upstreams/cpa/oauth-url', payload: {} })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok', url: 'https://auth.test/env-authorize', state: 'oauth-env-state' })
  })
})
