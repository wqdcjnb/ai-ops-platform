import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExternalProviderRegistry, ExternalProviderRoute } from '../external-providers.js'
import type { GatewayConfig } from '../gateway-config.js'
import { ExternalProviderGatewayUpstream } from './external-provider-upstream.js'
import type { GatewayUpstream } from './openai-compatible.js'

const config: GatewayConfig = {
  mode: 'relay',
  provider: 'openai_compatible',
  timeoutMs: 5_000,
  defaultStreaming: false,
  context: { enabled: false, maxInputChars: 4_000, maxMessages: 1 },
  upstreamConfigured: false,
}

const routes: ExternalProviderRoute[] = [
  { providerId: 'relay-a', providerName: 'Relay A', baseUrl: 'https://relay-a.test/v1', apiKey: 'a', upstreamModelId: 'model-a', publicModelId: 'ai-ops', modalities: ['text'] },
  { providerId: 'relay-b', providerName: 'Relay B', baseUrl: 'https://relay-b.test/v1', apiKey: 'b', upstreamModelId: 'model-b', publicModelId: 'ai-ops', modalities: ['text'] },
  { providerId: 'relay-c', providerName: 'Relay C', baseUrl: 'https://relay-c.test/v1', apiKey: 'c', upstreamModelId: 'model-c', publicModelId: 'ai-ops', modalities: ['text'] },
]

const primary: GatewayUpstream = {
  async listModels() { return [] },
  async chatCompletion() { throw new Error('primary must not receive relay traffic') },
  async chatCompletionStream() { throw new Error('primary must not receive relay traffic') },
  async cancel() {},
}

function delayedResponse(delayMs: number, body: unknown, signal?: AbortSignal) {
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })), delayMs)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }, { once: true })
  })
}

describe('ExternalProviderGatewayUpstream relay races', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('probes several relays concurrently, uses the first healthy relay, and does not duplicate the generation', async () => {
    const modelProbes: string[] = []
    const generationCalls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      const relay = new URL(href).hostname
      if (href.endsWith('/models')) {
        modelProbes.push(relay)
        const delay = relay === 'relay-b.test' ? 8 : relay === 'relay-a.test' ? 80 : 120
        return delayedResponse(delay, { data: [{ id: `model-${relay}`, object: 'model', created: 0, owned_by: relay }] }, init?.signal ?? undefined)
      }
      generationCalls.push(relay)
      return new Response(JSON.stringify({ id: 'chat-1', object: 'chat.completion', created: 1, model: 'gpt-4.1-2025-04-14', choices: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const registry = { listPlatformRoutes: () => routes } as unknown as ExternalProviderRegistry
    const gateway = new ExternalProviderGatewayUpstream(primary, registry, config)
    const actualModels: string[] = []
    const result = await gateway.chatCompletion({ model: 'ai-ops', messages: [{ role: 'user', content: 'hello' }] }, undefined, { onActualModel: (model) => actualModels.push(model) })

    expect(modelProbes.sort()).toEqual(['relay-a.test', 'relay-b.test', 'relay-c.test'])
    expect(generationCalls).toEqual(['relay-b.test'])
    expect(actualModels).toEqual(['model-b', 'gpt-4.1-2025-04-14'])
    expect(result.model).toBe('ai-ops')
  })

  it('keeps text and media requests in their own eligible route groups', async () => {
    const modalityRoutes: ExternalProviderRoute[] = [
      { providerId: 'relay-text', providerName: '文本', baseUrl: 'https://text.test/v1', apiKey: 'text-key', upstreamModelId: 'chat-model', publicModelId: 'ai-ops', modalities: ['text'] },
      { providerId: 'relay-image', providerName: '图片', baseUrl: 'https://image.test/v1', apiKey: 'image-key', upstreamModelId: 'image-model', publicModelId: 'ai-ops', modalities: ['image'] },
    ]
    const calls: Array<{ host: string; path: string; model?: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const parsed = new URL(String(url))
      if (parsed.pathname.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'listed', object: 'model', created: 0, owned_by: 'test' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
      calls.push({ host: parsed.hostname, path: parsed.pathname, model: body.model })
      if (parsed.pathname.endsWith('/chat/completions')) return new Response(JSON.stringify({ id: 'chat-1', object: 'chat.completion', created: 0, model: body.model, choices: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ created: 0, data: [], model: body.model }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const registry = {
      listPlatformRoutes: (modality?: string) => modality ? modalityRoutes.filter((route) => route.modalities.includes(modality as 'text' | 'image')) : modalityRoutes,
    } as unknown as ExternalProviderRegistry
    const gateway = new ExternalProviderGatewayUpstream(primary, registry, config)

    await gateway.chatCompletion({ model: 'ai-ops', messages: [{ role: 'user', content: 'hello' }] })
    await gateway.media!('/images/generations', { model: 'ai-ops', prompt: 'a poster' })

    expect(calls).toEqual([
      { host: 'text.test', path: '/v1/chat/completions', model: 'chat-model' },
      { host: 'image.test', path: '/v1/images/generations', model: 'image-model' },
    ])
  })
})
