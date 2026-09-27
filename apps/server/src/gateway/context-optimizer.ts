import type { OpenAiChatRequest, OpenAiResponsesRequest } from './openai-compatible.js'

export interface GatewayContextPolicy {
  enabled: boolean
  maxInputChars: number
  maxMessages: number
}

/** Metadata only: no prompt text is retained in usage telemetry. */
export interface GatewayContextMetrics {
  originalChars: number
  forwardedChars: number
  droppedMessages: number
  strippedChars: number
}

interface ContextResult<T> {
  request: T
  metrics: GatewayContextMetrics
}

type Message = { role: string; content: unknown; [key: string]: unknown }

const injectedBlockPattern = /<(?:system-reminder|memory|working_memory|project_memory)\b[^>]*>[\s\S]*?<\\?\/(?:system-reminder|memory|working_memory|project_memory)\s*>/giu
const encodedInjectedBlockPattern = /&lt;(?:system-reminder|memory|working_memory|project_memory)\b[^&]*&gt;[\s\S]*?&lt;\/(?:system-reminder|memory|working_memory|project_memory)\s*&gt;/giu
const userQueryPattern = /<user_query\b[^>]*>([\s\S]*?)<\\?\/user_query\s*>/iu
const encodedUserQueryPattern = /&lt;user_query\b[^&]*&gt;([\s\S]*?)&lt;\/user_query\s*&gt;/iu
const truncationMarker = '\n…[上下文已压缩]…\n'

export function compactChatRequest(request: OpenAiChatRequest, policy: GatewayContextPolicy): ContextResult<OpenAiChatRequest> {
  const originalChars = request.messages.reduce((total, message) => total + contentTextLength(message.content), 0)
  if (!policy.enabled) return { request, metrics: noChangeMetrics(originalChars) }

  const normalized = request.messages.map((message) => sanitizeMessage(message))
  const selected = limitMessages(normalized, policy.maxMessages)
  const compacted = fitMessagesWithinBudget(selected, policy.maxInputChars)
  const forwardedChars = compacted.reduce((total, message) => total + contentTextLength(message.content), 0)
  return {
    request: { ...request, messages: compacted },
    metrics: createMetrics(originalChars, forwardedChars, request.messages.length - compacted.length),
  }
}

export function compactResponsesRequest(request: OpenAiResponsesRequest, policy: GatewayContextPolicy): ContextResult<OpenAiResponsesRequest> {
  const originalChars = responseTextLength(request)
  if (!policy.enabled) return { request, metrics: noChangeMetrics(originalChars) }

  const instructions = typeof request.instructions === 'string' ? sanitizeText(request.instructions) : undefined
  const nextInstructions = instructions ? truncateText(instructions, Math.min(instructions.length, Math.max(1, Math.floor(policy.maxInputChars * 0.25)))) : undefined
  const input = request.input
  if (typeof input === 'string') {
    const messages = limitMessages([{ role: 'user', content: sanitizeText(input) }], policy.maxMessages)
    const instructionLength = nextInstructions?.length ?? 0
    const available = Math.max(1, policy.maxInputChars - instructionLength)
    const compactedMessages = fitMessagesWithinBudget(messages, available)
    const nextInput = typeof compactedMessages[0]?.content === 'string' ? compactedMessages[0].content : ''
    const forwardedChars = (nextInstructions?.length ?? 0) + nextInput.length
    return {
      request: { ...request, ...(nextInstructions ? { instructions: nextInstructions } : {}), input: nextInput },
      metrics: createMetrics(originalChars, forwardedChars, 0),
    }
  }

  if (!Array.isArray(input)) return { request, metrics: noChangeMetrics(originalChars) }
  const normalizedItems = input.map((item) => sanitizeResponseItem(item))
  const indexedMessages = normalizedItems.flatMap((item, sourceIndex) => isMessageItem(item)
    ? [{ ...responseItemToMessage(item), sourceIndex }]
    : []) as Array<Message & { sourceIndex: number }>
  const selectedMessages = fitMessagesWithinBudget(
    limitMessages(indexedMessages, policy.maxMessages),
    Math.max(1, policy.maxInputChars - (nextInstructions?.length ?? 0)),
  ) as Array<Message & { sourceIndex: number }>
  const selectedByIndex = new Map(selectedMessages.map((message) => [message.sourceIndex, message.content]))
  const nextInput = normalizedItems.flatMap((item, sourceIndex) => {
    if (!isMessageItem(item)) return [item]
    const content = selectedByIndex.get(sourceIndex)
    return content === undefined ? [] : [withResponseItemContent(item, content)]
  })
  const forwardedChars = (nextInstructions?.length ?? 0) + nextInput.reduce<number>((total, item) => total + responseItemTextLength(item), 0)
  return {
    request: { ...request, ...(nextInstructions ? { instructions: nextInstructions } : {}), input: nextInput },
    metrics: createMetrics(originalChars, forwardedChars, indexedMessages.length - selectedMessages.length),
  }
}

function noChangeMetrics(originalChars: number): GatewayContextMetrics {
  return { originalChars, forwardedChars: originalChars, droppedMessages: 0, strippedChars: 0 }
}

function createMetrics(originalChars: number, forwardedChars: number, droppedMessages: number): GatewayContextMetrics {
  return {
    originalChars,
    forwardedChars,
    droppedMessages: Math.max(0, droppedMessages),
    strippedChars: Math.max(0, originalChars - forwardedChars),
  }
}

