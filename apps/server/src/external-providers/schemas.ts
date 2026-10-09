import { z } from 'zod'
import type { } from '../gateway-config.js'
import type { PostgresDatabase } from '../postgres.js'
/** A short, stable ID is deliberately used instead of accepting arbitrary URLs
 * as a model identifier.  It makes allow-listing, auditing and key policy
 * enforceable at the AI OPS boundary. */
export const externalProviderIdSchema = z.string().trim().regex(/^[a-z][a-z0-9-]{0,31}$/, '供应商 ID 只能包含小写字母、数字和连字符').max(32)
export const externalProviderModelIdSchema = z.string().trim().min(1).max(160).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), '模型 ID 不能包含控制字符')
export const externalProviderModalitySchema = z.enum(['text', 'image', 'video', 'audio'])
export type ExternalProviderModality = z.infer<typeof externalProviderModalitySchema>

export const externalProviderInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().url().max(512),
  /** Optional on update. The existing encrypted credential is retained. */
  apiKey: z.string().trim().min(1).max(2_048).optional(),
  /** The administrator selects a validated subset of the discovered catalog. */
  modelIds: z.array(externalProviderModelIdSchema).max(10_000).optional().default([]),
  enabled: z.boolean().default(true),
})

/**
 * Built-in provider presets are a convenience layer, not an arbitrary URL
 * bypass. Each preset contributes one reviewed HTTPS host to the same
 * server-side allow-list used by custom providers.
 */
export const externalProviderPresetSchema = z.object({
  id: externalProviderIdSchema,
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().max(512),
  host: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(240),
})

export const externalProviderModelSchema = z.object({
  id: z.string().min(1).max(128),
  upstreamId: externalProviderModelIdSchema,
})

export const externalProviderPublicSchema = z.object({
  id: externalProviderIdSchema,
  name: z.string(),
  baseUrl: z.string().url(),
  host: z.string(),
  enabled: z.boolean(),
  credentialConfigured: z.boolean(),
  models: z.array(externalProviderModelSchema),
  health: z.enum(['healthy', 'unknown', 'error']),
  lastCheckedAt: z.string().datetime().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  lastSyncedAt: z.string().datetime().nullable(),
  lastSyncError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type ExternalProviderInput = z.infer<typeof externalProviderInputSchema>
export type ExternalProviderPublic = z.infer<typeof externalProviderPublicSchema>
export type ExternalProviderPreset = z.infer<typeof externalProviderPresetSchema>

export type ExternalProviderModelTestStatus = 'available' | 'catalog_confirmed' | 'unavailable'

export interface ExternalProviderModelTestResult {
  id: string
  status: ExternalProviderModelTestStatus
  latencyMs: number | null
  message: string
}

export interface ExternalProviderModelTestReport {
  catalogLatencyMs: number
  results: ExternalProviderModelTestResult[]
}

export interface PersistedExternalProviderModel {
  upstreamId: string
  publicId: string
  /** Internal routing information. It is intentionally not exposed as an
   * employee-facing catalog capability because a bare /models catalog does
   * not always provide authoritative capability metadata. */
  modalities: ExternalProviderModality[]
}

export interface PersistedExternalProvider {
  id: string
  name: string
  baseUrl: string
  /** AES-GCM ciphertext; the clear-text credential never reaches disk. */
  apiKey: string
  enabled: boolean
  models: PersistedExternalProviderModel[]
  health: 'healthy' | 'unknown' | 'error'
  lastCheckedAt: string | null
  latencyMs: number | null
  lastSyncedAt: string | null
  lastSyncError: string | null
  createdAt: string
  updatedAt: string
}

export interface PersistedExternalProviders {
  version: 1
  providers: PersistedExternalProvider[]
  updatedAt: string
}

export const persistedModelSchema = z.object({
  upstreamId: externalProviderModelIdSchema,
  publicId: z.string().trim().min(1).max(128),
  // Existing provider files predate modality-aware routing. Defaulting them
  // to text keeps their established Chat/Responses behaviour intact.
  modalities: z.array(externalProviderModalitySchema).min(1).max(4).default(['text']),
})

export const persistedProviderSchema = z.object({
  id: externalProviderIdSchema,
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().max(512),
  apiKey: z.string().trim().min(1),
  enabled: z.boolean(),
  models: z.array(persistedModelSchema).max(10_000),
  health: z.enum(['healthy', 'unknown', 'error']).default('unknown'),
  lastCheckedAt: z.string().datetime().nullable().default(null),
  latencyMs: z.number().int().nonnegative().nullable().default(null),
  lastSyncedAt: z.string().datetime().nullable().default(null),
  lastSyncError: z.string().max(240).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const persistedStateSchema = z.object({
  version: z.literal(1),
  providers: z.array(persistedProviderSchema).max(10_000),
  updatedAt: z.string().datetime(),
})

export interface ExternalProviderRoute {
  providerId: string
  providerName: string
  baseUrl: string
  apiKey: string
  upstreamModelId: string
  publicModelId: string
  modalities: ExternalProviderModality[]
}

export interface ExternalProviderGatewayModel {
  id: string
  providerId: string
  providerName: string
  upstreamId: string
}

export type ExternalProviderErrorCode =
  | 'EXTERNAL_PROVIDER_URL_INVALID'
  | 'EXTERNAL_PROVIDER_HOST_NOT_ALLOWED'
  | 'EXTERNAL_PROVIDER_INSECURE_URL'
  | 'EXTERNAL_PROVIDER_KEY_REQUIRED'
  | 'EXTERNAL_PROVIDER_NOT_FOUND'
  | 'EXTERNAL_PROVIDER_CREDENTIAL_INVALID'
  | 'EXTERNAL_PROVIDER_TIMEOUT'
  | 'EXTERNAL_PROVIDER_UNAVAILABLE'
  | 'EXTERNAL_PROVIDER_MODEL_NOT_DISCOVERED'
  | 'EXTERNAL_PROVIDER_STORE_FAILED'

export class ExternalProviderError extends Error {
  constructor(readonly code: ExternalProviderErrorCode, message: string, readonly statusCode: 400 | 404 | 502 | 504 = 400) {
    super(message)
    this.name = 'ExternalProviderError'
  }
}

export interface ExternalProviderRegistryOptions {
  database: PostgresDatabase
  filePath?: string
  env?: NodeJS.ProcessEnv
  /**
   * Optional exact host restriction, without scheme or path. When omitted or
   * empty, an administrator can connect any public HTTPS service. Supplying a
   * list turns it into a deployment-level restriction; `*` keeps custom
   * public services enabled.
   */
  allowedHosts?: Iterable<string>
  /** Intended for test/dev loopback endpoints only. Production endpoints remain HTTPS-only. */
  allowInsecureLoopback?: boolean
}

export interface ExternalProviderDiscovery {
  models: string[]
  baseUrl: string
  latencyMs: number
  modalitiesByModel: Map<string, ExternalProviderModality[]>
}
