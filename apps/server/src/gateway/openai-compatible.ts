import type { GatewayConfig } from '../gateway-config.js'

export interface OpenAiModel {
  id: string
  object: 'model'
  created: number
  owned_by: string
  /** Some compatible catalogs expose a non-standard modality/capability
   * field. Keep it internal so the relay router can make a safer choice
   * without promising those hints in the public model catalog. */
  capabilityHints?: string[]
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

/** JSON-shaped OpenAI-compatible media requests, including image generation,
 * video jobs and speech synthesis. File-upload endpoints deliberately stay
 * outside this transport because they require multipart streaming. */
export interface OpenAiMediaRequest {
  model: string
  [key: string]: unknown
}

/** Per-request credential forwarding and telemetry context. Kept in memory only. */
export interface GatewayRequestContext {
  authorization?: string
  /**
   * Internal-only route telemetry. The relay invokes this with the model it
   * selected (and, when available, the model reported by the upstream) while
   * continuing to expose only the public AI OPS model to the client.
   */
  onActualModel?: (modelId: string) => void
}

export interface GatewayUpstream {
  listModels(signal?: AbortSignal, context?: GatewayRequestContext): Promise<OpenAiModel[]>
  chatCompletion(request: OpenAiChatRequest, signal?: AbortSignal, context?: GatewayRequestContext): Promise<Record<string, unknown>>
  chatCompletionStream(request: OpenAiChatRequest, onChunk: (chunk: Record<string, unknown>) => void, signal?: AbortSignal, requestId?: string, context?: GatewayRequestContext): Promise<void>
  /** Native Responses support is optional so test and legacy adapters can stay chat-only. */
  responses?(request: OpenAiResponsesRequest, signal?: AbortSignal, context?: GatewayRequestContext): Promise<Record<string, unknown>>
  responsesStream?(request: OpenAiResponsesRequest, onEvent: (event: OpenAiResponsesEvent) => void, signal?: AbortSignal, requestId?: string, context?: GatewayRequestContext): Promise<void>
  /** Forward a JSON OpenAI-compatible media request without exposing the
   * selected relay or its credential to the client. */
  media?(path: '/images/generations' | '/videos' | '/audio/speech', request: OpenAiMediaRequest, signal?: AbortSignal, context?: GatewayRequestContext): Promise<Record<string, unknown>>
  cancel(requestId: string, signal?: AbortSignal): Promise<void>
}

export type GatewayUpstreamErrorCode =
  | 'GATEWAY_UPSTREAM_NOT_CONFIGURED'
  | 'GATEWAY_UPSTREAM_TIMEOUT'
  | 'GATEWAY_UPSTREAM_UNAVAILABLE'
  | 'GATEWAY_UPSTREAM_RATE_LIMITED'
  | 'GATEWAY_UPSTREAM_CREDIT_EXHAUSTED'
  | 'GATEWAY_UPSTREAM_AUTH_FAILED'
  | 'GATEWAY_UPSTREAM_NOT_FOUND'
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
    const entries = modelEntries(payload)
    if (!entries) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_INVALID_RESPONSE', 502, '上游模型列表格式无效')
    return entries.flatMap((item) => parseModel(item))
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

  async media(path: '/images/generations' | '/videos' | '/audio/speech', request: OpenAiMediaRequest, signal?: AbortSignal, context?: GatewayRequestContext) {
    const payload = await this.requestJson(path, {
      method: 'POST',
      body: JSON.stringify(request),
    }, signal, context)
    if (!isRecord(payload)) throw new GatewayUpstreamError('GATEWAY_UPSTREAM_INVALID_RESPONSE', 502, '上游多模态响应格式无效')
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
  if (status === 402) return new GatewayUpstreamError('GATEWAY_UPSTREAM_CREDIT_EXHAUSTED', 502, '上游账户余额或配额不足')
  if (status === 404) return new GatewayUpstreamError('GATEWAY_UPSTREAM_NOT_FOUND', 502, '上游未提供所请求的接口')
  if (status === 429) return new GatewayUpstreamError('GATEWAY_UPSTREAM_RATE_LIMITED', 429, '上游请求频率受限')
  if (status >= 500) return new GatewayUpstreamError('GATEWAY_UPSTREAM_ERROR', 502, '上游服务异常')
  return new GatewayUpstreamError('GATEWAY_UPSTREAM_ERROR', 502, '上游拒绝了请求')
}

/** A few compatible services return a direct array or `models` rather than
 * OpenAI's canonical `{ data: [...] }`. Supporting those safe shapes keeps
 * model discovery interoperable without accepting an arbitrary response. */
function modelEntries(payload: unknown, depth = 0): unknown[] | null {
  if (depth > 3) return null
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return null
  for (const key of ['data', 'models', 'items', 'results', 'model_list', 'modelList']) {
    const value = payload[key]
    if (Array.isArray(value)) return value
    if (isRecord(value)) {
      const nested = modelEntries(value, depth + 1)
      if (nested) return nested
    }
  }
  return null
}

function parseModel(value: unknown): OpenAiModel[] {
  if (typeof value === 'string' && value.trim()) {
    return [{ id: value.trim(), object: 'model', created: 0, owned_by: 'upstream' }]
  }
  if (!isRecord(value)) return []
  const id = [value.id, value.model, value.model_id, value.modelId, value.name]
    .find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim()))
  if (!id) return []
  const capabilityHints = modelCapabilityHints(value)
  return [{
    id: id.trim(),
    object: 'model',
    created: typeof value.created === 'number' ? value.created : 0,
    owned_by: typeof value.owned_by === 'string' ? value.owned_by : 'upstream',
    ...(capabilityHints.length ? { capabilityHints } : {}),
  }]
}

/** Model list responses are not standardized outside OpenAI's core fields.
 * Read only the common metadata keys, flatten simple strings/arrays/boolean
 * flags, and leave the rest untouched. This is deliberately a hint, never a
 * claim made to employees or a substitute for a provider-specific adapter. */
function modelCapabilityHints(model: Record<string, unknown>) {
  const hints = new Set<string>()
  const collect = (value: unknown, depth = 0): void => {
    if (depth > 2 || value === null || value === undefined) return
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized) hints.add(normalized)
      return
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => collect(entry, depth + 1))
      return
    }
    if (!isRecord(value)) return
    for (const [key, nested] of Object.entries(value)) {
      if (nested === true) hints.add(key.toLowerCase())
      else if (typeof nested === 'string' || Array.isArray(nested)) collect(nested, depth + 1)
    }
  }

  for (const key of ['capabilities', 'modalities', 'input_modalities', 'output_modalities', 'inputModalities', 'outputModalities', 'type', 'category', 'task', 'tasks']) {
    collect(model[key])
  }
  return [...hints].slice(0, 24)
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
