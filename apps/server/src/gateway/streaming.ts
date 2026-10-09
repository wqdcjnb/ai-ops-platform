import { once } from 'node:events'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { } from '../platform-db.js'
import { GatewayUpstreamError, type GatewayRequestContext, type GatewayUpstream, type OpenAiResponsesEvent, type OpenAiResponsesRequest } from './openai-compatible.js'
import { outputTextLength as chunkTextLength, usageFromPayload, type GatewayUsageMeasurement } from './telemetry.js'
import type { } from './schemas.js'
import { gatewayErrorDetails } from './authorization.js'
import { type GatewayRequestTiming } from './completion.js'

export const maximumCapturedStreamTextChars = 250_000

export function streamText(value: unknown): string {
  if(!value || typeof value !== 'object') return ''
  const payload = value as Record<string, unknown>
  if(typeof payload.delta === 'string') return payload.delta
  if(typeof payload.output_text === 'string') return payload.output_text
  if(typeof payload.text === 'string') return payload.text
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  return choices.map((choice) => {
    if(!choice || typeof choice !== 'object') return ''
    const item = choice as Record<string, unknown>
    const message = item.delta && typeof item.delta === 'object' ? item.delta : item.message && typeof item.message === 'object' ? item.message : item
    return typeof (message as Record<string, unknown>).content === 'string' ? (message as Record<string, unknown>).content as string : ''
  }).join('')
}

export function appendCapturedStreamText(current: string, value: unknown) {
  return appendCapturedText(current, streamText(value))
}

export function appendCapturedText(current: string, next: string) {
  if(current.length >= maximumCapturedStreamTextChars) return current
  if(!next) return current
  return `${current}${next.slice(0, maximumCapturedStreamTextChars - current.length)}`
}

export function responseOutputText(event: OpenAiResponsesEvent, allowDoneFallback = false) {
  const eventType = event.event ?? (typeof event.data.type === 'string' ? event.data.type : '')
  if(eventType === 'response.output_text.delta') return typeof event.data.delta === 'string' ? event.data.delta : ''
  if(allowDoneFallback && eventType === 'response.output_text.done') return typeof event.data.text === 'string' ? event.data.text : ''
  // A few compatible upstreams omit the SSE `event:` line. Keep their plain
  // delta payloads working, but never treat reasoning summaries or completed
  // response snapshots as visible assistant output.
  if(!eventType && typeof event.data.delta === 'string') return event.data.delta
  return ''
}

