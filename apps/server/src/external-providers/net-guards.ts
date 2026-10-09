import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { GatewayUpstreamError } from '../gateway/openai-compatible.js'
import { externalProviderModelIdSchema } from './schemas.js'
export function defaultExternalProvidersPath(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.AI_OPS_EXTERNAL_PROVIDERS_FILE?.trim()
  if(configured) return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
  const databasePath = env.PLATFORM_DB_PATH?.trim()
  if(databasePath && databasePath !== ':memory:') return join(dirname(resolve(databasePath)), 'external-providers.json')
  return resolve(process.cwd(), 'data', 'external-providers.json')
}

export function hostsFromEnvironment(env: NodeJS.ProcessEnv) {
  return (env.AI_OPS_EXTERNAL_PROVIDER_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

export function isLoopbackHost(host: string) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '::1' || normalized === '127.0.0.1'
}

export function isPrivateIpv4(host: string) {
  const parts = host.split('.').map((part) => Number(part))
  if(parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const first = parts[0]
  const second = parts[1]
  if(first === undefined || second === undefined) return false
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0)
}

/** Reject endpoints that are unequivocally local/reserved before a server-side
 * credentials-bearing request is made. DNS/egress restrictions remain the
 * deployment's second line of defence for hostnames. */
export function isPrivateOrReservedHost(host: string) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '')
  if(isLoopbackHost(normalized) || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true

  const version = isIP(normalized)
  if(version === 4) return isPrivateIpv4(normalized)
  if(version !== 6) return false

  if(normalized === '::' || normalized === '::1') return true
  if(/^(?:fc|fd|fe[89ab])/i.test(normalized)) return true
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]
  return Boolean(mappedIpv4 && isPrivateIpv4(mappedIpv4))
}

/** Candidate API roots used by popular OpenAI-compatible relays. The working
 * root is retained for later model requests once discovery succeeds. */
export function catalogBaseCandidates(baseUrl: string) {
  const parsed = new URL(baseUrl)
  const existingPath = parsed.pathname.replace(/\/+$/, '')
  const candidates = [baseUrl]
  const appendPath = (suffix: string) => {
    const next = new URL(parsed.toString())
    next.pathname = `${existingPath || ''}${suffix}`.replace(/\/+/g, '/')
    const value = next.toString().replace(/\/$/, '')
    if(!candidates.includes(value)) candidates.push(value)
  }

  // When an administrator enters only the service origin, probe the most
  // common OpenAI-compatible roots in a bounded order. A path that already
  // carries an API version remains unchanged.
  if(!/(?:^|\/)(?:api\/)?v\d+$/i.test(existingPath)) {
    appendPath('/v1')
    appendPath('/api/v1')
    appendPath('/api')
  }
  return candidates
}

export function shouldTryNextCatalogRoot(error: unknown) {
  return error instanceof GatewayUpstreamError
    && ['GATEWAY_UPSTREAM_NOT_FOUND', 'GATEWAY_UPSTREAM_INVALID_RESPONSE', 'GATEWAY_UPSTREAM_ERROR'].includes(error.code)
}

export function publicModelId(providerId: string, upstreamId: string) {
  const readable = upstreamId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'model'
  const fingerprint = createHash('sha256').update(upstreamId).digest('hex').slice(0, 10)
  return `external-${providerId}-${readable}-${fingerprint}`
}

export function normalizeModelIds(values: readonly string[]) {
  return [...new Set(values.map((value) => externalProviderModelIdSchema.parse(value)))]
}
