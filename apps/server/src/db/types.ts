import type { PlatformDatabase } from './database.js'

export type PlatformUserRole = 'super_admin' | 'employee'

export interface PlatformUser {
  id: string
  username: string
  displayName: string
  role: PlatformUserRole
  roleLabel: string
  status: 'active' | 'disabled'
}

export interface PlatformUserSeed {
  id: string
  username: string
  displayName: string
  role: PlatformUserRole
  roleLabel: string
  password: string
  status?: 'active' | 'disabled'
}

export interface PlatformApiKeySeed {
  id: string
  ownerUserId: string
  maskedValue: string
  secretHash?: string | null
  secretValue?: string | null
  purpose: string
  status: 'active' | 'disabled' | 'revoked'
  lastUsedAt?: string | null
}

export interface PlatformApiKeyCreate {
  id: string
  ownerUserId: string
  maskedValue: string
  secretHash?: string | null
  secretValue?: string | null
  purpose: string
  status?: 'active' | 'disabled' | 'revoked'
  createdAt?: string | null
  lastUsedAt?: string | null
  secretRevealedAt?: string | null
  idempotencyKey?: string | null
}

export interface PlatformGatewayKey {
  id: string
  ownerUserId: string
  ownerName: string
  maskedValue: string
  purpose: string
  status: 'active'
}

export interface PlatformApiKeyReset {
  maskedValue: string
  secretHash: string
  secretValue: string
}

/** A short-lived handoff from the signed-in employee portal to the local
 * AI OPS desktop assistant. The raw ticket is never persisted. */
export type PlatformDeviceSetupTarget = 'codex' | 'workbuddy'
export type PlatformDeviceSetupState = 'pending' | 'claimed' | 'succeeded' | 'failed' | 'expired'

export interface PlatformDeviceSetupTicketCreate {
  id: string
  tokenHash: string
  ownerUserId: string
  apiKeyId: string
  target: PlatformDeviceSetupTarget
  expiresAt: string
}

export interface PlatformDeviceSetupTicket {
  id: string
  ownerUserId: string
  apiKeyId: string
  target: PlatformDeviceSetupTarget
  state: PlatformDeviceSetupState
  expiresAt: string
  claimedAt: string | null
  completedAt: string | null
  failureCode: string | null
  createdAt: string
}

export interface PlatformDeviceSetupClaimResult {
  state: 'claimed' | 'not_found' | 'expired' | 'already_claimed' | 'unavailable'
  ticket: PlatformDeviceSetupTicket | null
  secret: string | null
}

export interface PlatformAuditEventSeed {
  id: string
  actorUserId?: string | null
  action: string
  resourceType: string
  resourceId?: string | null
  result: 'success' | 'failed' | 'denied'
  requestId?: string | null
  summary: Record<string, unknown>
}

export interface PlatformUsageRequestSeed {
  requestId: string
  occurredAt: string
  ownerUserId: string
  apiKeyId: string
  purpose: { id: string; name: string; alias: string }
  model: { id: string; displayName: string; actualModel: string }
  channel: { id: string; name: string; type: 'official_api' }
  protocol?: 'chat_completions' | 'responses'
  streamed?: boolean
  tokens: { input: number; output: number }
  points: number
  latency: {
    firstTokenMs: number | null
    totalMs: number
    aiOpsAuthMs?: number
    contextCompactionMs?: number
    upstreamFirstTokenMs?: number | null
    upstreamTotalMs?: number
  }
  context?: { originalChars: number; forwardedChars: number; droppedMessages: number; strippedChars: number }
  cost: { type: 'platform_estimate'; amountUsd: number }
  status: 'succeeded' | 'failed' | 'cancelled'
  error?: { category: 'rate_limit' | 'timeout' | 'authentication' | 'server' | 'cancelled'; summary: string } | null
  routeAlias: string
  retryCount?: number
  requestIdPropagated?: boolean
  client: { name: 'Codex Desktop' | 'WorkBuddy'; mode: 'stream' | 'non_stream' }
}

export interface PlatformPersonCreate {
  id: string
  username: string
  displayName: string
  password: string
}

export interface PlatformPersonDisableResult {
  state: 'disabled' | 'already_disabled'
  idempotent: boolean
  person: Awaited<ReturnType<PlatformDatabase['listPeople']>>[number]
  keysDisabled: number
}

export interface PlatformPersonEnableResult {
  state: 'enabled' | 'already_enabled'
  idempotent: boolean
  person: Awaited<ReturnType<PlatformDatabase['listPeople']>>[number]
  keysEnabled: number
}

export interface PlatformPersonDeleteResult {
  state: 'deleted' | 'not_disabled'
  idempotent: boolean
  person: { id: string; displayName: string }
}

export interface PlatformPersonPasswordResetResult {
  idempotent: boolean
  person: { id: string; displayName: string }
}

export interface PlatformApiKeyResetResult {
  state: 'reset' | 'already_disabled'
  idempotent: boolean
  key: Awaited<ReturnType<PlatformDatabase['listApiKeys']>>[number]
  secret: string | null
}

export interface PlatformConversationAccessCreate {
  id: string
  actorUserId: string
  recordId: string
  requestId: string
  action: 'view'
  reasonProvided: boolean
  reasonLength: number
  acknowledgedSensitiveScope: boolean
}

