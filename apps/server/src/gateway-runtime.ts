import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { decryptPlatformApiKey, encryptPlatformApiKey } from './platform-db.js'
import type { GatewayConfig, GatewayMode } from './gateway-config.js'
import { normalizeCpaManagementBaseUrl } from './cpa-management.js'

const credentialSchema = z.object({
  baseUrl: z.string().trim().url().max(512),
  apiKey: z.string().trim().min(1).max(512),
})

const cpaCredentialSchema = credentialSchema.extend({
  managementBaseUrl: z.string().trim().url().max(512).optional(),
  managementKey: z.string().trim().min(1).max(2_048).optional(),
})

const newApiCredentialSchema = credentialSchema.extend({
  managementBaseUrl: z.string().trim().url().max(512).optional(),
  managementToken: z.string().trim().max(2_048).optional(),
})

/**
 * CPA and New API are not alternative upstreams in this product. CPA owns the
 * OAuth account pool; New API exposes that pool as the employee-facing API.
 * Keep both halves in one atomic configuration payload so the UI cannot
 * accidentally switch one connector off while configuring the other.
 */
export const gatewayCredentialInputSchema = z.object({
  cpa: cpaCredentialSchema,
  newApi: newApiCredentialSchema,
})

/** CPA-only configuration used by the 上游账号 page. New API is configured
 * with the model/catalog integration and is intentionally not mixed into this
 * account-pool workflow. */
export const cpaCredentialInputSchema = cpaCredentialSchema

export type GatewayCredentialInput = z.infer<typeof gatewayCredentialInputSchema>
export type CpaCredentialInput = z.infer<typeof cpaCredentialInputSchema>

interface PersistedConnector {
  baseUrl: string
  apiKey: string
  managementBaseUrl?: string
  managementKey?: string
  managementToken?: string
}

interface PersistedGatewayRuntime {
  version: 2
  mode: GatewayMode
  connectors: Partial<Record<'cpa' | 'new_api', PersistedConnector>>
  updatedAt: string
}

export interface GatewayCredentialCheck {
  status: 'healthy' | 'empty'
  modelCount: number
  latencyMs: number
}