export async function streamChatCompletion(
  request: FastifyRequest,
  reply: FastifyReply,
  upstream: GatewayUpstream,
  body: { model: string; messages: Array<{ role: string; content: unknown;[key: string]: unknown }>;[key: string]: unknown },
  timing: GatewayRequestTiming,
  upstreamContext?: GatewayRequestContext,
  onComplete?: (result: { status: 'succeeded' | 'failed' | 'cancelled'; error?: { code: string; message: string }; measurement: GatewayUsageMeasurement }) => Promise<void>,
  onChunk?: (chunk: Record<string, unknown>) => void,
) {
  const abortController = new AbortController()
  let clientClosed = false
  let status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded'
  let errorDetails: { code: string; message: string } | undefined
  let firstTokenMs: number | null = null
  let upstreamFirstTokenMs: number | null = null
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  let outputLength = 0
  let capturedText = ''
  let upstreamStartedAt = 0
  const onClose = () => {
    if(reply.raw.writableEnded) return
    clientClosed = true
    abortController.abort()
    void upstream.cancel(request.id).catch(() => undefined)
  }
  reply.raw.once('close', onClose)
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-request-id': request.id,
  })
  reply.raw.flushHeaders()
  try {
    upstreamStartedAt = Date.now()
    await upstream.chatCompletionStream(body, async (chunk) => {
      onChunk?.(chunk)
      capturedText = appendCapturedStreamText(capturedText, chunk)
      const textLength = chunkTextLength(chunk)
      if(firstTokenMs === null && textLength > 0) {
        firstTokenMs = Date.now() - timing.startedAt
        upstreamFirstTokenMs = Date.now() - upstreamStartedAt
      }
      usage = usageFromPayload(chunk) ?? usage
      outputLength += textLength
      if(!clientClosed && !reply.raw.destroyed && !reply.raw.writableEnded && !reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)) await once(reply.raw, 'drain', { signal: abortController.signal })
    }, abortController.signal, request.id, upstreamContext)
    if(clientClosed) status = 'cancelled'
    else if(!reply.raw.destroyed && !reply.raw.writableEnded) {
      reply.raw.write('data: [DONE]\n\n')
      reply.raw.end()
    }
  } catch(error) {
    const details = gatewayErrorDetails(error)
    errorDetails = details
    status = clientClosed || isCancelledError(error) ? 'cancelled' : 'failed'
    if(!clientClosed && !reply.raw.destroyed && !reply.raw.writableEnded) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: { ...details, requestId: request.id } })}\n\n`)
      reply.raw.end()
    }
  } finally {
    reply.raw.removeListener('close', onClose)
    if(!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.end()
    if(onComplete) await onComplete({
      status, error: errorDetails, measurement: {
        usage, response: capturedText ? { output_text: capturedText } : undefined, outputTextLength: outputLength, firstTokenMs,
        upstreamFirstTokenMs,
        upstreamTotalMs: upstreamStartedAt ? Math.max(0, Date.now() - upstreamStartedAt) : 0,
        aiOpsAuthMs: timing.aiOpsAuthMs, contextCompactionMs: timing.contextCompactionMs, context: timing.context,
      }
    })
  }
}

export async function streamResponses(
  request: FastifyRequest,
  reply: FastifyReply,
  upstream: GatewayUpstream,
  body: OpenAiResponsesRequest,
  timing: GatewayRequestTiming,
  upstreamContext?: GatewayRequestContext,
  onComplete?: (result: { status: 'succeeded' | 'failed' | 'cancelled'; error?: { code: string; message: string }; measurement: GatewayUsageMeasurement }) => Promise<void>,
  onEvent?: (event: OpenAiResponsesEvent) => void,
) {
  const abortController = new AbortController()
  let clientClosed = false
  let status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded'
  let errorDetails: { code: string; message: string } | undefined
  let firstTokenMs: number | null = null
  let upstreamFirstTokenMs: number | null = null
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  let outputLength = 0
  let capturedText = ''
  let receivedOutputTextDelta = false
  let upstreamStartedAt = 0
  const onClose = () => {
    if(reply.raw.writableEnded) return
    clientClosed = true
    abortController.abort()
    void upstream.cancel(request.id).catch(() => undefined)
  }
  reply.raw.once('close', onClose)
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-request-id': request.id,
  })
  reply.raw.flushHeaders()
  try {
    upstreamStartedAt = Date.now()
    await upstream.responsesStream!(body, async (event: OpenAiResponsesEvent) => {
      onEvent?.(event)
      const outputText = responseOutputText(event, !receivedOutputTextDelta)
      const eventType = event.event ?? (typeof event.data.type === 'string' ? event.data.type : '')
      if(eventType === 'response.output_text.delta') receivedOutputTextDelta = true
      capturedText = appendCapturedText(capturedText, outputText)
      const textLength = outputText.length
      if(firstTokenMs === null && textLength > 0) {
        firstTokenMs = Date.now() - timing.startedAt
        upstreamFirstTokenMs = Date.now() - upstreamStartedAt
      }
      usage = usageFromPayload(event.data) ?? usage
      outputLength += textLength
      if(!clientClosed && !reply.raw.destroyed && !reply.raw.writableEnded) {
        const prefix = event.event ? `event: ${event.event}\n` : ''
        if(!reply.raw.write(`${prefix}data: ${JSON.stringify(event.data)}\n\n`)) await once(reply.raw, 'drain', { signal: abortController.signal })
      }
    }, abortController.signal, request.id, upstreamContext)
    if(clientClosed) status = 'cancelled'
    else if(!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end()
  } catch(error) {
    const details = gatewayErrorDetails(error)
    errorDetails = details
    status = clientClosed || isCancelledError(error) ? 'cancelled' : 'failed'
    if(!clientClosed && !reply.raw.destroyed && !reply.raw.writableEnded) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: { ...details, requestId: request.id } })}\n\n`)
      reply.raw.end()
    }
  } finally {
    reply.raw.removeListener('close', onClose)
    if(!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.end()
    if(onComplete) await onComplete({
      status, error: errorDetails, measurement: {
        usage, response: capturedText ? { output_text: capturedText } : undefined, outputTextLength: outputLength, firstTokenMs,
        upstreamFirstTokenMs,
        upstreamTotalMs: upstreamStartedAt ? Math.max(0, Date.now() - upstreamStartedAt) : 0,
        aiOpsAuthMs: timing.aiOpsAuthMs, contextCompactionMs: timing.contextCompactionMs, context: timing.context,
      }
    })
  }
}

export function modelForResponse(response: Record<string, unknown>, fallback: string) {
  return typeof response.model === 'string' && response.model ? response.model : fallback
}

export function isCancelledError(error: unknown) {
  return error instanceof GatewayUpstreamError && error.code === 'GATEWAY_UPSTREAM_CANCELLED'
}
