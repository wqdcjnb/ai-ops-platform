import { z } from 'zod'

export const gatewayModeSchema = z.enum(['standalone', 'new_api', 'cpa'])
export const gatewayProviderSchema = z.enum(['openai_compatible', 'ollama'])

const rawGatewayConfigSchema = z.object({
  mode: gatewayModeSchema.default('standalone'),
  provider: gatewayProviderSchema.default('openai_compatible'),
  baseUrl: z.string().trim().url().optional(),
  apiKey: z.string().trim().min(1).optional(),
  newApiBaseUrl: z.string().trim().url().optional(),
  newApiApiKey: z.string().trim().min(1).optional(),
  cpaBaseUrl: z.string().trim().url().optional(),
  cpaApiKey: z.string().trim().min(1).optional(),
  clientApiKey: z.string().trim().min(1).optional(),
  defaultModel: z.string().trim().min(1).optional(),
  fallbackModel: z.string().trim().min(1).optional(),
  allowFallback: z.boolean().default(false),
  modelAliases: z.record(z.string().trim().min(1), z.string().trim().min(1)).default({}),
})

export type GatewayMode = z.infer<typeof gatewayModeSchema>
export type GatewayProvider = z.infer<typeof gatewayProviderSchema>

export interface GatewayConfig {
  mode: GatewayMode
  provider: GatewayProvider
  baseUrl?: string
  /** Server-only credential used for the configured upstream. Never serialize this field. */
  upstreamApiKey?: string
  /** Legacy P02 client credential kept only for backwards compatibility. */
  clientApiKey?: string
  defaultModel?: string
  fallbackModel?: string
  allowFallback: boolean
  modelAliases: Record<string, string>
  upstreamConfigured: boolean
}

function optionalValue(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const result = rawGatewayConfigSchema.safeParse({
    mode: optionalValue(env.AI_OPS_GATEWAY_MODE),
    provider: optionalValue(env.AI_OPS_GATEWAY_PROVIDER),
    baseUrl: optionalValue(env.AI_OPS_GATEWAY_UPSTREAM_BASE_URL),
    apiKey: optionalValue(env.AI_OPS_GATEWAY_UPSTREAM_API_KEY),
    newApiBaseUrl: optionalValue(env.AI_OPS_GATEWAY_NEW_API_BASE_URL),
    newApiApiKey: optionalValue(env.AI_OPS_GATEWAY_NEW_API_API_KEY),
    cpaBaseUrl: optionalValue(env.AI_OPS_GATEWAY_CPA_BASE_URL),
    cpaApiKey: optionalValue(env.AI_OPS_GATEWAY_CPA_API_KEY),
    clientApiKey: optionalValue(env.AI_OPS_GATEWAY_CLIENT_API_KEY),
    defaultModel: optionalValue(env.AI_OPS_GATEWAY_DEFAULT_MODEL),
    fallbackModel: optionalValue(env.AI_OPS_GATEWAY_FALLBACK_MODEL),
    allowFallback: parseBooleanEnv(env.AI_OPS_GATEWAY_ALLOW_FALLBACK),
    modelAliases: parseModelAliases(env.AI_OPS_GATEWAY_MODEL_ALIASES),
  })

  if (!result.success) {
    const details = result.error.issues.map((issue) => issue.path.join('.') || 'config').join(', ')
    throw new Error(`AI_OPS_GATEWAY configuration is invalid: ${details}`)
  }

  const { mode, provider, baseUrl, apiKey, newApiBaseUrl, newApiApiKey, cpaBaseUrl, cpaApiKey, clientApiKey, defaultModel, fallbackModel, allowFallback, modelAliases } = result.data
  const selectedBaseUrl = baseUrl ?? (mode === 'new_api' ? newApiBaseUrl : mode === 'cpa' ? cpaBaseUrl : undefined)
  const selectedApiKey = apiKey ?? (mode === 'new_api' ? newApiApiKey : mode === 'cpa' ? cpaApiKey : undefined)
  return {
    mode,
    provider,
    baseUrl: selectedBaseUrl,
    upstreamApiKey: selectedApiKey,
    clientApiKey,
    defaultModel,
    fallbackModel,
    allowFallback,
    modelAliases,
    // The credential is deliberately not returned. This flag is only for safe startup diagnostics.
    upstreamConfigured: Boolean(selectedBaseUrl && (provider === 'ollama' || selectedApiKey)),
  }
}

function parseBooleanEnv(value: string | undefined) {
  const normalized = optionalValue(value)
  if (!normalized) return undefined
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error('AI_OPS_GATEWAY configuration is invalid: allowFallback')
}

function parseModelAliases(value: string | undefined) {
  const normalized = value?.trim()
  if (!normalized) return {}
  const aliases: Record<string, string> = {}
  for (const entry of normalized.split(',')) {
    const [alias, target, ...extra] = entry.split('=').map((part) => part.trim())
    if (!alias || !target || extra.length > 0) throw new Error('AI_OPS_GATEWAY configuration is invalid: modelAliases')
    aliases[alias] = target
  }
  return aliases
}
