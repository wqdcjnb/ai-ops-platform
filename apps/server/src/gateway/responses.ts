import type { OpenAiChatRequest } from './openai-compatible.js'

import { z } from 'zod'

// Responses input items are deliberately permissive. Native Responses clients
// send typed items such as `message`, `function_call` and `file_search_call`,
// while the legacy compatibility path only needs role/content pairs.
const responseInputItemSchema = z.record(z.unknown())

export const responsesRequestSchema = z.object({
  model: z.string().trim().min(1).max(128),
  input: z.union([z.string(), z.array(responseInputItemSchema).min(1).max(100)]),
  instructions: z.string().trim().max(20_000).optional(),
  stream: z.boolean().optional().default(false),
  max_output_tokens: z.number().int().positive().max(1_000_000).optional(),
  temperature: z.number().finite().min(0).max(2).optional(),
  top_p: z.number().finite().min(0).max(1).optional(),
}).passthrough()

// CPA may return additional Responses fields (or omit the SDK-only
// `output_text` convenience field). Keep the gateway response transparent so
// Codex clients receive the native payload unchanged.
export const responsesResponseSchema = z.record(z.unknown())

export type ResponsesRequest = z.infer<typeof responsesRequestSchema>

const supportedFields = new Set(['model', 'input', 'instructions', 'stream', 'max_output_tokens', 'temperature', 'top_p'])

export function unsupportedResponseFields(request: ResponsesRequest) {
  return Object.keys(request).filter((key) => !supportedFields.has(key))
}

export function toChatRequest(request: ResponsesRequest, model: string): OpenAiChatRequest {
  const messages: OpenAiChatRequest['messages'] = []
  if (request.instructions) messages.push({ role: 'system', content: request.instructions })
  if (typeof request.input === 'string') {
    messages.push({ role: 'user', content: request.input })
  } else {
    messages.push(...request.input.map((item) => {
      const role = item.role === 'system' || item.role === 'user' || item.role === 'assistant' || item.role === 'tool' ? item.role : 'user'
      const content = item.content ?? item.input_text ?? item
      return { role, content }
    }))
  }
  return {
    model,
    messages,
    ...(request.max_output_tokens ? { max_tokens: request.max_output_tokens } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.top_p === undefined ? {} : { top_p: request.top_p }),
    stream: false,
  }
}

export function toResponsePayload(chat: Record<string, unknown>): Record<string, unknown> {
  const id = typeof chat.id === 'string' ? chat.id : 'chat-completion'
  const created = typeof chat.created === 'number' ? chat.created : Math.floor(Date.now() / 1000)
  const model = typeof chat.model === 'string' ? chat.model : 'unknown'
  const choices = Array.isArray(chat.choices) ? chat.choices : []
  const firstChoice = choices[0]
  const message = isRecord(firstChoice) && isRecord(firstChoice.message) ? firstChoice.message : undefined
  const text = message && typeof message.content === 'string' ? message.content : ''
  return {
    id: `resp_${id}`,
    object: 'response',
    created_at: created,
    model,
    status: 'completed',
    output_text: text,
    output: [{
      id: `msg_${id}`,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    }],
    usage: isRecord(chat.usage) ? chat.usage : null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
