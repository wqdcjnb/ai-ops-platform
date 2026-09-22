import type { PlatformAuditEventSeed, PlatformDatabase, PlatformGatewayKey, PlatformUsageRequestSeed } from '../platform-db.js'
import type { GatewayMode } from '../gateway-config.js'
import type { OpenAiChatRequest } from './openai-compatible.js'

export interface GatewayUsageMeasurement {
  response?: unknown
  usage?: { inputTokens?: number; outputTokens?: number }
  outputTextLength?: number
  firstTokenMs?: number | null
}

export interface GatewayUsageContext {
  database: PlatformDatabase
  key: PlatformGatewayKey
  requestId: string
  connector: GatewayMode
  requestedModel: string
  actualModel: string
  protocol: 'chat_completions' | 'responses'
  streamed: boolean
  request: OpenAiChatRequest
  startedAt: number
  headers: Record<string, unknown>
  measurement: GatewayUsageMeasurement
  status: 'succeeded' | 'failed' | 'cancelled'
  error?: { code: string; message: string }
  retryCount?: number
}

export function recordGatewayUsage(context: GatewayUsageContext) {
  const usage = usageFor(context.request, context.measurement)
  const occurredAt = new Date(context.startedAt).toISOString()
  const totalTokens = usage.inputTokens + usage.outputTokens
  const points = context.status === 'succeeded' ? Number((totalTokens / 1_000).toFixed(3)) : 0
  const safeError = context.error ? { category: errorCategory(context.error.code), summary: safeErrorMessage(context.error.message) } : null
  const seed: PlatformUsageRequestSeed = {
    requestId: context.requestId,
    occurredAt,
    ownerUserId: context.key.ownerUserId,
    apiKeyId: context.key.id,
    purpose: { id: `gateway-${context.key.id}`, name: context.key.purpose, alias: context.key.purpose },
    model: { id: context.actualModel, displayName: context.actualModel, actualModel: context.actualModel },
    channel: connectorChannel(context.connector),
    protocol: context.protocol,
    streamed: context.streamed,
    tokens: { input: usage.inputTokens, output: usage.outputTokens },
    points,
    latency: { firstTokenMs: context.measurement.firstTokenMs ?? null, totalMs: Math.max(0, Date.now() - context.startedAt) },
    cost: { type: 'platform_estimate', amountUsd: Number((totalTokens * 0.000001).toFixed(6)) },
    status: context.status,
    error: safeError,
    routeAlias: context.requestedModel,
    retryCount: context.retryCount ?? 0,
    requestIdPropagated: true,
    client: { name: clientName(context.headers), mode: context.streamed ? 'stream' : 'non_stream' },
  }
  const audit: PlatformAuditEventSeed = {
    id: `audit-gateway-${context.requestId.replace(/^req-/, '')}`,
    actorUserId: context.key.ownerUserId,
    action: 'access',
    resourceType: 'gateway_request',
    resourceId: context.requestId,
    result: context.status === 'succeeded' ? 'success' : context.status === 'cancelled' ? 'failed' : 'failed',
    requestId: context.requestId,
    summary: {
      code: context.status === 'succeeded' ? 'GATEWAY_REQUEST_SUCCEEDED' : context.status === 'cancelled' ? 'GATEWAY_REQUEST_CANCELLED' : 'GATEWAY_REQUEST_FAILED',
      message: '已记录网关调用元数据；未保存认证凭据、请求正文或对话正文。',
      model: context.actualModel,
      protocol: context.protocol,
      streamed: context.streamed,
      status: context.status,
      tokens: totalTokens,
    },
  }
  const recorded = context.database.recordGatewayUsage(seed, audit, new Date(context.startedAt))
  return recorded
}

function connectorChannel(mode: GatewayMode): PlatformUsageRequestSeed['channel'] {
  if (mode === 'new_api') return { id: 'gateway-new-api', name: 'New API 连接器', type: 'official_api' }
  if (mode === 'cpa') return { id: 'gateway-cpa', name: 'CPA Codex OAuth', type: 'cpa_oauth' }
  return { id: 'gateway-standalone', name: 'AI OPS 独立网关', type: 'official_api' }
}

export function usageFromPayload(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.usage)) return null
  const usage = payload.usage
  const inputTokens = numberValue(usage.prompt_tokens ?? usage.input_tokens)
  const outputTokens = numberValue(usage.completion_tokens ?? usage.output_tokens)
  if (inputTokens === null && outputTokens === null) return null
  return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 }
}

export function outputTextLength(payload: unknown) {
  if (!isRecord(payload)) return 0
  if (typeof payload.output_text === 'string') return payload.output_text.length
  if (typeof payload.delta === 'string') return payload.delta.length
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  return choices.reduce((total, choice) => {
    if (!isRecord(choice)) return total
    const message = isRecord(choice.message) ? choice.message : isRecord(choice.delta) ? choice.delta : null
    return total + (message && typeof message.content === 'string' ? message.content.length : 0)
  }, 0)
}

function usageFor(request: OpenAiChatRequest, measurement: GatewayUsageMeasurement) {
  const payloadUsage = usageFromPayload(measurement.response)
  const usage = measurement.usage ?? payloadUsage
  return {
    inputTokens: usage?.inputTokens ?? estimateTokens(request.messages),
    outputTokens: usage?.outputTokens ?? Math.max(0, Math.ceil((measurement.outputTextLength ?? outputTextLength(measurement.response)) / 4)),
  }
}

function estimateTokens(messages: OpenAiChatRequest['messages']) {
  const characters = messages.reduce((total, message) => total + JSON.stringify(message.content ?? '').length, 0)
  return Math.max(0, Math.ceil(characters / 4))
}

function clientName(headers: Record<string, unknown>): 'Codex Desktop' | 'WorkBuddy' {
  const value = String(headers['x-ai-client'] ?? headers['user-agent'] ?? '').toLowerCase()
  return value.includes('workbuddy') ? 'WorkBuddy' : 'Codex Desktop'
}

function errorCategory(code: string): 'rate_limit' | 'timeout' | 'authentication' | 'server' | 'cancelled' {
  if (code.includes('RATE_LIMIT')) return 'rate_limit'
  if (code.includes('TIMEOUT')) return 'timeout'
  if (code.includes('AUTH')) return 'authentication'
  if (code.includes('CANCEL')) return 'cancelled'
  return 'server'
}

function safeErrorMessage(message: string) {
  return message.length > 120 ? `${message.slice(0, 117)}...` : message
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
