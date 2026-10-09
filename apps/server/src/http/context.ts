import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { AuthService } from '../auth.js'
import type { ExternalProviderRegistry } from '../external-providers.js'
import type { ExternalProviderGatewayUpstream } from '../gateway/external-provider-upstream.js'
import type { GatewayConfig } from '../gateway-config.js'
import type { PlatformDatabase } from '../platform-db.js'
import type { RuntimeCoordinator } from '../runtime-coordinator.js'
import type { PlatformKeyService } from '../platform-keys.js'

/** The Fastify instance shape produced by `buildApp`, after the zod type provider is attached. */
export type AppInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>

export type AuthMode = 'required' | 'disabled'

export interface BuildAppOptions {
  logger?: boolean
  authMode?: AuthMode
  authService?: AuthService
  database?: PlatformDatabase
  databasePath?: string
  gatewayConfig?: GatewayConfig
  gatewayUpstream?: import('../gateway/openai-compatible.js').GatewayUpstream
  externalProviderRegistry?: ExternalProviderRegistry
}

export interface AuthenticationAuditInput {
  actorUserId?: string | null
  action: 'login' | 'logout' | 'access'
  result: 'success' | 'failed' | 'denied'
  requestId: string
  code: string
  message: string
}

/**
 * Everything a route group is allowed to reach for. Route modules destructure
 * what they need, so moving a route between modules never changes behaviour.
 */
export interface ApiRouteContext {
  app: AppInstance
  options: BuildAppOptions
  database: PlatformDatabase
  auth: AuthService
  authMode: AuthMode
  runtime: RuntimeCoordinator
  gatewayConfig: GatewayConfig
  gatewayUpstream: ExternalProviderGatewayUpstream
  externalProviderRegistry: ExternalProviderRegistry
  recordAuthenticationAudit: (input: AuthenticationAuditInput) => Promise<void>
  keys: PlatformKeyService
}