export type PlatformConversationAuditStatus = 'streaming' | 'succeeded' | 'failed' | 'cancelled' | 'body_unavailable'

export interface PlatformConversationAuditCaptureInput {
  id: string
  requestId: string
  keyId: string
  personId: string
  keyMasked: string
  purpose: string
  model: string
  endpoint: string
  startedAt: string
  prompt: unknown
  streamed: boolean
  groupingType?: 'conversation' | 'independent_call'
  groupingReliable?: boolean
  groupingLabel?: string
  httpStatus?: number | null
  retentionUntil?: string
}

export interface PlatformConversationAuditCompletion {
  status: PlatformConversationAuditStatus
  completedAt: string
  httpStatus?: number | null
  response?: unknown
  responseChunks?: unknown[]
  terminationReason?: string | null
  captureError?: string | null
  turns?: number
  toolCalls?: number
  totalTokens?: number
  promptBytes?: number | null
  responseBytes?: number | null
}

export interface PlatformConversationAuditContent {
  prompt: unknown | null
  response: unknown | null
  chunks: unknown[]
  promptAvailable: boolean
  responseAvailable: boolean
  promptBytes: number | null
  responseBytes: number | null
  promptHash: string | null
  responseHash: string | null
}

export interface PlatformConversationAuditOperation {
  id: string
  actorUserId: string
  recordId: string
  requestId: string
  keyId: string
  action: 'view' | 'copy' | 'export'
  fieldType: 'prompt' | 'response' | 'both' | 'metadata'
  result: 'success' | 'failed' | 'denied'
  reasonLength: number
  scope: string
}

export interface PlatformConversationAuditRecord {
  id: string
  requestId: string
  capturedAt: string
  personId: string
  personName: string
  keyId: string
  keyMasked: string
  purposeId: string
  purposeLabel: string
  modelId: string
  modelLabel: string
  actualModel: string | null
  policyId: string
  policyLabel: string
  policyScope: string
  policyExpiresAt: string
  state: 'captured' | 'metadata_only' | 'expired'
  redactionStatus: 'passed' | 'review_required' | 'not_applicable'
  redactionFindings: number
  groupingType: 'conversation' | 'independent_call'
  groupingReliable: number
  groupingLabel: string
  turns: number
  toolCalls: number
  totalTokens: number
  contentAccessAvailable: number
  endpoint: string | null
  startedAt: string | null
  completedAt: string | null
  auditStatus: PlatformConversationAuditStatus | null
  httpStatus: number | null
  promptBodyRef: string | null
  responseBodyRef: string | null
  promptBytes: number | null
  responseBytes: number | null
  retentionUntil: string | null
  exportCount: number
  streamed: number
  chunkCount: number
  terminationReason: string | null
  promptHash: string | null
  responseHash: string | null
  captureError: string | null
  deletedAt: string | null
}

export interface PlatformConversationAuditDeleteResult {
  id: string
  requestId: string
  deletedAt: string
  deletedContentBytes: number
  auditEventId: string
  idempotent: boolean
}

export interface ConversationAuditCleanupStatus {
  proofRecords: number
  lastRun: { triggeredBy: 'startup' | 'scheduled'; completedAt: string; expiredRecords: number; proofRecords: number } | null
}

export interface PlatformConversationUsageLink {
  usageRequestId: string
  linkSource: 'gateway_capture'
}

export interface PlatformUsageConversationLink {
  recordId: string
  linkSource: 'gateway_capture'
}

export interface PlatformAuthSessionCreate {
  id: string
  userId: string
  tokenHash: string
  csrfTokenHash: string
  expiresAt: string
}

export const REVOKED_SESSION_RETENTION_HOURS = 24
export type SessionCleanupTrigger = 'startup' | 'login'
export interface SessionCleanupResult {
  triggeredBy: SessionCleanupTrigger
  completedAt: string
  deletedExpired: number
  deletedRevoked: number
  revokedRetentionHours: typeof REVOKED_SESSION_RETENTION_HOURS
}

export const DEVICE_SETUP_TICKET_RETENTION_HOURS = 24
export type DeviceSetupTicketCleanupTrigger = 'startup' | 'scheduled' | 'create'
export interface DeviceSetupTicketCleanupResult {
  triggeredBy: DeviceSetupTicketCleanupTrigger
  completedAt: string
  expiredTickets: number
  deletedTickets: number
}

export const SYSTEM_AUDIT_RETENTION_DAYS = 30
export type AuditCleanupTrigger = 'startup' | 'scheduled'
export interface AuditCleanupResult {
  triggeredBy: AuditCleanupTrigger
  completedAt: string
  cutoffAt: string
  deletedEvents: number
  retainedEvents: number
}

export interface ConversationAuditPurgeResult {
  cutoffAt: string
  deletedRecords: number
  deletedContents: number
  deletedOperationEvents: number
  deletedAccessEvents: number
  deletedUsageLinks: number
  deletedExpiryProofs: number
}

export interface AuditChainVerification {
  algorithm: 'sha256'
  verified: boolean
  hashChainVerified: boolean
  checkpointVerified: boolean
  checkedAt: string
  checkpointUpdatedAt: string | null
  eventCount: number
  firstInvalidEventId: string | null
}

export interface PlatformDatabaseOptions {
  connectionString?: string
  /** Read-only migration source, never a live runtime store. */
  filename?: string
  now?: () => Date
}
