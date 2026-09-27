import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { describe, expect, it, vi } from 'vitest'
import type { GatewayConfig } from '../gateway-config.js'
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

describe('relay media gateway routes', () => {
  it('uses the one public model for image, video, and speech paths', async () => {
    const database = createPlatformDatabase({ filename: ':memory:' })
    database.seedUser({ id: 'employee-1', username: 'employee@example.com', displayName: '测试员工', role: 'employee', roleLabel: '员工', password: 'test-password' })
    database.createApiKey({
      id: 'key-1', ownerUserId: 'employee-1', maskedValue: 'sk-aiops••••••test', secretValue: 'employee-platform-key',
      purpose: 'AI OPS', status: 'active',
    })
    const media = vi.fn(async (_path: string, body: Record<string, unknown>) => ({ id: 'job-1', model: body.model, status: 'queued' }))
    const upstream: GatewayUpstream = {
      async listModels() { return [{ id: 'ai-ops', object: 'model', created: 0, owned_by: 'ai-ops-relay' }] },
      async chatCompletion() { return { id: 'chat-1', object: 'chat.completion', created: 0, model: 'ai-ops', choices: [] } },
      async chatCompletionStream() {},
      media,
      async cancel() {},
    }
    const app = Fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    registerGatewayRoutes(app, config, { upstream, database, hasExternalModels: () => true })

    for (const [url, payload] of [
      ['/v1/images/generations', { prompt: 'a poster' }],
      ['/v1/videos', { prompt: 'a short clip' }],
      ['/v1/audio/speech', { input: 'hello', voice: 'alloy' }],
    ] as const) {
      const response = await app.inject({ method: 'POST', url, headers: { authorization: 'Bearer employee-platform-key' }, payload })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ model: 'ai-ops' })
    }
    expect(media).toHaveBeenCalledTimes(3)
    expect(media.mock.calls.map((call) => call[1].model)).toEqual(['ai-ops', 'ai-ops', 'ai-ops'])
    await app.close()
    database.close()
  })
})
