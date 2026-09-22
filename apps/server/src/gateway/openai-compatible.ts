import type { GatewayConfig } from '../gateway-config.js'

export interface OpenAiModel {
  id: string
  object: 'model'
  created: number
  owned_by: string
}

export interface OpenAiChatRequest {
  model: string
  messages: Array<{ role: string; content: unknown; [key: string]: unknown }>
  [key: string]: unknown
}

export interface OpenAiResponsesRequest {
  model: string
  [key: string]: unknown
}

export interface OpenAiResponsesEvent {
  event?: string
  data: Record<string, unknown>
}

/** Per-request credential forwarding context. Kept in memory only. */
export interface GatewayRequestContext {
  authorization?: string
}

export interface GatewayUpstream {
  listModels(signal?: AbortSignal, context?: GatewayRequestContext): Promise<OpenAiModel[]>
  chatCompletion(request: OpenAiChatRequest, signal?: AbortSignal, context?: GatewayRequestContext): Promise<Record<string, unknown>>
  chatCompletionStream(request: OpenAiChatRequest, onChunk: (chunk: Record<string, unknown>) => void, signal?: AbortSignal, requestId?: string, context?: GatewayRequestContext): Promise<void>
  /** Native Responses support is optional so test and legacy adapters can stay chat-only. */
  responses?(request: OpenAiResponsesRequest, signal?: AbortSignal, context?: GatewayRequestContext): Promise<Record<string, unknown>>
  responsesStream?(request: OpenAiResponsesRequest, onEvent: (event: OpenAiResponsesEvent) => void, signal?: AbortSignal, requestId?: string, context?: GatewayRequestContext): Promise<void>
  cancel(requestId: string, signal?: AbortSignal): Promise<void>
}

export type GatewayUpstreamErrorCode =
  | 'GATEWAY_UPSTREAM_NOT_CONFIGURED'
  | 'GATEWAY_UPSTREAM_TIMEOUT'
  | 'GATEWAY_UPSTREAM_UNAVAILABLE'
  | 'GATEWAY_UPSTREAM_RATE_LIMITED'
  | 'GATEWAY_UPSTREAM_AUTH_FAILED'
  | 'GATEWAY_UPSTREAM_INVALID_RESPONSE'
  | 'GATEWAY_UPSTREAM_CANCELLED'
  | 'GATEWAY_UPSTREAM_ERROR'

export class GatewayUpstreamError extends Error {
  readonly code: GatewayUpstreamErrorCode
  readonly statusCode: number

  constructor(code: GatewayUpstreamErrorCode, statusCode: number, message: string) {
    super(message)
    this.name = 'GatewayUpstreamError'
    this.code = code
    this.statusCode = statusCode
  }
}

interface OpenAiCompatibleOptions {
  timeoutMs?: number
}

export class OpenAiCompatibleAdapter implements GatewayUpstream {
  private readonly timeoutMs: number
  private readonly activeRequests = new Map<string, { controller: AbortController; cancelled: boolean }>()

  constructor(private readonly config: GatewayConfig, options: OpenAiCompatibleOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? config.timeoutMs
  }

  async listModels(signal?: AbortSignal, context?: GatewayRequestContext) {
    const payload = await this.requestJson('/models', { method: 'GET' }, signal, context)
    if (!isRecord(payload) || !Array.isArray(payload.data)) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_INVALID_RESPONSE', 502, '上游模型列表格式无效')
    return payload.data.flatMap((item) => parseModel(item))
  }

