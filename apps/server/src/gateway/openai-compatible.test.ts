import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadGatewayConfig } from '../gateway-config.js'
import { GatewayUpstreamError, OpenAiCompatibleAdapter } from './openai-compatible.js'

afterEach(() => vi.restoreAllMocks())

function config(overrides: Record<string, string> = {}) {
  return loadGatewayConfig({
    AI_OPS_GATEWAY_UPSTREAM_BASE_URL: 'http://127.0.0.1:9000/v1',
    AI_OPS_GATEWAY_UPSTREAM_API_KEY: 'server-only-secret',
    ...overrides,
  })
}

describe('OpenAI-compatible gateway adapter', () => {
  it('lists models with the server-only bearer credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini', created: 7, owned_by: 'test' }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const models = await new OpenAiCompatibleAdapter(config()).listModels()
    expect(models).toEqual([{ id: 'gpt-4o-mini', object: 'model', created: 7, owned_by: 'test' }])
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9000/v1/models', expect.objectContaining({ method: 'GET', headers: expect.any(Headers) }))
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('authorization')).toBe('Bearer server-only-secret')
  })

  it('forces non-streaming chat requests and maps upstream rate limits', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion', created: 7, model: 'gpt-4o-mini', choices: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new OpenAiCompatibleAdapter(config())

    await adapter.chatCompletion({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hello' }], stream: true })
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { stream: boolean }
    expect(body.stream).toBe(false)

    await expect(adapter.listModels()).rejects.toMatchObject({ code: 'GATEWAY_UPSTREAM_RATE_LIMITED', statusCode: 429 })
  })

  it('parses upstream SSE chunks and sends streaming requests with stream=true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      'data: {"id":"chatcmpl-stream","object":"chat.completion.chunk","created":7,"model":"gpt-4o-mini","choices":[]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const chunks: Array<Record<string, unknown>> = []
    await new OpenAiCompatibleAdapter(config()).chatCompletionStream(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hello' }] },
      (chunk) => chunks.push(chunk),
      undefined,
      'req-stream-test',
    )

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ id: 'chatcmpl-stream' })
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { stream: boolean }
    expect(body.stream).toBe(true)
  })

  it('cancels an active upstream stream by request id', async () => {
    let rejectFetch: ((error: unknown) => void) | undefined
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      rejectFetch = reject
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new OpenAiCompatibleAdapter(config())
    const pending = adapter.chatCompletionStream(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hello' }] },
      () => undefined,
      undefined,
      'req-cancel-test',
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    await adapter.cancel('req-cancel-test')
    rejectFetch?.(new DOMException('aborted', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ code: 'GATEWAY_UPSTREAM_CANCELLED', statusCode: 499 })
  })

  it('does not call fetch when the upstream is unconfigured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new OpenAiCompatibleAdapter(loadGatewayConfig({}))

    await expect(adapter.listModels()).rejects.toBeInstanceOf(GatewayUpstreamError)
    await expect(adapter.listModels()).rejects.toMatchObject({ code: 'GATEWAY_UPSTREAM_NOT_CONFIGURED', statusCode: 503 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
