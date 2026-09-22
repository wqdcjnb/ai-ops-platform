import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { loadGatewayConfig } from '../gateway-config.js'
import { hashPlatformApiKey, PlatformDatabase } from '../platform-db.js'
import { GatewayUpstreamError, type GatewayUpstream, type OpenAiChatRequest, type OpenAiModel } from './openai-compatible.js'

const apps: ReturnType<typeof buildApp>[] = []
const databases: PlatformDatabase[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  databases.splice(0).forEach((database) => database.close())
})

describe('standalone gateway routes', () => {
  it('exposes safe health and config endpoints without a management session', async () => {
    const app = buildApp({
      databasePath: ':memory:',
      gatewayConfig: loadGatewayConfig({
        AI_OPS_GATEWAY_MODE: 'standalone',
        AI_OPS_GATEWAY_PROVIDER: 'openai_compatible',
        AI_OPS_GATEWAY_UPSTREAM_BASE_URL: 'http://127.0.0.1:9000/v1',
        AI_OPS_GATEWAY_UPSTREAM_API_KEY: 'server-only-secret',
        AI_OPS_GATEWAY_DEFAULT_MODEL: 'gateway-default',
      }),
    })
    apps.push(app)

    const health = await app.inject({ method: 'GET', url: '/gateway/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toMatchObject({
      status: 'ok', service: 'ai-ops-gateway', mode: 'standalone', provider: 'openai_compatible', upstreamConfigured: true,
      capabilities: { models: true, chatCompletions: true, responses: false, streaming: true },
    })
    expect(health.json().requestId).toBe(health.headers['x-request-id'])

    const config = await app.inject({ method: 'GET', url: '/gateway/config' })
    expect(config.statusCode).toBe(200)
    expect(config.json()).toMatchObject({ mode: 'standalone', upstream: { provider: 'openai_compatible', configured: true } })
    expect(JSON.stringify(config.json())).not.toContain('server-only-secret')
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(401)

    const upstreamHealth = await app.inject({ method: 'GET', url: '/gateway/upstream-health' })
    expect(upstreamHealth.statusCode).toBe(200)
    expect(upstreamHealth.json()).toMatchObject({ mode: 'standalone', status: 'offline', modelCount: 0 })
  })

  it('reports an unconfigured standalone gateway without pretending forwarding is available', async () => {
    const app = buildApp({ databasePath: ':memory:', gatewayConfig: loadGatewayConfig({ AI_OPS_GATEWAY_MODE: 'standalone' }) })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/gateway/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ mode: 'standalone', upstreamConfigured: false, capabilities: { chatCompletions: false } })
    expect((await app.inject({ method: 'GET', url: '/gateway/upstream-health' })).json()).toMatchObject({ status: 'unconfigured', modelCount: 0 })
  })

  it('exposes the active connector and does not relabel a New API route as standalone', async () => {
    const upstream: GatewayUpstream = {
      listModels: async () => [{ id: 'gpt-4o-mini', object: 'model', created: 1, owned_by: 'new-api' }],
      chatCompletion: async (request) => ({ id: 'chatcmpl-new-api', object: 'chat.completion', created: 1, model: request.model, choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
      chatCompletionStream: async () => undefined,
      cancel: async () => undefined,
    }
    const app = buildApp({
      databasePath: ':memory:',
      gatewayConfig: loadGatewayConfig({
        AI_OPS_GATEWAY_MODE: 'new_api',
        AI_OPS_GATEWAY_UPSTREAM_BASE_URL: 'http://127.0.0.1:3000/v1',
        AI_OPS_GATEWAY_UPSTREAM_API_KEY: 'new-api-user-key',
        AI_OPS_GATEWAY_CLIENT_API_KEY: 'client-secret',
      }),
      gatewayUpstream: upstream,
    })
    apps.push(app)

    const health = await app.inject({ method: 'GET', url: '/gateway/health' })
    expect(health.json()).toMatchObject({ connector: { id: 'new_api', label: 'New API 连接器', environment: 'production', configured: true }, capabilities: { streaming: true, responses: false } })
    const completion = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer client-secret', 'content-type': 'application/json' },
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hello' }] },
    })
    expect(completion.statusCode).toBe(200)
  })

  it('passes native Responses requests and streams through the CPA connector', async () => {
    const events = [
      { event: 'response.created', data: { id: 'resp-cpa', object: 'response' } },
      { event: 'response.output_text.delta', data: { delta: 'ok' } },
      { event: 'response.completed', data: { id: 'resp-cpa', status: 'completed' } },
    ]
    let received: Record<string, unknown> | undefined
    const upstream: GatewayUpstream = {
      listModels: async () => [{ id: 'gpt-5-codex', object: 'model', created: 1, owned_by: 'cpa' }],
      chatCompletion: async () => ({ id: 'chatcmpl-cpa', object: 'chat.completion', created: 1, model: 'gpt-5-codex', choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
      chatCompletionStream: async () => undefined,
      responses: async (request) => {
        received = request
        return { id: 'resp-cpa', object: 'response', model: request.model, status: 'completed', output: [{ type: 'message' }] }
      },
      responsesStream: async (_request, onEvent) => {
        for (const event of events) onEvent(event)
      },
      cancel: async () => undefined,
    }
    const app = buildApp({
      databasePath: ':memory:',
      gatewayConfig: loadGatewayConfig({
        AI_OPS_GATEWAY_MODE: 'cpa',
        AI_OPS_GATEWAY_CPA_BASE_URL: 'http://127.0.0.1:8317/v1',
        AI_OPS_GATEWAY_CPA_API_KEY: 'cpa-server-secret',
        AI_OPS_GATEWAY_CLIENT_API_KEY: 'client-secret',
      }),
      gatewayUpstream: upstream,
    })
    apps.push(app)

    const health = await app.inject({ method: 'GET', url: '/gateway/health' })
    expect(health.json()).toMatchObject({
      mode: 'cpa',
      connector: { label: 'CPA Codex OAuth', environment: 'production' },
      capabilities: { responses: true, streaming: true },
    })
    const upstreamHealth = await app.inject({ method: 'GET', url: '/gateway/upstream-health' })
    expect(upstreamHealth.json()).toMatchObject({ status: 'healthy', mode: 'cpa', modelCount: 1 })

    const payload = {
      model: 'gpt-5-codex',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
      tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
    }
    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: { authorization: 'Bearer client-secret', 'content-type': 'application/json' },
      payload,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: 'resp-cpa', object: 'response' })
    expect(received).toMatchObject({ model: 'gpt-5-codex', tools: payload.tools })

    const streamed = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: { authorization: 'Bearer client-secret', 'content-type': 'application/json' },
      payload: { ...payload, stream: true },
    })
    expect(streamed.statusCode).toBe(200)
    expect(streamed.headers['content-type']).toContain('text/event-stream')
    expect(streamed.body).toContain('event: response.created')
    expect(streamed.body).toContain('event: response.completed')
  })

  it('protects P02 endpoints with the temporary server-side client key and maps model aliases', async () => {
    const models: OpenAiModel[] = [{ id: 'gpt-4o-mini', object: 'model', created: 1, owned_by: 'test-upstream' }]
    let received: OpenAiChatRequest | undefined
    const upstream: GatewayUpstream = {
      listModels: async () => models,
      chatCompletion: async (request) => {
        received = request
        return { id: 'chatcmpl-test', object: 'chat.completion', created: 1, model: request.model, choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }
      },
      chatCompletionStream: async (request, onChunk) => {
        onChunk({ id: 'chatcmpl-stream', object: 'chat.completion.chunk', created: 1, model: request.model, choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] })
        onChunk({ id: 'chatcmpl-stream', object: 'chat.completion.chunk', created: 1, model: request.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      },
      cancel: async () => undefined,
    }
    const app = buildApp({
      databasePath: ':memory:',
      gatewayConfig: loadGatewayConfig({
        AI_OPS_GATEWAY_UPSTREAM_BASE_URL: 'http://127.0.0.1:9000/v1',
        AI_OPS_GATEWAY_UPSTREAM_API_KEY: 'server-only-secret',
        AI_OPS_GATEWAY_CLIENT_API_KEY: 'client-secret',
        AI_OPS_GATEWAY_MODEL_ALIASES: 'general=gpt-4o-mini',
      }),
      gatewayUpstream: upstream,
    })
    apps.push(app)

    expect((await app.inject({ method: 'GET', url: '/v1/models' })).statusCode).toBe(401)
    const listed = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: 'Bearer client-secret' } })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().data.map((model: { id: string }) => model.id)).toEqual(['gpt-4o-mini', 'general'])

    const completion = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer client-secret', 'content-type': 'application/json' },
      payload: { model: 'general', messages: [{ role: 'user', content: 'hello' }], stream: false },
    })
    expect(completion.statusCode).toBe(200)
    expect(received?.model).toBe('gpt-4o-mini')
    expect(JSON.stringify(completion.json())).not.toContain('server-only-secret')

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer client-secret', 'content-type': 'application/json' },
      payload: { model: 'general', messages: [], stream: false },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error).toMatchObject({ code: 'INVALID_REQUEST', requestId: invalid.headers['x-request-id'] })

    const streamed = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer client-secret', 'content-type': 'application/json' },
      payload: { model: 'general', messages: [{ role: 'user', content: 'hello' }], stream: true },
    })
    expect(streamed.statusCode).toBe(200)
    expect(streamed.headers['content-type']).toContain('text/event-stream')
    expect(streamed.body).toContain('data: [DONE]')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: { authorization: 'Bearer client-secret', 'content-type': 'application/json' },
      payload: { model: 'general', input: 'hello' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ object: 'response', output_text: 'ok', status: 'completed' })

    const unsupported = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: { authorization: 'Bearer client-secret', 'content-type': 'application/json' },
      payload: { model: 'general', input: 'hello', tools: [] },
    })
    expect(unsupported.statusCode).toBe(400)
    expect(unsupported.json()).toMatchObject({ error: { code: 'GATEWAY_UNSUPPORTED' } })
  })

  it('returns a stable error when the upstream is not configured', async () => {
    const app = buildApp({
      databasePath: ':memory:',
      gatewayConfig: loadGatewayConfig({ AI_OPS_GATEWAY_CLIENT_API_KEY: 'client-secret' }),
    })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: 'Bearer client-secret' } })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: { code: 'GATEWAY_UPSTREAM_NOT_CONFIGURED', requestId: response.headers['x-request-id'] } })
  })

  it('authenticates database keys, enforces model allowlists, and rejects revoked keys before upstream access', async () => {
    const database = new PlatformDatabase({ filename: ':memory:' })
    const secret = 'sk-ops-gateway-test-secret'
    databases.push(database)
    let calls = 0
    const upstream: GatewayUpstream = {
      listModels: async () => [{ id: 'gpt-4o-mini', object: 'model', created: 1, owned_by: 'test' }, { id: 'gpt-4o', object: 'model', created: 1, owned_by: 'test' }],
      chatCompletion: async (request) => {
        calls += 1
        return { id: 'chatcmpl-db-key', object: 'chat.completion', created: 1, model: request.model, choices: [{ message: { role: 'assistant', content: 'ok' } }] }
      },
      chatCompletionStream: async () => undefined,
      cancel: async () => undefined,
    }
    const app = buildApp({
      database,
      gatewayConfig: loadGatewayConfig({ AI_OPS_GATEWAY_UPSTREAM_BASE_URL: 'http://127.0.0.1:9000/v1', AI_OPS_GATEWAY_UPSTREAM_API_KEY: 'server-only-secret' }),
      gatewayUpstream: upstream,
    })
    database.createApiKey({
      id: 'key-gateway-test', ownerUserId: 'person-lin', maskedValue: 'sk-ops••••••CRET', secretHash: hashPlatformApiKey(secret),
      purpose: '网关测试', expiresAt: '2099-01-01T00:00:00.000Z', models: ['gpt-4o-mini'],
    })
    apps.push(app)

    const allowed = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x'.repeat(4_000) }] } })
    expect(allowed.statusCode).toBe(200)
    expect(database.listUsageRequests().some((item) => item.keyId === 'key-gateway-test' && item.status === 'succeeded')).toBe(true)
    expect(database.listAuditEvents().some((item) => item.resourceType === 'gateway_request' && item.result === 'success')).toBe(true)
    const deniedModel = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] } })
    expect(deniedModel.statusCode).toBe(403)
    expect(deniedModel.json()).toMatchObject({ error: { code: 'GATEWAY_MODEL_FORBIDDEN' } })
    expect(calls).toBe(1)

    const expiredSecret = 'sk-ops-gateway-expired'
    database.createApiKey({
      id: 'key-gateway-expired', ownerUserId: 'person-lin', maskedValue: 'sk-ops••••••PIRED', secretHash: hashPlatformApiKey(expiredSecret),
      purpose: '过期测试', expiresAt: '2020-01-01T00:00:00.000Z', models: ['gpt-4o-mini'],
    })
    const expired = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: `Bearer ${expiredSecret}` } })
    expect(expired.statusCode).toBe(401)

    database.disableApiKey('key-gateway-test', { id: 'audit-gateway-test-disable', actorUserId: 'user-super-admin', action: 'disable', resourceType: 'key', resourceId: 'key-gateway-test', result: 'success', requestId: 'req-gateway-test', summary: { message: 'test disable' } })
    const revoked = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: `Bearer ${secret}` } })
    expect(revoked.statusCode).toBe(401)
  })

  it('authenticates an external New API token, forwards it upstream, and captures the conversation locally', async () => {
    const database = new PlatformDatabase({ filename: ':memory:' })
    const externalSecret = 'sk-new-api-external-test-secret'
    databases.push(database)

    let forwardedAuthorization: string | undefined
    const upstream: GatewayUpstream = {
      listModels: async () => [{ id: 'gpt-5.6-terra', object: 'model', created: 1, owned_by: 'new-api' }],
      chatCompletion: async (request, _signal, context) => {
        forwardedAuthorization = context?.authorization
        return {
          id: 'chatcmpl-external-key',
          object: 'chat.completion',
          created: 1,
          model: request.model,
          choices: [{ index: 0, message: { role: 'assistant', content: 'captured' }, finish_reason: 'stop' }],
        }
      },
      chatCompletionStream: async () => undefined,
      cancel: async () => undefined,
    }
    const app = buildApp({
      database,
      gatewayConfig: loadGatewayConfig({
        AI_OPS_GATEWAY_MODE: 'new_api',
        AI_OPS_GATEWAY_UPSTREAM_BASE_URL: 'http://127.0.0.1:3000/v1',
        AI_OPS_GATEWAY_UPSTREAM_API_KEY: 'server-only-secret',
      }),
      gatewayUpstream: upstream,
      resolveExternalClientKey: async (secret) => secret === externalSecret ? {
        id: 'key-external-gateway-test',
        ownerUserId: 'person-lin',
        ownerName: '林内容',
        departmentName: '内容部',
        maskedValue: 'sk-ops••••••CRET',
        externalTokenId: 'new-api-token-test',
        purpose: 'WorkBuddy 对话',
        model: 'gpt-5.6-terra',
        models: ['gpt-5.6-terra'],
        status: 'active',
        expiresAt: '2099-01-01T00:00:00.000Z',
      } : null,
    })
    apps.push(app)
    database.createApiKey({
      id: 'key-external-gateway-test',
      ownerUserId: 'person-lin',
      maskedValue: 'sk-ops••••••CRET',
      purpose: 'WorkBuddy 对话',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00.000Z',
      model: 'gpt-5.6-terra',
      models: ['gpt-5.6-terra'],
      externalTokenId: 'new-api-token-test',
      quotaMode: 'unlimited',
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${externalSecret}`, 'user-agent': 'WorkBuddy/1.0', 'content-type': 'application/json' },
      payload: { model: 'gpt-5.6-terra', messages: [{ role: 'user', content: '请记录这次对话' }] },
    })

    expect(response.statusCode).toBe(200)
    expect(forwardedAuthorization).toBe(`Bearer ${externalSecret}`)
    const record = database.listConversationAuditRecords()[0]
    expect(record).toBeDefined()
    expect(record).toMatchObject({
      keyId: 'key-external-gateway-test',
      externalTokenId: 'new-api-token-test',
      auditStatus: 'succeeded',
      state: 'captured',
      contentAccessAvailable: 1,
    })
    expect(database.getConversationAuditContent(record!.id)).toMatchObject({ promptAvailable: true, responseAvailable: true })
    expect(database.listUsageRequests()).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyId: 'key-external-gateway-test', status: 'succeeded', clientName: 'WorkBuddy' }),
    ]))
  })

  it('uses an explicitly enabled fallback model only for retryable upstream failures', async () => {
    const attempts: string[] = []
    const upstream: GatewayUpstream = {
      listModels: async () => [],
      chatCompletion: async (request) => {
        attempts.push(request.model)
        if (request.model === 'primary-model') throw new GatewayUpstreamError('GATEWAY_UPSTREAM_TIMEOUT', 504, 'timeout')
        return { id: 'chatcmpl-fallback', object: 'chat.completion', created: 1, model: request.model, choices: [{ message: { role: 'assistant', content: 'fallback ok' } }] }
      },
      chatCompletionStream: async () => undefined,
      cancel: async () => undefined,
    }
    const app = buildApp({
      databasePath: ':memory:',
      gatewayConfig: loadGatewayConfig({
        AI_OPS_GATEWAY_UPSTREAM_BASE_URL: 'http://127.0.0.1:9000/v1',
        AI_OPS_GATEWAY_UPSTREAM_API_KEY: 'server-only-secret',
        AI_OPS_GATEWAY_CLIENT_API_KEY: 'client-secret',
        AI_OPS_GATEWAY_DEFAULT_MODEL: 'primary-model',
        AI_OPS_GATEWAY_FALLBACK_MODEL: 'backup-model',
        AI_OPS_GATEWAY_ALLOW_FALLBACK: 'true',
      }),
      gatewayUpstream: upstream,
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer client-secret', 'content-type': 'application/json' },
      payload: { model: 'primary-model', messages: [{ role: 'user', content: 'hello' }] },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ model: 'backup-model' })
    expect(attempts).toEqual(['primary-model', 'backup-model'])
  })
})