  async chatCompletion(request: OpenAiChatRequest, signal?: AbortSignal, context?: GatewayRequestContext) {
    const payload = await this.requestJson('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ ...request, stream: false }),
    }, signal, context)
    if (!isRecord(payload) || !Array.isArray(payload.choices) || typeof payload.id !== 'string' || typeof payload.model !== 'string') {
      throw new GatewayUpstreamError('GATEWAY_UPSTREAM_INVALID_RESPONSE', 502, '上游聊天响应格式无效')
    }
    return payload
  }

  async responses(request: OpenAiResponsesRequest, signal?: AbortSignal, context?: GatewayRequestContext) {
    const payload = await this.requestJson('/responses', {
      method: 'POST',
      body: JSON.stringify({ ...request, stream: false }),
    }, signal, context)
    if (!isRecord(payload)) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_INVALID_RESPONSE', 502, '上游 Responses 响应格式无效')
    return payload
  }

  async chatCompletionStream(request: OpenAiChatRequest, onChunk: (chunk: Record<string, unknown>) => void, signal?: AbortSignal, requestId?: string, context?: GatewayRequestContext) {
    if (!this.config.baseUrl || !this.config.upstreamConfigured) {
      throw new GatewayUpstreamError('GATEWAY_UPSTREAM_NOT_CONFIGURED', 503, '尚未配置可用的网关上游')
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (requestId) this.activeRequests.set(requestId, { controller, cancelled: false })

    try {
      const headers = new Headers({ accept: 'text/event-stream', 'content-type': 'application/json' })
      setAuthorizationHeader(headers, this.config.upstreamApiKey, context)
      const response = await fetch(resolveEndpoint(this.config.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...request, stream: true }),
        signal: controller.signal,
      })
      if (!response.ok) throw mapUpstreamStatus(response.status)
      if (!response.body) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_INVALID_RESPONSE', 502, '上游没有返回流式响应体')
      await readSse(response.body, onChunk)
    } catch (error) {
      if (error instanceof GatewayUpstreamError) throw error
      const cancelled = signal?.aborted || (requestId ? this.activeRequests.get(requestId)?.cancelled : false)
      if (controller.signal.aborted) throw new GatewayUpstreamError(cancelled ? 'GATEWAY_UPSTREAM_CANCELLED' : 'GATEWAY_UPSTREAM_TIMEOUT', cancelled ? 499 : 504, cancelled ? '客户端已取消请求' : '上游响应超时')
      throw new GatewayUpstreamError('GATEWAY_UPSTREAM_UNAVAILABLE', 502, '上游暂时不可达')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      if (requestId) this.activeRequests.delete(requestId)
    }
  }

  async responsesStream(request: OpenAiResponsesRequest, onEvent: (event: OpenAiResponsesEvent) => void, signal?: AbortSignal, requestId?: string, context?: GatewayRequestContext) {
    if (!this.config.baseUrl || !this.config.upstreamConfigured) {
      throw new GatewayUpstreamError('GATEWAY_UPSTREAM_NOT_CONFIGURED', 503, '尚未配置可用的网关上游')
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (requestId) this.activeRequests.set(requestId, { controller, cancelled: false })

    try {
      const headers = new Headers({ accept: 'text/event-stream', 'content-type': 'application/json' })
      setAuthorizationHeader(headers, this.config.upstreamApiKey, context)
      const response = await fetch(resolveEndpoint(this.config.baseUrl, '/responses'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...request, stream: true }),
        signal: controller.signal,
      })
      if (!response.ok) throw mapUpstreamStatus(response.status)
      if (!response.body) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_INVALID_RESPONSE', 502, '上游没有返回 Responses 流式响应体')
      await readResponseSse(response.body, onEvent)
    } catch (error) {
      if (error instanceof GatewayUpstreamError) throw error
      const cancelled = signal?.aborted || (requestId ? this.activeRequests.get(requestId)?.cancelled : false)
      if (controller.signal.aborted) throw new GatewayUpstreamError(cancelled ? 'GATEWAY_UPSTREAM_CANCELLED' : 'GATEWAY_UPSTREAM_TIMEOUT', cancelled ? 499 : 504, cancelled ? '客户端已取消请求' : '上游响应超时')
      throw new GatewayUpstreamError('GATEWAY_UPSTREAM_UNAVAILABLE', 502, '上游暂时不可达')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      if (requestId) this.activeRequests.delete(requestId)
    }
  }

  async cancel(requestId: string, _signal?: AbortSignal) {
    const active = this.activeRequests.get(requestId)
    if (active) {
      active.cancelled = true
      active.controller.abort()
    }
  }

  private async requestJson(path: string, init: { method: 'GET' | 'POST'; body?: string }, signal?: AbortSignal, context?: GatewayRequestContext): Promise<unknown> {
    if (!this.config.baseUrl || !this.config.upstreamConfigured) {
      throw new GatewayUpstreamError('GATEWAY_UPSTREAM_NOT_CONFIGURED', 503, '尚未配置可用的网关上游')
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })

    try {
      const headers = new Headers({ accept: 'application/json', 'content-type': 'application/json' })
      setAuthorizationHeader(headers, this.config.upstreamApiKey, context)
      const response = await fetch(resolveEndpoint(this.config.baseUrl, path), {
        method: init.method,
        headers,
        ...(init.body ? { body: init.body } : {}),
        signal: controller.signal,
      })
      const text = await response.text()
      const payload = parseJson(text)
      if (!response.ok) throw mapUpstreamStatus(response.status)
      return payload
    } catch (error) {
      if (error instanceof GatewayUpstreamError) throw error
      if (controller.signal.aborted) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_TIMEOUT', 504, '上游响应超时')
      throw new GatewayUpstreamError('GATEWAY_UPSTREAM_UNAVAILABLE', 502, '上游暂时不可达')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
}

