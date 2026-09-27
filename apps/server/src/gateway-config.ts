import { z } from 'zod'

/**
 * The product has one data plane: the managed relay-account gateway. Relay
 * credentials live in the encrypted third-party-account registry, never in
 * process-wide gateway environment variables.
 */
export const gatewayModeSchema = z.literal('relay')
export const gatewayProviderSchema = z.literal('openai_compatible')

const rawGatewayConfigSchema = z.object({
  defaultStreaming: z.boolean().default(false),
  contextOptimizationEnabled: z.boolean().default(true),
  contextMaxInputChars: z.number().int().min(4_000).max(1_000_000).optional(),
  contextMaxMessages: z.number().int().min(1).max(2_000).optional(),
  timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
})

export type GatewayMode = z.infer<typeof gatewayModeSchema>
export type GatewayProvider = z.infer<typeof gatewayProviderSchema>

export interface GatewayConfig {
  mode: GatewayMode
  provider: GatewayProvider
  /** These values are populated only for a short-lived, server-side relay adapter. */
  baseUrl?: string
  upstreamApiKey?: string
  /** Maximum time to wait for a single relay request, including a stream. */
  timeoutMs: number
  /** Use SSE when a compatible client does not send an explicit stream flag. */
  defaultStreaming: boolean
  /** Controls bounded history replay without altering the client’s saved conversation. */
  context: {
    enabled: boolean
    maxInputChars: number
    maxMessages: number
  }
  /** True only on a short-lived adapter constructed from an enabled relay account. */
  upstreamConfigured: boolean
}

function optionalValue(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const configuredMode = optionalValue(env.AI_OPS_GATEWAY_MODE)
  if (configuredMode && configuredMode !== 'relay') {
    throw new Error('AI_OPS_GATEWAY_MODE 仅支持 relay；请将上游凭据迁移到第三方账号管理。')
  }

  const result = rawGatewayConfigSchema.safeParse({
    defaultStreaming: parseBooleanEnv(env.AI_OPS_GATEWAY_DEFAULT_STREAMING),
    contextOptimizationEnabled: parseBooleanEnv(env.AI_OPS_CONTEXT_OPTIMIZATION_ENABLED),
    contextMaxInputChars: parseIntegerEnv(env.AI_OPS_CONTEXT_MAX_INPUT_CHARS),
    contextMaxMessages: parseIntegerEnv(env.AI_OPS_CONTEXT_MAX_MESSAGES),
    timeoutMs: parseTimeoutEnv(env.AI_OPS_GATEWAY_TIMEOUT_MS),
  })

  if (!result.success) {
    const details = result.error.issues.map((issue) => issue.path.join('.') || 'config').join(', ')
    throw new Error(`AI_OPS_GATEWAY configuration is invalid: ${details}`)
  }

  const { defaultStreaming, contextOptimizationEnabled, contextMaxInputChars, contextMaxMessages, timeoutMs } = result.data
  return {
    mode: 'relay',
    provider: 'openai_compatible',
    timeoutMs: timeoutMs ?? 60_000,
    defaultStreaming,
    context: {
      enabled: contextOptimizationEnabled,
      maxInputChars: contextMaxInputChars ?? 48_000,
      maxMessages: contextMaxMessages ?? 24,
    },
    // A process-global upstream is intentionally never configured. Requests
    // route through the encrypted, enabled third-party accounts instead.
    upstreamConfigured: false,
  }
}

function parseTimeoutEnv(value: string | undefined) {
  const normalized = optionalValue(value)
  if (!normalized) return undefined
  const parsed = Number(normalized)
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 600_000) {
    throw new Error('AI_OPS_GATEWAY configuration is invalid: timeoutMs')
  }
  return parsed
}

function parseIntegerEnv(value: string | undefined) {
  const normalized = optionalValue(value)
  if (!normalized) return undefined
  return Number(normalized)
}

function parseBooleanEnv(value: string | undefined) {
  const normalized = optionalValue(value)
  if (!normalized) return undefined
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error('AI_OPS_GATEWAY configuration is invalid: expected a boolean value')
}