function sanitizeMessage(message: Message): Message {
  return { ...message, content: sanitizeContent(message.content) }
}

function sanitizeResponseItem(item: unknown) {
  if (!isRecord(item)) return item
  const next = { ...item }
  if ('content' in next) next.content = sanitizeContent(next.content)
  if (typeof next.input_text === 'string') next.input_text = sanitizeText(next.input_text)
  if (typeof next.text === 'string') next.text = sanitizeText(next.text)
  return next
}

function sanitizeContent(content: unknown): unknown {
  if (typeof content === 'string') return sanitizeText(content)
  if (Array.isArray(content)) return content.map((part) => sanitizeContentPart(part))
  if (!isRecord(content)) return content
  return sanitizeContentPart(content)
}

function sanitizeContentPart(part: unknown): unknown {
  if (typeof part === 'string') return sanitizeText(part)
  if (!isRecord(part)) return part
  const next = { ...part }
  if (typeof next.text === 'string') next.text = sanitizeText(next.text)
  if (typeof next.input_text === 'string') next.input_text = sanitizeText(next.input_text)
  if ('content' in next) next.content = sanitizeContent(next.content)
  return next
}

function sanitizeText(text: string) {
  const userQuery = text.match(userQueryPattern)?.[1] ?? text.match(encodedUserQueryPattern)?.[1]
  if (userQuery !== undefined) return userQuery.trim()
  return text.replace(injectedBlockPattern, '').replace(encodedInjectedBlockPattern, '').trim()
}

function limitMessages(messages: Message[], maxMessages: number) {
  if (messages.length <= maxMessages) return messages
  const system = messages.find((message) => message.role === 'system' || message.role === 'developer')
  const tailLimit = system ? Math.max(1, maxMessages - 1) : maxMessages
  const tail = messages.slice(-tailLimit)
  if (!system || tail.includes(system)) return tail
  return [system, ...tail]
}

function fitMessagesWithinBudget(messages: Message[], maxChars: number) {
  const selected: Message[] = []
  let remaining = Math.max(1, maxChars)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    const length = contentTextLength(message.content)
    if (length <= remaining) {
      selected.unshift(message)
      remaining -= length
      continue
    }
    // The current user turn is more useful than a strict character ceiling.
    // Keep it, but trim textual fields deterministically instead of issuing an
    // extra summarisation request that would add latency and cost.
    if (selected.length === 0) {
      selected.unshift({ ...message, content: truncateContent(message.content, remaining) })
      remaining = 0
    }
  }
  return selected
}

function truncateContent(content: unknown, maxChars: number): unknown {
  if (typeof content === 'string') return truncateText(content, maxChars)
  if (Array.isArray(content)) {
    let remaining = maxChars
    return content.map((part) => {
      const compacted = truncateContentPart(part, remaining)
      remaining = Math.max(0, remaining - contentTextLength(compacted))
      return compacted
    })
  }
  return truncateContentPart(content, maxChars)
}

function truncateContentPart(part: unknown, maxChars: number): unknown {
  if (typeof part === 'string') return truncateText(part, maxChars)
  if (!isRecord(part)) return part
  const next = { ...part }
  let remaining = maxChars
  for (const key of ['text', 'input_text', 'content']) {
    if (!(key in next)) continue
    const compacted = key === 'content' ? truncateContent(next[key], remaining) : typeof next[key] === 'string' ? truncateText(next[key], remaining) : next[key]
    next[key] = compacted
    remaining = Math.max(0, remaining - contentTextLength(compacted))
  }
  return next
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) return value
  if (maxChars <= truncationMarker.length) return value.slice(0, Math.max(0, maxChars))
  const room = maxChars - truncationMarker.length
  const head = Math.ceil(room * 0.7)
  return `${value.slice(0, head)}${truncationMarker}${value.slice(value.length - (room - head))}`
}

function responseTextLength(request: OpenAiResponsesRequest) {
  return (typeof request.instructions === 'string' ? request.instructions.length : 0)
    + (typeof request.input === 'string' ? request.input.length : Array.isArray(request.input) ? request.input.reduce((total, item) => total + responseItemTextLength(item), 0) : 0)
}

function responseItemTextLength(item: unknown) {
  if (!isRecord(item)) return 0
  return contentTextLength(item.content) + (typeof item.input_text === 'string' ? item.input_text.length : 0) + (typeof item.text === 'string' ? item.text.length : 0)
}

function contentTextLength(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (Array.isArray(content)) return content.reduce((total, part) => total + contentTextLength(part), 0)
  if (!isRecord(content)) return 0
  return (typeof content.text === 'string' ? content.text.length : 0)
    + (typeof content.input_text === 'string' ? content.input_text.length : 0)
    + ('content' in content ? contentTextLength(content.content) : 0)
}

function isMessageItem(item: unknown): item is Record<string, unknown> {
  return isRecord(item) && typeof item.role === 'string' && ('content' in item || 'input_text' in item || 'text' in item)
}

function responseItemToMessage(item: Record<string, unknown>): Message {
  return {
    role: typeof item.role === 'string' ? item.role : 'user',
    content: 'content' in item ? item.content : item.input_text ?? item.text ?? '',
  }
}

function withResponseItemContent(item: Record<string, unknown>, content: unknown) {
  if ('content' in item) return { ...item, content }
  if ('input_text' in item) return { ...item, input_text: content }
  return { ...item, text: content }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