function setAuthorizationHeader(headers: Headers, fallbackApiKey: string | undefined, context?: GatewayRequestContext) {
  if (context?.authorization?.trim()) headers.set('authorization', context.authorization.trim())
  else if (fallbackApiKey) headers.set('authorization', `Bearer ${fallbackApiKey}`)
}

async function readSse(body: ReadableStream<Uint8Array>, onChunk: (chunk: Record<string, unknown>) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') return
        const parsed = parseJson(data)
        if (!isRecord(parsed)) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_INVALID_RESPONSE', 502, '上游流式数据格式无效')
        onChunk(parsed)
      }
      if (done) break
    }
    const trailing = buffer.trim()
    if (trailing.startsWith('data:')) {
      const data = trailing.slice(5).trim()
      if (data && data !== '[DONE]') {
        const parsed = parseJson(data)
        if (!isRecord(parsed)) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_INVALID_RESPONSE', 502, '上游流式数据格式无效')
        onChunk(parsed)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function readResponseSse(body: ReadableStream<Uint8Array>, onEvent: (event: OpenAiResponsesEvent) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []

  const flush = () => {
    if (dataLines.length === 0) return false
    const data = dataLines.join('\n').trim()
    dataLines = []
    const currentEvent = eventName || undefined
    eventName = ''
    if (!data || data === '[DONE]') return data === '[DONE]'
    const parsed = parseJson(data)
    if (!isRecord(parsed)) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_INVALID_RESPONSE', 502, '上游 Responses 流式数据格式无效')
    onEvent({ event: currentEvent, data: parsed })
    return false
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line === '') {
          if (flush()) return
          continue
        }
        if (line.startsWith('event:')) eventName = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      if (done) break
    }
    flush()
  } finally {
    reader.releaseLock()
  }
}

function resolveEndpoint(baseUrl: string, path: string) {
  return new URL(path.replace(/^\//, ''), `${baseUrl.replace(/\/$/, '')}/`).toString()
}

function parseJson(text: string): unknown {
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new GatewayUpstreamError('GATEWAY_UPSTREAM_INVALID_RESPONSE', 502, '上游返回了无效 JSON')
  }
}

function mapUpstreamStatus(status: number) {
  if (status === 401 || status === 403) return new GatewayUpstreamError('GATEWAY_UPSTREAM_AUTH_FAILED', 502, '上游认证失败')
  if (status === 429) return new GatewayUpstreamError('GATEWAY_UPSTREAM_RATE_LIMITED', 429, '上游请求频率受限')
  if (status >= 500) return new GatewayUpstreamError('GATEWAY_UPSTREAM_ERROR', 502, '上游服务异常')
  return new GatewayUpstreamError('GATEWAY_UPSTREAM_ERROR', 502, '上游拒绝了请求')
}

function parseModel(value: unknown): OpenAiModel[] {
  if (!isRecord(value) || typeof value.id !== 'string') return []
  return [{
    id: value.id,
    object: 'model',
    created: typeof value.created === 'number' ? value.created : 0,
    owned_by: typeof value.owned_by === 'string' ? value.owned_by : 'upstream',
  }]
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