export function normalizeGatewayUrl(value: string) {
  const url = new URL(value.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('上游地址必须使用 HTTP 或 HTTPS')
  return url.toString().replace(/\/$/, '')
}

function defaultRuntimePath(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.AI_OPS_GATEWAY_RUNTIME_FILE?.trim()
  if (configured) return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
  const databasePath = env.PLATFORM_DB_PATH?.trim()
  if (databasePath && databasePath !== ':memory:') return join(dirname(resolve(databasePath)), 'gateway-runtime.json')
  return resolve(process.cwd(), 'data', 'gateway-runtime.json')
}

function readRuntimeFile(filePath: string): PersistedGatewayRuntime | null {
  if (!existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { version?: number; mode?: GatewayMode; connectors?: PersistedGatewayRuntime['connectors']; updatedAt?: string }
    if ((parsed.version !== 1 && parsed.version !== 2) || (parsed.mode !== 'cpa' && parsed.mode !== 'new_api') || !parsed.connectors || typeof parsed.connectors !== 'object') return null
    return { ...parsed, version: 2 } as PersistedGatewayRuntime
  } catch {
    return null
  }
}

function setOrDelete(env: NodeJS.ProcessEnv, key: string, value: string | undefined) {
  if (value) env[key] = value
  else delete env[key]
}

function managementBaseForGateway(value: string) {
  return value.replace(/\/v1\/?$/, '')
}

/**
 * Owns the small amount of mutable connection state needed by the in-app
 * credential flow. The secret fields are encrypted before they touch disk;
 * callers only receive a redacted status object.
 */
export class GatewayRuntimeStore {
  readonly filePath: string

  constructor(filePath = defaultRuntimePath()) {
    this.filePath = filePath
  }

  applyToEnvironment(env: NodeJS.ProcessEnv = process.env) {
    const state = readRuntimeFile(this.filePath)
    if (!state) return
    // Employee traffic always uses New API when the pipeline has both sides.
    // Keep the old CPA-only runtime readable for deployments upgrading from
    // the first credential drawer.
    env.AI_OPS_GATEWAY_MODE = state.connectors.new_api ? 'new_api' : state.mode
    const cpa = state.connectors.cpa
    if (cpa) {
      env.AI_OPS_GATEWAY_CPA_BASE_URL = cpa.baseUrl
      const apiKey = decryptPlatformApiKey(cpa.apiKey)
      if (apiKey) env.AI_OPS_GATEWAY_CPA_API_KEY = apiKey
      if (cpa.managementBaseUrl) env.CPA_MANAGEMENT_URL = cpa.managementBaseUrl
      const managementKey = cpa.managementKey ? decryptPlatformApiKey(cpa.managementKey) : null
      if (managementKey) env.CPA_MANAGEMENT_KEY = managementKey
    }
    const newApi = state.connectors.new_api
    if (newApi) {
      env.AI_OPS_GATEWAY_NEW_API_BASE_URL = newApi.baseUrl
      const apiKey = decryptPlatformApiKey(newApi.apiKey)
      if (apiKey) env.AI_OPS_GATEWAY_NEW_API_API_KEY = apiKey
      if (newApi.managementBaseUrl) env.NEW_API_BASE_URL = newApi.managementBaseUrl
      const managementToken = newApi.managementToken ? decryptPlatformApiKey(newApi.managementToken) : null
      if (managementToken) env.NEW_API_ACCESS_TOKEN = managementToken
    }
  }

  applyToProcessEnvironment() { this.applyToEnvironment(process.env) }

  persist(input: GatewayCredentialInput) {
    const existing = readRuntimeFile(this.filePath)
    const cpaBaseUrl = normalizeGatewayUrl(input.cpa.baseUrl)
    const newApiBaseUrl = normalizeGatewayUrl(input.newApi.baseUrl)
    const existingNewApi = existing?.connectors.new_api
    const newApiManagementBaseUrl = normalizeGatewayUrl(input.newApi.managementBaseUrl || managementBaseForGateway(newApiBaseUrl))
    const newApiManagementToken = input.newApi.managementToken?.trim()
    const next: PersistedGatewayRuntime = {
      version: 2,
      mode: 'new_api',
      connectors: {
        cpa: { baseUrl: cpaBaseUrl, apiKey: encryptPlatformApiKey(input.cpa.apiKey), ...(input.cpa.managementBaseUrl ? { managementBaseUrl: normalizeCpaManagementBaseUrl(input.cpa.managementBaseUrl) } : {}), ...(input.cpa.managementKey?.trim() ? { managementKey: encryptPlatformApiKey(input.cpa.managementKey) } : existing?.connectors.cpa?.managementKey ? { managementKey: existing.connectors.cpa.managementKey } : {}) },
        new_api: {
          baseUrl: newApiBaseUrl,
          apiKey: encryptPlatformApiKey(input.newApi.apiKey),
          managementBaseUrl: newApiManagementBaseUrl,
          ...(newApiManagementToken ? { managementToken: encryptPlatformApiKey(newApiManagementToken) } : existingNewApi?.managementToken ? { managementToken: existingNewApi.managementToken } : {}),
        },
      },
      updatedAt: new Date().toISOString(),
    }
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(next, null, 2), 'utf8')
    renameSync(temporaryPath, this.filePath)
  }

  persistCpa(input: CpaCredentialInput) {
    const existing = readRuntimeFile(this.filePath)
    const cpaBaseUrl = normalizeGatewayUrl(input.baseUrl)
    const managementBaseUrl = normalizeCpaManagementBaseUrl(input.managementBaseUrl || process.env.CPA_MANAGEMENT_URL || cpaBaseUrl)
    const managementKey = input.managementKey?.trim()
    const existingCpa = existing?.connectors.cpa
    const next: PersistedGatewayRuntime = {
      version: 2,
      mode: existing?.connectors.new_api ? 'new_api' : 'cpa',
      connectors: {
        ...(existing?.connectors ?? {}),
        cpa: {
          baseUrl: cpaBaseUrl,
          apiKey: encryptPlatformApiKey(input.apiKey),
          managementBaseUrl,
          ...(managementKey ? { managementKey: encryptPlatformApiKey(managementKey) } : existingCpa?.managementKey ? { managementKey: existingCpa.managementKey } : {}),
        },
      },
      updatedAt: new Date().toISOString(),
    }
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(next, null, 2), 'utf8')
    renameSync(temporaryPath, this.filePath)
  }

  applyCpaInput(input: CpaCredentialInput) {
    const cpaBaseUrl = normalizeGatewayUrl(input.baseUrl)
    const managementBaseUrl = normalizeCpaManagementBaseUrl(input.managementBaseUrl || process.env.CPA_MANAGEMENT_URL || cpaBaseUrl)
    process.env.AI_OPS_GATEWAY_CPA_BASE_URL = cpaBaseUrl
    process.env.AI_OPS_GATEWAY_CPA_API_KEY = input.apiKey.trim()
    process.env.CPA_MANAGEMENT_URL = managementBaseUrl
    if (input.managementKey?.trim()) process.env.CPA_MANAGEMENT_KEY = input.managementKey.trim()
  }

  applyInput(input: GatewayCredentialInput, config: GatewayConfig) {
    const cpaBaseUrl = normalizeGatewayUrl(input.cpa.baseUrl)
    const newApiBaseUrl = normalizeGatewayUrl(input.newApi.baseUrl)
    config.mode = 'new_api'
    config.provider = 'openai_compatible'
    config.baseUrl = newApiBaseUrl
    config.upstreamApiKey = input.newApi.apiKey.trim()
    config.upstreamConfigured = true

    process.env.AI_OPS_GATEWAY_MODE = 'new_api'
    process.env.AI_OPS_GATEWAY_CPA_BASE_URL = cpaBaseUrl
    process.env.AI_OPS_GATEWAY_CPA_API_KEY = input.cpa.apiKey.trim()
    process.env.AI_OPS_GATEWAY_NEW_API_BASE_URL = newApiBaseUrl
    process.env.AI_OPS_GATEWAY_NEW_API_API_KEY = input.newApi.apiKey.trim()
    process.env.NEW_API_BASE_URL = normalizeGatewayUrl(input.newApi.managementBaseUrl || managementBaseForGateway(newApiBaseUrl))
    if (input.newApi.managementToken?.trim()) process.env.NEW_API_ACCESS_TOKEN = input.newApi.managementToken.trim()
  }
}

export function createGatewayRuntime(filePath?: string) {
  return new GatewayRuntimeStore(filePath)
}
