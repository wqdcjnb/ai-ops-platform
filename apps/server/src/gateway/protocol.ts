import type { } from 'fastify'

/**
 * Some clients send a second model request solely to generate a new local
 * conversation title. It is a client-internal UI operation, not an employee
 * conversation turn, so it must not create a row in the conversation audit.
 */
export function isInternalTopicTitleRequest(body: unknown) {
  if(!body || typeof body !== 'object' || Array.isArray(body)) return false
  const request = body as Record<string, unknown>
  const metadata = request.metadata && typeof request.metadata === 'object' && !Array.isArray(request.metadata)
    ? request.metadata as Record<string, unknown>
    : null
  const isNewTopic = request.isNewTopic === true || metadata?.isNewTopic === true
  const hasTitle = typeof request.title === 'string' || typeof metadata?.title === 'string'
  if(isNewTopic && hasTitle) return true
  if(isCodexThreadTitleRequest(request.client_metadata)) return true

  // Some desktop clients generate a local conversation title through an
  // ordinary model call. They put the protocol in a system/developer prompt
  // instead of top-level request metadata, then expect a JSON object with
  // `isNewTopic` and `title`. That call must not become a second employee
  // conversation in the audit list. Only inspect privileged instructions so a
  // user discussing those field names in a normal chat remains auditable.
  const instructions = [
    request.instructions,
    ...protocolMessages(request.messages),
    ...protocolMessages(request.input),
  ]
  return instructions.some((value) => isTopicTitleProtocol(value))
}

export function isCodexThreadTitleRequest(value: unknown) {
  if(!value || typeof value !== 'object' || Array.isArray(value)) return false
  const metadata = value as Record<string, unknown>
  const turnMetadata = parseJsonRecord(metadata['x-codex-turn-metadata'])
  return turnMetadata?.turn_trigger === 'thread_title' || turnMetadata?.thread_source === 'thread_title'
}

export function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if(value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if(typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function protocolMessages(value: unknown) {
  if(!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if(!item || typeof item !== 'object' || Array.isArray(item)) return []
    const message = item as Record<string, unknown>
    if(message.role !== 'system' && message.role !== 'developer') return []
    return [messageText(message.content)]
  })
}

export function messageText(value: unknown): string {
  if(typeof value === 'string') return value
  if(!Array.isArray(value)) return ''
  return value.map((item) => {
    if(!item || typeof item !== 'object' || Array.isArray(item)) return ''
    const part = item as Record<string, unknown>
    return typeof part.text === 'string'
      ? part.text
      : typeof part.input_text === 'string'
        ? part.input_text
        : typeof part.content === 'string'
          ? part.content
          : ''
  }).join('\n')
}

export function isTopicTitleProtocol(value: unknown) {
  if(typeof value !== 'string') return false
  return /\bisNewTopic\b/u.test(value) && /\btitle\b/iu.test(value) && /\bjson\b/iu.test(value)
}

export function groupingForBody(body: unknown): { type: 'conversation' | 'independent_call'; label: string } {
  if(body && typeof body === 'object') {
    const value = body as Record<string, unknown>
    const candidate = value.conversation_id ?? value.conversationId ?? (value.metadata && typeof value.metadata === 'object' ? (value.metadata as Record<string, unknown>).conversation_id : undefined)
    if(typeof candidate === 'string' && candidate.trim()) return { type: 'conversation', label: `会话 ${candidate.trim().slice(0, 120)}` }
  }
  return { type: 'independent_call', label: '独立调用' }
}
