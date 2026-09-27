import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { describe, expect, it } from 'vitest'
import type { GatewayConfig } from '../gateway-config.js'
import { conversationAuditQuerySchema, createDatabaseConversationAudits } from '../conversation-audit.js'
import { createPlatformDatabase } from '../platform-db.js'
import { registerGatewayRoutes } from './routes.js'
import type { GatewayUpstream } from './openai-compatible.js'

const config: GatewayConfig = {
  mode: 'relay',
  provider: 'openai_compatible',
  timeoutMs: 5_000,
  defaultStreaming: false,
  context: { enabled: false, maxInputChars: 4_000, maxMessages: 1 },
  upstreamConfigured: false,
}

describe('actual upstream model telemetry', () => {
  it('persists the upstream model selected by the gateway without exposing it in the client response', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    database.seedUser({ id: 'employee-1', username: 'employee@example.com', displayName: '测试员工', role: 'employee', roleLabel: '员工', password: 'test-password' })
    database.createApiKey({
      id: 'key-1', ownerUserId: 'employee-1', maskedValue: 'sk-aiops••••••test', secretValue: 'employee-platform-key',
      purpose: 'AI OPS', status: 'active',
    })
    const upstream: GatewayUpstream = {
      async listModels() { return [{ id: 'ai-ops', object: 'model', created: 0, owned_by: 'ai-ops-relay' }] },
      async chatCompletion(_request, _signal, context) {
        context?.onActualModel?.('gpt-4.1-2025-04-14')
        return { id: 'chat-1', object: 'chat.completion', created: 0, model: 'ai-ops', choices: [], usage: { prompt_tokens: 4, completion_tokens: 6 } }
      },
      async chatCompletionStream() {},
      async cancel() {},
    }
    const app = Fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    registerGatewayRoutes(app, config, { upstream, database, hasExternalModels: () => true })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer employee-platform-key' },
      payload: { model: 'ai-ops', messages: [{ role: 'user', content: 'hello' }] },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ model: 'ai-ops' })
    expect(database.listUsageRequests()).toHaveLength(1)
    expect(database.listUsageRequests()[0]?.actualModel).toBe('gpt-4.1-2025-04-14')
    expect(database.listConversationAuditRecords()).toEqual([
      expect.objectContaining({ modelId: 'ai-ops', actualModel: 'gpt-4.1-2025-04-14' }),
    ])
    expect(createDatabaseConversationAudits(database, conversationAuditQuerySchema.parse({})).items[0]?.model).toEqual({
      id: 'ai-ops', label: 'ai-ops', actualModel: 'gpt-4.1-2025-04-14',
    })

    await app.close()
    database.close()
  })

  it('does not create a conversation-audit row for an internal new-topic title request', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    database.seedUser({ id: 'employee-topic-title', username: 'topic-title@example.com', displayName: '标题测试员工', role: 'employee', roleLabel: '员工', password: 'test-password' })
    database.createApiKey({
      id: 'key-topic-title', ownerUserId: 'employee-topic-title', maskedValue: 'sk-aiops••••••topic', secretValue: 'topic-title-key',
      purpose: 'AI OPS', status: 'active',
    })
    const upstream: GatewayUpstream = {
      async listModels() { return [{ id: 'ai-ops', object: 'model', created: 0, owned_by: 'ai-ops-relay' }] },
      async chatCompletion() { return { id: 'chat-topic-title', object: 'chat.completion', created: 0, model: 'ai-ops', choices: [], usage: { prompt_tokens: 2, completion_tokens: 2 } } },
      async chatCompletionStream() {},
      async cancel() {},
    }
    const app = Fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    registerGatewayRoutes(app, config, { upstream, database, hasExternalModels: () => true })

    const titleResponse = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer topic-title-key' },
      payload: {
        model: 'ai-ops',
        messages: [{ role: 'user', content: '请生成新话题标题' }],
        isNewTopic: true,
        title: '新话题',
      },
    })
    expect(titleResponse.statusCode).toBe(200)
    expect(database.listConversationAuditRecords()).toEqual([])
    expect(database.listUsageRequests()).toHaveLength(1)

    const conversationResponse = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer topic-title-key' },
      payload: { model: 'ai-ops', messages: [{ role: 'user', content: '这是一条员工真实对话' }] },
    })
    expect(conversationResponse.statusCode).toBe(200)
    expect(database.listConversationAuditRecords()).toHaveLength(1)

    await app.close()
    database.close()
  })
})
