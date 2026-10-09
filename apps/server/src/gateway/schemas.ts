import { z } from 'zod'
import { gatewayModeSchema, gatewayProviderSchema } from '../gateway-config.js'
import { PUBLIC_MODEL_ID } from '../public-model.js'
import type { PlatformDatabase, PlatformGatewayKey } from '../platform-db.js'
import type { GatewayRequestContext, GatewayUpstream } from './openai-compatible.js'

export const gatewayCapabilitiesSchema = z.object({
  models: z.boolean(),
  chatCompletions: z.boolean(),
  responses: z.boolean(),
  media: z.boolean(),
  streaming: z.boolean(),
})

export const gatewayConnectorSchema = z.object({
  id: gatewayModeSchema,
  label: z.string(),
  environment: z.enum(['production', 'experiment']),
  configured: z.boolean(),
})

export const gatewayHealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('ai-ops-gateway'),
  mode: gatewayModeSchema,
  provider: gatewayProviderSchema,
  connector: gatewayConnectorSchema,
  upstreamConfigured: z.boolean(),
  capabilities: gatewayCapabilitiesSchema,
  requestId: z.string(),
})

export const gatewayUpstreamHealthResponseSchema = z.object({
  status: z.enum(['healthy', 'empty', 'unconfigured', 'auth_required', 'offline', 'timeout', 'error']),
  mode: gatewayModeSchema,
  modelCount: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative().nullable(),
  requestId: z.string(),
})

export const gatewayConfigResponseSchema = z.object({
  mode: gatewayModeSchema,
  connector: gatewayConnectorSchema,
  upstream: z.object({
    provider: gatewayProviderSchema,
    configured: z.boolean(),
  }),
  routing: z.object({ publicModel: z.literal(PUBLIC_MODEL_ID) }),
  streaming: z.object({
    defaultEnabled: z.boolean(),
    passthrough: z.literal(true),
  }),
  context: z.object({
    enabled: z.boolean(),
    maxInputChars: z.number().int().positive(),
    maxMessages: z.number().int().positive(),
  }),
  capabilities: gatewayCapabilitiesSchema,
  requestId: z.string(),
})

export const gatewayErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string(),
    requestId: z.string(),
  }),
})

export const chatMessageSchema = z.object({
  // `developer` is the role newer OpenAI-compatible clients emit for system-level
  // instructions; accept it alongside the classic `system` role.
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  // OpenAI-compatible clients frequently send `content: null` or omit `content`
  // entirely on assistant messages that only carry tool_calls. Accept both and
  // normalise them to an empty string before the request reaches the upstream.
  content: z
    .union([z.string(), z.array(z.unknown()), z.null()])
    .optional()
    .transform((value) => value ?? ''),
}).passthrough()

export const chatCompletionRequestSchema = z.object({
  model: z.string().trim().min(1).max(128),
  // Agent clients replay full conversation history on every turn. A 100-message
  // ceiling breaks long sessions well before the upstream context window does,
  // so let the upstream decide where the real limit is.
  messages: z.array(chatMessageSchema).min(1).max(2_000),
  stream: z.boolean().optional(),
  temperature: z.number().finite().min(0).max(2).optional(),
  top_p: z.number().finite().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().max(1_000_000).optional(),
  max_completion_tokens: z.number().int().positive().max(1_000_000).optional(),
  stop: z.union([z.string(), z.array(z.string()).max(16)]).optional(),
  user: z.string().trim().max(512).optional(),
}).passthrough()

export const chatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.string(),
  created: z.number().int().nonnegative(),
  model: z.string(),
  choices: z.array(z.unknown()),
}).passthrough()

export const mediaRequestSchema = z.object({
  // OpenAI-compatible image/video/audio clients do not always send a model.
  // The public contract still has exactly one virtual model, so default it
  // here rather than leaking a relay-specific default to the client.
  model: z.string().trim().min(1).max(128).optional().default(PUBLIC_MODEL_ID),
}).passthrough()

export const mediaResponseSchema = z.object({}).passthrough()

export const gatewayModelsResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(z.object({
    id: z.string(),
    object: z.literal('model'),
    created: z.number().int().nonnegative(),
    owned_by: z.string(),
  })),
})


export interface GatewayRouteOptions {
  runtime?: import('../runtime-coordinator.js').RuntimeCoordinator
  upstream?: GatewayUpstream
  database?: PlatformDatabase
  /** True when the secure third-party provider registry has routable models. */
  hasExternalModels?: () => boolean
  /** The virtual relay model uses native Responses when supported upstream. */
  supportsNativeResponses?: (model: string) => boolean
}

export interface GatewayAuditHandle {
  database: PlatformDatabase
  requestId: string
  recordId: string
  startedAt: number
  chunks: unknown[]
  chunkBytes: number
  truncated: boolean
  checkpoint: Promise<void> | null
  lastCheckpoint: number
}

export type GatewayAuthorization = { key: PlatformGatewayKey | null; upstreamContext?: GatewayRequestContext }
