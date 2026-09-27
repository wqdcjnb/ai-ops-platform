import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

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
  person: ReturnType<PlatformDatabase['listPeople']>[number]
  keysDisabled: number
}

export interface PlatformPersonEnableResult {
  state: 'enabled' | 'already_enabled'
  idempotent: boolean
  person: ReturnType<PlatformDatabase['listPeople']>[number]
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
  key: ReturnType<PlatformDatabase['listApiKeys']>[number]
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
  lastRun: { triggeredBy: 'startup'; completedAt: string; expiredRecords: number; proofRecords: number } | null
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

export function hashPlatformPassword(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function hashPlatformApiKey(value: string) {
  return createHash('sha256').update('ai-ops-gateway:' + value).digest('hex')
}

function platformKeyEncryptionKey() {
  return createHash('sha256')
    .update('ai-ops-key-view:' + (process.env.AI_OPS_KEY_ENCRYPTION_SECRET?.trim() || 'local-development-only-change-me'))
    .digest()
}

export function encryptPlatformApiKey(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', platformKeyEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return 'v1.' + iv.toString('base64url') + '.' + tag.toString('base64url') + '.' + ciphertext.toString('base64url')
}

export function decryptPlatformApiKey(value: string) {
  try {
    const parts = value.split('.')
    if (parts.length !== 4 || parts[0] !== 'v1') return null
    const iv = Buffer.from(parts[1]!, 'base64url')
    const tag = Buffer.from(parts[2]!, 'base64url')
    const ciphertext = Buffer.from(parts[3]!, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', platformKeyEncryptionKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

const FINAL_SCHEMA_NAME = 'final_ai_ops_schema_20260927'
const FINAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'employee')),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  masked_value TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  secret_ciphertext TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'revoked')),
  last_used_at TEXT,
  secret_revealed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_active_key_per_person
  ON api_keys(owner_user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS api_keys_owner_idx ON api_keys(owner_user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS api_key_operations (
  idempotency_key TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'reset')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entity_deletions (
  idempotency_key TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_requests (
  request_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  purpose_id TEXT NOT NULL,
  purpose_name TEXT NOT NULL,
  purpose_alias TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_display_name TEXT NOT NULL,
  actual_model TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK (channel_type = 'official_api'),
  protocol TEXT NOT NULL CHECK (protocol IN ('chat_completions', 'responses')),
  streamed INTEGER NOT NULL CHECK (streamed IN (0, 1)),
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  points REAL NOT NULL,
  first_token_ms INTEGER,
  total_latency_ms INTEGER NOT NULL,
  ai_ops_auth_ms INTEGER NOT NULL DEFAULT 0,
  context_compaction_ms INTEGER NOT NULL DEFAULT 0,
  upstream_first_token_ms INTEGER,
  upstream_total_ms INTEGER NOT NULL DEFAULT 0,
  context_original_chars INTEGER NOT NULL DEFAULT 0,
  context_forwarded_chars INTEGER NOT NULL DEFAULT 0,
  context_dropped_messages INTEGER NOT NULL DEFAULT 0,
  context_stripped_chars INTEGER NOT NULL DEFAULT 0,
  cost_type TEXT NOT NULL CHECK (cost_type = 'platform_estimate'),
  cost_amount_usd REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled')),
  error_category TEXT,
  error_summary TEXT,
  route_alias TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  request_id_propagated INTEGER NOT NULL DEFAULT 0,
  client_name TEXT NOT NULL CHECK (client_name IN ('Codex Desktop', 'WorkBuddy')),
  client_mode TEXT NOT NULL CHECK (client_mode IN ('stream', 'non_stream'))
);
CREATE INDEX IF NOT EXISTS usage_requests_occurred_idx ON usage_requests(occurred_at DESC);
CREATE TABLE IF NOT EXISTS audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'failed', 'denied')),
  request_id TEXT,
  summary_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_occurred_idx ON audit_events(occurred_at DESC);
CREATE TABLE IF NOT EXISTS audit_chain_checkpoints (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  event_count INTEGER NOT NULL,
  head_event_id TEXT,
  head_hash TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS user_sessions_active_idx ON user_sessions(token_hash, expires_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS session_cleanup_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('startup', 'login')),
  completed_at TEXT NOT NULL,
  deleted_expired INTEGER NOT NULL,
  deleted_revoked INTEGER NOT NULL,
  revoked_retention_hours INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_audit_records (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  captured_at TEXT NOT NULL,
  person_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  key_masked TEXT NOT NULL,
  purpose_id TEXT NOT NULL,
  purpose_label TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_label TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_label TEXT NOT NULL,
  policy_scope TEXT NOT NULL,
  policy_expires_at TEXT NOT NULL,
  capture_state TEXT NOT NULL CHECK (capture_state IN ('captured', 'metadata_only', 'expired')),
  redaction_status TEXT NOT NULL CHECK (redaction_status IN ('passed', 'review_required', 'not_applicable')),
  redaction_findings INTEGER NOT NULL,
  grouping_type TEXT NOT NULL CHECK (grouping_type IN ('conversation', 'independent_call')),
  grouping_reliable INTEGER NOT NULL CHECK (grouping_reliable IN (0, 1)),
  grouping_label TEXT NOT NULL,
  turns INTEGER NOT NULL,
  tool_calls INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  content_access_available INTEGER NOT NULL CHECK (content_access_available IN (0, 1)),
  endpoint TEXT,
  started_at TEXT,
  completed_at TEXT,
  audit_status TEXT,
  http_status INTEGER,
  prompt_body_ref TEXT,
  response_body_ref TEXT,
  prompt_bytes INTEGER,
  response_bytes INTEGER,
  retention_until TEXT,
  export_count INTEGER NOT NULL DEFAULT 0,
  streamed INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  termination_reason TEXT,
  prompt_hash TEXT,
  response_hash TEXT,
  capture_error TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS conversation_audit_records_captured_idx ON conversation_audit_records(captured_at DESC);
CREATE TABLE IF NOT EXISTS conversation_audit_contents (
  record_id TEXT PRIMARY KEY REFERENCES conversation_audit_records(id) ON DELETE CASCADE,
  prompt_ciphertext TEXT,
  response_ciphertext TEXT,
  chunks_ciphertext TEXT,
  byte_length INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversation_audit_operation_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('view', 'copy', 'export')),
  field_type TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success', 'failed', 'denied')),
  reason_length INTEGER NOT NULL,
  scope TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_access_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action = 'view'),
  reason_provided INTEGER NOT NULL,
  reason_length INTEGER NOT NULL,
  acknowledged_sensitive_scope INTEGER NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_audit_cleanup_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  triggered_by TEXT NOT NULL CHECK (triggered_by = 'startup'),
  completed_at TEXT NOT NULL,
  expired_records INTEGER NOT NULL,
  proof_records INTEGER NOT NULL,
  deleted_content_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversation_audit_expiry_proofs (
  record_id TEXT PRIMARY KEY,
  cleanup_run_id INTEGER NOT NULL,
  expired_at TEXT NOT NULL,
  no_content_was_stored INTEGER NOT NULL,
  notice TEXT NOT NULL,
  deleted_content_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversation_usage_links (
  record_id TEXT PRIMARY KEY,
  usage_request_id TEXT NOT NULL,
  link_source TEXT NOT NULL CHECK (link_source = 'gateway_capture')
);
CREATE TABLE IF NOT EXISTS conversation_audit_deletions (
  record_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  deleted_content_bytes INTEGER NOT NULL,
  audit_event_id TEXT NOT NULL
);
`

type LegacyUser = {
  id: string
  username: string
  displayName: string
  role: PlatformUserRole
  passwordHash: string
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

type LegacyKey = {
  id: string
  ownerUserId: string
  maskedValue: string
  secretHash: string
  secretCiphertext: string
  purpose: string
  lastUsedAt: string | null
  secretRevealedAt: string | null
  createdAt: string
  updatedAt: string
}

function jsonText(value: unknown) {
  return JSON.stringify(value ?? null)
}

function bytesFor(value: unknown) {
  return Buffer.byteLength(jsonText(value), 'utf8')
}

function hashValue(value: unknown) {
  return createHash('sha256').update(jsonText(value)).digest('hex')
}

function decryptJson(value: string | null | undefined): unknown {
  if (!value) return null
  const plain = decryptPlatformApiKey(value)
  if (!plain) return null
  try { return JSON.parse(plain) } catch { return null }
}

function encryptJson(value: unknown) {
  return encryptPlatformApiKey(jsonText(value))
}

function auditHash(input: {
  id: string
  actorUserId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  result: string
  requestId: string | null
  summaryJson: string
  occurredAt: string
}, previousHash: string | null) {
  return createHash('sha256').update(jsonText({
    version: 1,
    previousHash,
    id: input.id,
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    result: input.result,
    requestId: input.requestId,
    summaryJson: input.summaryJson,
    occurredAt: input.occurredAt,
  })).digest('hex')
}

export interface PlatformDatabaseOptions {
  filename?: string
  now?: () => Date
}

export class PlatformDatabase {
  private readonly db: DatabaseSync
  private readonly now: () => Date

  constructor(options: PlatformDatabaseOptions = {}) {
    const filename = options.filename ?? resolve(process.cwd(), 'data', 'platform.sqlite')
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
    this.db = new DatabaseSync(filename)
    this.now = options.now ?? (() => new Date())
    this.migrateToFinalSchema()
    this.cleanupAuthSessions('startup')
    this.cleanupConversationAuditMetadata('startup')
  }

  private tableExists(name: string) {
    return Boolean(this.db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', name))
  }

  private isFinalSchema() {
    if (!this.tableExists('schema_migrations')) return false
    return Boolean(this.db.prepare('SELECT 1 FROM schema_migrations WHERE name = ? LIMIT 1').get(FINAL_SCHEMA_NAME))
  }

  private legacyUsers(): LegacyUser[] {
    if (!this.tableExists('users')) return []
    const sql = 'SELECT id, username, display_name AS displayName, role, password_hash AS passwordHash, status, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE status = \'active\' AND role IN (\'super_admin\', \'employee\') ORDER BY CASE role WHEN \'super_admin\' THEN 0 ELSE 1 END, created_at'
    return this.db.prepare(sql).all() as LegacyUser[]
  }

  private legacyKeys(users: LegacyUser[]): LegacyKey[] {
    if (!users.length || !this.tableExists('api_keys')) return []
    const columns = this.db.prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>
    const names = new Set(columns.map((item) => item.name))
    if (!names.has('secret_hash') || !names.has('secret_ciphertext')) return []
    const ownerIds = new Set(users.filter((user) => user.role === 'employee').map((user) => user.id))
    if (!ownerIds.size) return []
    const all = this.db.prepare('SELECT id, owner_user_id AS ownerUserId, masked_value AS maskedValue, secret_hash AS secretHash, secret_ciphertext AS secretCiphertext, purpose, last_used_at AS lastUsedAt, secret_revealed_at AS secretRevealedAt, created_at AS createdAt, updated_at AS updatedAt, status FROM api_keys WHERE status = \'active\' AND (id LIKE \'key-ultimate-%\' OR id LIKE \'key-aiops-%\') ORDER BY updated_at DESC').all() as Array<LegacyKey & { status: string }>
    const kept = new Set<string>()
    return all.filter((key) => {
      if (!ownerIds.has(key.ownerUserId) || kept.has(key.ownerUserId) || !key.secretHash || !key.secretCiphertext) return false
      kept.add(key.ownerUserId)
      return true
    }).map((key) => ({
      id: key.id,
      ownerUserId: key.ownerUserId,
      maskedValue: key.maskedValue,
      secretHash: key.secretHash,
      secretCiphertext: key.secretCiphertext,
      purpose: key.purpose,
      lastUsedAt: key.lastUsedAt ?? null,
      secretRevealedAt: key.secretRevealedAt ?? null,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
    }))
  }

  private dropAllApplicationTables() {
    const objects = this.db.prepare('SELECT type, name FROM sqlite_master WHERE name NOT LIKE \'sqlite_%\' AND type IN (\'table\', \'view\', \'trigger\')').all() as Array<{ type: string; name: string }>
    for (const object of objects) {
      const safe = object.name.replaceAll('"', '""')
      if (object.type === 'table') this.db.exec('DROP TABLE IF EXISTS "' + safe + '"')
      else if (object.type === 'view') this.db.exec('DROP VIEW IF EXISTS "' + safe + '"')
      else this.db.exec('DROP TRIGGER IF EXISTS "' + safe + '"')
    }
  }

  private migrateToFinalSchema() {
    if (this.isFinalSchema()) {
      this.db.exec(FINAL_SCHEMA)
      return
    }
    const users = this.legacyUsers()
    const keys = this.legacyKeys(users)
    const timestamp = this.now().toISOString()
    this.db.exec('PRAGMA foreign_keys = OFF')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.dropAllApplicationTables()
      this.db.exec(FINAL_SCHEMA)
      this.db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(1, FINAL_SCHEMA_NAME, timestamp)
      const insertUser = this.db.prepare('INSERT INTO users(id, username, display_name, role, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      for (const user of users) insertUser.run(user.id, user.username, user.displayName, user.role, user.passwordHash, user.status, user.createdAt, user.updatedAt)
      const insertKey = this.db.prepare('INSERT INTO api_keys(id, owner_user_id, masked_value, secret_hash, secret_ciphertext, purpose, status, last_used_at, secret_revealed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'active\', ?, ?, ?, ?)')
      for (const key of keys) insertKey.run(key.id, key.ownerUserId, key.maskedValue, key.secretHash, key.secretCiphertext, key.purpose, key.lastUsedAt, key.secretRevealedAt, key.createdAt, key.updatedAt)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON')
    }
  }

  seedUser(seed: PlatformUserSeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.prepare('INSERT INTO users(id, username, display_name, role, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, role = excluded.role, password_hash = excluded.password_hash, status = excluded.status, updated_at = excluded.updated_at').run(
      seed.id, seed.username, seed.displayName, seed.role, hashPlatformPassword(seed.password), seed.status ?? 'active', timestamp, timestamp,
    )
  }

  seedApiKey(seed: PlatformApiKeySeed, now = this.now()) {
    const timestamp = now.toISOString()
    const hash = seed.secretHash ?? (seed.secretValue ? hashPlatformApiKey(seed.secretValue) : null)
    const cipher = seed.secretValue ? encryptPlatformApiKey(seed.secretValue) : null
    if (!hash || !cipher) throw new Error('API_KEY_SECRET_REQUIRED')
    this.db.prepare('INSERT INTO api_keys(id, owner_user_id, masked_value, secret_hash, secret_ciphertext, purpose, status, last_used_at, secret_revealed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET masked_value = excluded.masked_value, secret_hash = excluded.secret_hash, secret_ciphertext = excluded.secret_ciphertext, purpose = excluded.purpose, status = excluded.status, last_used_at = excluded.last_used_at, updated_at = excluded.updated_at').run(
      seed.id, seed.ownerUserId, seed.maskedValue, hash, cipher, seed.purpose, seed.status, seed.lastUsedAt ?? null, null, timestamp, timestamp,
    )
  }

  createPerson(person: PlatformPersonCreate, auditEvent?: PlatformAuditEventSeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO users(id, username, display_name, role, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, \'employee\', ?, \'active\', ?, ?)').run(
        person.id, person.username, person.displayName, hashPlatformPassword(person.password), timestamp, timestamp,
      )
      if (auditEvent) this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
      return this.findPerson(person.id)
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listPeople() {
    return this.db.prepare('SELECT id, username, display_name AS displayName, status, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE role = \'employee\' ORDER BY created_at DESC, id DESC').all() as Array<{
      id: string
      username: string
      displayName: string
      status: 'active' | 'disabled'
      createdAt: string
      updatedAt: string
    }>
  }

  findPerson(id: string) {
    return this.db.prepare('SELECT id, username, display_name AS displayName, status, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE id = ? AND role = \'employee\' LIMIT 1').get(id) as ReturnType<PlatformDatabase['listPeople']>[number] | undefined ?? null
  }

  private deletionFor(key: string) {
    return this.db.prepare('SELECT entity_type AS entityType, entity_id AS entityId, deleted_at AS deletedAt FROM entity_deletions WHERE idempotency_key = ?').get(key) as { entityType: string; entityId: string; deletedAt: string } | undefined
  }

  disablePerson(personId: string, auditEvent: PlatformAuditEventSeed, now = this.now()): PlatformPersonDisableResult | null {
    const existingAudit = this.db.prepare('SELECT resource_id AS resourceId FROM audit_events WHERE id = ?').get(auditEvent.id) as { resourceId: string | null } | undefined
    const person = this.findPerson(personId)
    if (existingAudit && existingAudit.resourceId !== personId) throw new Error('IDEMPOTENCY_KEY_REUSED')
    if (!person) return null
    if (existingAudit) return { state: 'disabled', idempotent: true, person: { ...person, status: 'disabled' }, keysDisabled: 0 }
    if (person.status === 'disabled') return { state: 'already_disabled', idempotent: false, person, keysDisabled: 0 }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const timestamp = now.toISOString()
      this.db.prepare('UPDATE users SET status = \'disabled\', updated_at = ? WHERE id = ?').run(timestamp, personId)
      const keysDisabled = Number(this.db.prepare('UPDATE api_keys SET status = \'disabled\', updated_at = ? WHERE owner_user_id = ? AND status = \'active\'').run(timestamp, personId).changes)
      this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
      return { state: 'disabled', idempotent: false, person: { ...person, status: 'disabled', updatedAt: timestamp }, keysDisabled }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  enablePerson(personId: string, auditEvent: PlatformAuditEventSeed, now = this.now()): PlatformPersonEnableResult | null {
    const existingAudit = this.db.prepare('SELECT resource_id AS resourceId FROM audit_events WHERE id = ?').get(auditEvent.id) as { resourceId: string | null } | undefined
    const person = this.findPerson(personId)
    if (existingAudit && existingAudit.resourceId !== personId) throw new Error('IDEMPOTENCY_KEY_REUSED')
    if (!person) return null
    if (existingAudit) return { state: 'enabled', idempotent: true, person: { ...person, status: 'active' }, keysEnabled: 0 }
    if (person.status === 'active') return { state: 'already_enabled', idempotent: false, person, keysEnabled: 0 }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const timestamp = now.toISOString()
      this.db.prepare('UPDATE users SET status = \'active\', updated_at = ? WHERE id = ?').run(timestamp, personId)
      const active = this.db.prepare('SELECT id FROM api_keys WHERE owner_user_id = ? AND status = \'active\' LIMIT 1').get(personId)
      const keysEnabled = active ? 0 : Number(this.db.prepare('UPDATE api_keys SET status = \'active\', updated_at = ? WHERE owner_user_id = ? AND status = \'disabled\'').run(timestamp, personId).changes)
      this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
      return { state: 'enabled', idempotent: false, person: { ...person, status: 'active', updatedAt: timestamp }, keysEnabled }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  resetPersonPassword(personId: string, auditEvent: PlatformAuditEventSeed, now = this.now()): PlatformPersonPasswordResetResult | null {
    const prior = this.db.prepare('SELECT resource_id AS resourceId FROM audit_events WHERE id = ?').get(auditEvent.id) as { resourceId: string | null } | undefined
    const person = this.findPerson(personId)
    if (prior && prior.resourceId !== personId) throw new Error('IDEMPOTENCY_KEY_REUSED')
    if (!person) return null
    if (prior) return { idempotent: true, person: { id: person.id, displayName: person.displayName } }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPlatformPassword('123456'), now.toISOString(), personId)
      this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
      return { idempotent: false, person: { id: person.id, displayName: person.displayName } }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  deletePerson(personId: string, auditEvent: PlatformAuditEventSeed, now = this.now()): PlatformPersonDeleteResult | null {
    const prior = this.deletionFor(auditEvent.id)
    if (prior && (prior.entityType !== 'person' || prior.entityId !== personId)) throw new Error('IDEMPOTENCY_KEY_REUSED')
    if (prior) return { state: 'deleted', idempotent: true, person: { id: personId, displayName: '' } }
    const person = this.findPerson(personId)
    if (!person) return null
    if (person.status !== 'disabled') return { state: 'not_disabled', idempotent: false, person: { id: person.id, displayName: person.displayName } }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const timestamp = now.toISOString()
      this.db.prepare('DELETE FROM users WHERE id = ?').run(personId)
      this.db.prepare('INSERT INTO entity_deletions(idempotency_key, entity_type, entity_id, deleted_at) VALUES (?, \'person\', ?, ?)').run(auditEvent.id, personId, timestamp)
      this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
      return { state: 'deleted', idempotent: false, person: { id: person.id, displayName: person.displayName } }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listApiKeys() {
    return this.db.prepare('SELECT k.id, k.owner_user_id AS ownerUserId, k.masked_value AS maskedValue, k.purpose, k.status, k.last_used_at AS lastUsedAt, k.secret_revealed_at AS secretRevealedAt, k.created_at AS createdAt, k.updated_at AS updatedAt, u.display_name AS ownerName FROM api_keys k JOIN users u ON u.id = k.owner_user_id ORDER BY k.created_at DESC, k.id DESC').all() as Array<{
      id: string
      ownerUserId: string
      maskedValue: string
      purpose: string
      status: 'active' | 'disabled' | 'revoked'
      lastUsedAt: string | null
      secretRevealedAt: string | null
      createdAt: string
      updatedAt: string
      ownerName: string
    }>
  }

  listApiKeysForOwner(ownerUserId: string) {
    return this.listApiKeys().filter((key) => key.ownerUserId === ownerUserId)
  }

  findApiKeyOperation(idempotencyKey: string) {
    return this.db.prepare('SELECT person_id AS personId, key_id AS keyId, action FROM api_key_operations WHERE idempotency_key = ?').get(idempotencyKey) as { personId: string; keyId: string; action: 'create' | 'reset' } | undefined ?? null
  }

  createApiKey(key: PlatformApiKeyCreate, auditEvent?: PlatformAuditEventSeed, now = this.now()) {
    const timestamp = now.toISOString()
    const secretHash = key.secretHash ?? (key.secretValue ? hashPlatformApiKey(key.secretValue) : null)
    const secretCiphertext = key.secretValue ? encryptPlatformApiKey(key.secretValue) : null
    if (!secretHash || !secretCiphertext) throw new Error('API_KEY_SECRET_REQUIRED')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO api_keys(id, owner_user_id, masked_value, secret_hash, secret_ciphertext, purpose, status, last_used_at, secret_revealed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        key.id, key.ownerUserId, key.maskedValue, secretHash, secretCiphertext, key.purpose, key.status ?? 'active', key.lastUsedAt ?? null, key.secretRevealedAt ?? null, key.createdAt ?? timestamp, timestamp,
      )
      if (key.idempotencyKey) this.db.prepare('INSERT INTO api_key_operations(idempotency_key, person_id, key_id, action, created_at) VALUES (?, ?, ?, \'create\', ?)').run(key.idempotencyKey, key.ownerUserId, key.id, timestamp)
      if (auditEvent) this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
      return this.listApiKeys().find((item) => item.id === key.id) ?? null
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  readApiKeySecret(keyId: string) {
    const row = this.db.prepare('SELECT secret_ciphertext AS secretCiphertext FROM api_keys WHERE id = ? LIMIT 1').get(keyId) as { secretCiphertext: string } | undefined
    return row ? decryptPlatformApiKey(row.secretCiphertext) : null
  }

  resetApiKey(keyId: string, replacement: PlatformApiKeyReset, auditEvent: PlatformAuditEventSeed, now = this.now()): PlatformApiKeyResetResult | null {
    const prior = this.db.prepare('SELECT resource_id AS resourceId FROM audit_events WHERE id = ?').get(auditEvent.id) as { resourceId: string | null } | undefined
    const key = this.listApiKeys().find((item) => item.id === keyId) ?? null
    if (prior && prior.resourceId !== keyId) throw new Error('IDEMPOTENCY_KEY_REUSED')
    if (!key) return null
    if (prior) return { state: 'reset', idempotent: true, key, secret: this.readApiKeySecret(keyId) }
    if (key.status === 'disabled' || key.status === 'revoked') return { state: 'already_disabled', idempotent: false, key, secret: null }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const timestamp = now.toISOString()
      this.db.prepare('UPDATE api_keys SET masked_value = ?, secret_hash = ?, secret_ciphertext = ?, status = \'active\', secret_revealed_at = ?, updated_at = ? WHERE id = ?').run(
        replacement.maskedValue, replacement.secretHash, encryptPlatformApiKey(replacement.secretValue), timestamp, timestamp, keyId,
      )
      this.db.prepare('INSERT INTO api_key_operations(idempotency_key, person_id, key_id, action, created_at) VALUES (?, ?, ?, \'reset\', ?)').run(auditEvent.id, key.ownerUserId, keyId, timestamp)
      this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
      const updated = this.listApiKeys().find((item) => item.id === keyId)
      if (!updated) throw new Error('API_KEY_RESET_MISSING')
      return { state: 'reset', idempotent: false, key: updated, secret: replacement.secretValue }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  findGatewayKey(secret: string, now = this.now()): PlatformGatewayKey | null {
    const row = this.db.prepare('SELECT k.id, k.owner_user_id AS ownerUserId, u.display_name AS ownerName, k.masked_value AS maskedValue, k.purpose FROM api_keys k JOIN users u ON u.id = k.owner_user_id WHERE k.secret_hash = ? AND k.status = \'active\' AND u.status = \'active\' LIMIT 1').get(hashPlatformApiKey(secret)) as Omit<PlatformGatewayKey, 'status'> | undefined
    if (!row) return null
    this.db.prepare('UPDATE api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?').run(now.toISOString(), now.toISOString(), row.id)
    return { ...row, status: 'active' }
  }

  seedUsageRequest(seed: PlatformUsageRequestSeed) {
    this.insertUsageRequest(seed)
  }

  recordGatewayUsage(seed: PlatformUsageRequestSeed, auditEvent: PlatformAuditEventSeed, now = this.now()) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.insertUsageRequest(seed)
      const record = this.db.prepare('SELECT id FROM conversation_audit_records WHERE request_id = ?').get(seed.requestId) as { id: string } | undefined
      if (record) this.db.prepare('INSERT OR REPLACE INTO conversation_usage_links(record_id, usage_request_id, link_source) VALUES (?, ?, \'gateway_capture\')').run(record.id, seed.requestId)
      this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private insertUsageRequest(seed: PlatformUsageRequestSeed) {
    const context = seed.context ?? { originalChars: 0, forwardedChars: 0, droppedMessages: 0, strippedChars: 0 }
    const latency = seed.latency
    this.db.prepare('INSERT OR REPLACE INTO usage_requests(request_id, occurred_at, owner_user_id, api_key_id, purpose_id, purpose_name, purpose_alias, model_id, model_display_name, actual_model, channel_id, channel_name, channel_type, protocol, streamed, input_tokens, output_tokens, points, first_token_ms, total_latency_ms, ai_ops_auth_ms, context_compaction_ms, upstream_first_token_ms, upstream_total_ms, context_original_chars, context_forwarded_chars, context_dropped_messages, context_stripped_chars, cost_type, cost_amount_usd, status, error_category, error_summary, route_alias, retry_count, request_id_propagated, client_name, client_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      seed.requestId, seed.occurredAt, seed.ownerUserId, seed.apiKeyId, seed.purpose.id, seed.purpose.name, seed.purpose.alias, seed.model.id, seed.model.displayName, seed.model.actualModel, seed.channel.id, seed.channel.name, seed.channel.type, seed.protocol ?? 'chat_completions', Number(Boolean(seed.streamed)), seed.tokens.input, seed.tokens.output, seed.points, latency.firstTokenMs, latency.totalMs, latency.aiOpsAuthMs ?? 0, latency.contextCompactionMs ?? 0, latency.upstreamFirstTokenMs ?? null, latency.upstreamTotalMs ?? 0, context.originalChars, context.forwardedChars, context.droppedMessages, context.strippedChars, seed.cost.type, seed.cost.amountUsd, seed.status, seed.error?.category ?? null, seed.error?.summary ?? null, seed.routeAlias, seed.retryCount ?? 0, Number(Boolean(seed.requestIdPropagated)), seed.client.name, seed.client.mode,
    )
  }

  listUsageRequests() {
    return this.db.prepare('SELECT r.request_id AS requestId, r.occurred_at AS occurredAt, r.owner_user_id AS personId, COALESCE(u.display_name, \'已删除员工\') AS personName, r.api_key_id AS keyId, COALESCE(k.masked_value, \'已删除 Key\') AS maskedValue, r.purpose_id AS purposeId, r.purpose_name AS purposeName, r.purpose_alias AS purposeAlias, r.model_id AS modelId, r.model_display_name AS modelDisplayName, r.actual_model AS actualModel, r.channel_id AS channelId, r.channel_name AS channelName, r.protocol, r.streamed, r.input_tokens AS inputTokens, r.output_tokens AS outputTokens, r.points, r.first_token_ms AS firstTokenMs, r.total_latency_ms AS totalLatencyMs, r.ai_ops_auth_ms AS aiOpsAuthMs, r.context_compaction_ms AS contextCompactionMs, r.upstream_first_token_ms AS upstreamFirstTokenMs, r.upstream_total_ms AS upstreamTotalMs, r.context_original_chars AS contextOriginalChars, r.context_forwarded_chars AS contextForwardedChars, r.context_dropped_messages AS contextDroppedMessages, r.context_stripped_chars AS contextStrippedChars, r.cost_amount_usd AS costAmountUsd, r.status, r.error_category AS errorCategory, r.error_summary AS errorSummary, r.route_alias AS routeAlias, r.retry_count AS retryCount, r.request_id_propagated AS requestIdPropagated, r.client_name AS clientName, r.client_mode AS clientMode FROM usage_requests r LEFT JOIN users u ON u.id = r.owner_user_id LEFT JOIN api_keys k ON k.id = r.api_key_id ORDER BY r.occurred_at DESC, r.request_id DESC').all() as Array<{
      requestId: string; occurredAt: string; personId: string; personName: string; keyId: string; maskedValue: string
      purposeId: string; purposeName: string; purposeAlias: string; modelId: string; modelDisplayName: string; actualModel: string
      channelId: string; channelName: string; protocol: 'chat_completions' | 'responses'; streamed: number
      inputTokens: number; outputTokens: number; points: number; firstTokenMs: number | null; totalLatencyMs: number
      aiOpsAuthMs: number; contextCompactionMs: number; upstreamFirstTokenMs: number | null; upstreamTotalMs: number
      contextOriginalChars: number; contextForwardedChars: number; contextDroppedMessages: number; contextStrippedChars: number
      costAmountUsd: number; status: 'succeeded' | 'failed' | 'cancelled'; errorCategory: 'rate_limit' | 'timeout' | 'authentication' | 'server' | 'cancelled' | null; errorSummary: string | null
      routeAlias: string; retryCount: number; requestIdPropagated: number; clientName: 'Codex Desktop' | 'WorkBuddy'; clientMode: 'stream' | 'non_stream'
    }>
  }

  appendAuditEvent(seed: PlatformAuditEventSeed, now = this.now()) {
    const prior = this.db.prepare('SELECT id FROM audit_events WHERE id = ?').get(seed.id)
    if (prior) return
    const checkpoint = this.db.prepare('SELECT event_count AS eventCount, head_hash AS headHash FROM audit_chain_checkpoints WHERE id = 1').get() as { eventCount: number; headHash: string | null } | undefined
    const previousHash = checkpoint?.headHash ?? null
    const occurredAt = now.toISOString()
    const summaryJson = jsonText(seed.summary)
    const eventHash = auditHash({
      id: seed.id,
      actorUserId: seed.actorUserId ?? null,
      action: seed.action,
      resourceType: seed.resourceType,
      resourceId: seed.resourceId ?? null,
      result: seed.result,
      requestId: seed.requestId ?? null,
      summaryJson,
      occurredAt,
    }, previousHash)
    this.db.prepare('INSERT INTO audit_events(id, actor_user_id, action, resource_type, resource_id, result, request_id, summary_json, occurred_at, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      seed.id, seed.actorUserId ?? null, seed.action, seed.resourceType, seed.resourceId ?? null, seed.result, seed.requestId ?? null, summaryJson, occurredAt, previousHash, eventHash,
    )
    const eventCount = (checkpoint?.eventCount ?? 0) + 1
    this.db.prepare('INSERT INTO audit_chain_checkpoints(id, event_count, head_event_id, head_hash, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET event_count = excluded.event_count, head_event_id = excluded.head_event_id, head_hash = excluded.head_hash, updated_at = excluded.updated_at').run(eventCount, seed.id, eventHash, occurredAt)
  }

  seedAuditEvent(seed: PlatformAuditEventSeed, now = this.now()) {
    this.appendAuditEvent(seed, now)
  }

  listAuditEvents() {
    const rows = this.db.prepare('SELECT e.id, e.actor_user_id AS actorUserId, u.display_name AS actorName, u.role AS actorRole, e.action, e.resource_type AS resourceType, e.resource_id AS resourceId, e.result, e.request_id AS requestId, e.summary_json AS summaryJson, e.occurred_at AS occurredAt FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id ORDER BY e.sequence DESC').all() as Array<{
      id: string; actorUserId: string | null; actorName: string | null; actorRole: PlatformUserRole | null; action: string; resourceType: string; resourceId: string | null; result: 'success' | 'failed' | 'denied'; requestId: string | null; summaryJson: string; occurredAt: string
    }>
    return rows.map((row) => {
      let summary: Record<string, unknown> = {}
      try { summary = JSON.parse(row.summaryJson) as Record<string, unknown> } catch {}
      return { ...row, summary }
    })
  }

  cleanupAuditEvents(triggeredBy: AuditCleanupTrigger, now = this.now()): AuditCleanupResult {
    const completedAt = now.toISOString()
    const cutoffAt = new Date(now.getTime() - SYSTEM_AUDIT_RETENTION_DAYS * 86_400_000).toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const deletedEvents = Number(this.db.prepare('DELETE FROM audit_events WHERE occurred_at < ?').run(cutoffAt).changes)
      this.rebuildAuditCheckpoint(completedAt)
      const retainedEvents = Number((this.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }).count)
      this.db.exec('COMMIT')
      return { triggeredBy, completedAt, cutoffAt, deletedEvents, retainedEvents }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  clearAuditEvents() {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec('DELETE FROM audit_events; DELETE FROM audit_chain_checkpoints;')
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private rebuildAuditCheckpoint(updatedAt: string) {
    const rows = this.db.prepare('SELECT sequence, id, actor_user_id AS actorUserId, action, resource_type AS resourceType, resource_id AS resourceId, result, request_id AS requestId, summary_json AS summaryJson, occurred_at AS occurredAt FROM audit_events ORDER BY sequence ASC').all() as Array<{
      sequence: number; id: string; actorUserId: string | null; action: string; resourceType: string; resourceId: string | null; result: string; requestId: string | null; summaryJson: string; occurredAt: string
    }>
    let previousHash: string | null = null
    for (const row of rows) {
      const eventHash = auditHash(row, previousHash)
      this.db.prepare('UPDATE audit_events SET previous_hash = ?, event_hash = ? WHERE sequence = ?').run(previousHash, eventHash, row.sequence)
      previousHash = eventHash
    }
    if (!rows.length) {
      this.db.prepare('DELETE FROM audit_chain_checkpoints WHERE id = 1').run()
      return
    }
    const head = rows[rows.length - 1]!
    this.db.prepare('INSERT INTO audit_chain_checkpoints(id, event_count, head_event_id, head_hash, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET event_count = excluded.event_count, head_event_id = excluded.head_event_id, head_hash = excluded.head_hash, updated_at = excluded.updated_at').run(rows.length, head.id, previousHash, updatedAt)
  }

  verifyAuditChain(now = this.now()): AuditChainVerification {
    const rows = this.db.prepare('SELECT sequence, id, actor_user_id AS actorUserId, action, resource_type AS resourceType, resource_id AS resourceId, result, request_id AS requestId, summary_json AS summaryJson, occurred_at AS occurredAt, previous_hash AS previousHash, event_hash AS eventHash FROM audit_events ORDER BY sequence ASC').all() as Array<{
      sequence: number; id: string; actorUserId: string | null; action: string; resourceType: string; resourceId: string | null; result: string; requestId: string | null; summaryJson: string; occurredAt: string; previousHash: string | null; eventHash: string | null
    }>
    let previousHash: string | null = null
    let firstInvalidEventId: string | null = null
    for (const row of rows) {
      const expected = auditHash(row, previousHash)
      if (row.previousHash !== previousHash || row.eventHash !== expected) {
        firstInvalidEventId = row.id
        break
      }
      previousHash = expected
    }
    const checkpoint = this.db.prepare('SELECT event_count AS eventCount, head_event_id AS headEventId, head_hash AS headHash, updated_at AS updatedAt FROM audit_chain_checkpoints WHERE id = 1').get() as { eventCount: number; headEventId: string | null; headHash: string | null; updatedAt: string } | undefined
    const hashChainVerified = firstInvalidEventId === null
    const checkpointVerified = rows.length === 0
      ? !checkpoint
      : Boolean(checkpoint && checkpoint.eventCount === rows.length && checkpoint.headEventId === rows[rows.length - 1]!.id && checkpoint.headHash === previousHash)
    return {
      algorithm: 'sha256',
      verified: hashChainVerified && checkpointVerified,
      hashChainVerified,
      checkpointVerified,
      checkedAt: now.toISOString(),
      checkpointUpdatedAt: checkpoint?.updatedAt ?? null,
      eventCount: rows.length,
      firstInvalidEventId,
    }
  }

  startConversationAuditCapture(input: PlatformConversationAuditCaptureInput) {
    const existing = this.db.prepare('SELECT id FROM conversation_audit_records WHERE request_id = ?').get(input.requestId) as { id: string } | undefined
    if (existing) return this.getConversationAuditRecordById(existing.id)
    const prompt = input.prompt ?? null
    const promptHash = prompt === null ? null : hashValue(prompt)
    const retryCutoff = new Date(new Date(input.startedAt).getTime() - 10_000).toISOString()
    if (promptHash) {
      const duplicate = this.db.prepare('SELECT id FROM conversation_audit_records WHERE person_id = ? AND key_id = ? AND prompt_hash = ? AND started_at >= ? AND COALESCE(audit_status, \'streaming\') <> \'failed\' ORDER BY started_at DESC LIMIT 1').get(
        input.personId, input.keyId, promptHash, retryCutoff,
      ) as { id: string } | undefined
      if (duplicate) return null
    }
    const capturedAt = input.startedAt
    const retentionUntil = input.retentionUntil ?? new Date(new Date(capturedAt).getTime() + 30 * 86_400_000).toISOString()
    const promptAvailable = prompt !== null
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const values = [
        input.id, input.requestId, capturedAt, input.personId, input.keyId, input.keyMasked,
        input.purpose, input.purpose, input.model, input.model, 'gateway-default', '网关对话审计',
        'ai_ops', retentionUntil, promptAvailable ? 'captured' : 'metadata_only',
        promptAvailable ? 'passed' : 'not_applicable', 0, input.groupingType ?? 'independent_call',
        Number(Boolean(input.groupingReliable)), input.groupingLabel ?? '独立调用', 0, 0, 0,
        Number(promptAvailable), input.endpoint, input.startedAt, null, 'streaming', input.httpStatus ?? null,
        promptAvailable ? 'prompt:' + input.id : null, null, promptAvailable ? bytesFor(prompt) : null,
        null, retentionUntil, 0, Number(input.streamed), 0, null, promptHash, null, null, null,
      ]
      this.db.prepare('INSERT INTO conversation_audit_records(id, request_id, captured_at, person_id, key_id, key_masked, purpose_id, purpose_label, model_id, model_label, policy_id, policy_label, policy_scope, policy_expires_at, capture_state, redaction_status, redaction_findings, grouping_type, grouping_reliable, grouping_label, turns, tool_calls, total_tokens, content_access_available, endpoint, started_at, completed_at, audit_status, http_status, prompt_body_ref, response_body_ref, prompt_bytes, response_bytes, retention_until, export_count, streamed, chunk_count, termination_reason, prompt_hash, response_hash, capture_error, deleted_at) VALUES (' + new Array(42).fill('?').join(', ') + ')').run(...values)
      if (promptAvailable) this.db.prepare('INSERT INTO conversation_audit_contents(record_id, prompt_ciphertext, response_ciphertext, chunks_ciphertext, byte_length) VALUES (?, ?, NULL, NULL, ?)').run(input.id, encryptJson(prompt), bytesFor(prompt))
      this.db.exec('COMMIT')
      return this.getConversationAuditRecordById(input.id)
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  appendConversationAuditChunk(requestId: string, chunk: unknown) {
    const row = this.db.prepare('SELECT r.id, c.chunks_ciphertext AS chunksCiphertext FROM conversation_audit_records r LEFT JOIN conversation_audit_contents c ON c.record_id = r.id WHERE r.request_id = ?').get(requestId) as { id: string; chunksCiphertext: string | null } | undefined
    if (!row) return
    const chunks = decryptJson(row.chunksCiphertext)
    const next = Array.isArray(chunks) ? [...chunks, chunk] : [chunk]
    this.db.prepare('INSERT INTO conversation_audit_contents(record_id, prompt_ciphertext, response_ciphertext, chunks_ciphertext, byte_length) VALUES (?, NULL, NULL, ?, ?) ON CONFLICT(record_id) DO UPDATE SET chunks_ciphertext = excluded.chunks_ciphertext, byte_length = conversation_audit_contents.byte_length + ?').run(row.id, encryptJson(next), bytesFor(chunk), bytesFor(chunk))
    this.db.prepare('UPDATE conversation_audit_records SET chunk_count = ? WHERE id = ?').run(next.length, row.id)
  }

  completeConversationAuditCapture(requestId: string, completion: PlatformConversationAuditCompletion) {
    const record = this.db.prepare('SELECT id, prompt_bytes AS promptBytes FROM conversation_audit_records WHERE request_id = ?').get(requestId) as { id: string; promptBytes: number | null } | undefined
    if (!record) return null
    const response = completion.response ?? null
    const chunks = completion.responseChunks ?? []
    const responseAvailable = response !== null
    const responseBytes = completion.responseBytes ?? (responseAvailable ? bytesFor(response) : null)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db.prepare('SELECT prompt_ciphertext AS promptCiphertext, chunks_ciphertext AS chunksCiphertext, byte_length AS byteLength FROM conversation_audit_contents WHERE record_id = ?').get(record.id) as { promptCiphertext: string | null; chunksCiphertext: string | null; byteLength: number } | undefined
      const mergedChunks = chunks.length ? chunks : (Array.isArray(decryptJson(existing?.chunksCiphertext)) ? decryptJson(existing?.chunksCiphertext) as unknown[] : [])
      if (existing || responseAvailable || mergedChunks.length) {
        this.db.prepare('INSERT INTO conversation_audit_contents(record_id, prompt_ciphertext, response_ciphertext, chunks_ciphertext, byte_length) VALUES (?, ?, ?, ?, ?) ON CONFLICT(record_id) DO UPDATE SET response_ciphertext = excluded.response_ciphertext, chunks_ciphertext = excluded.chunks_ciphertext, byte_length = excluded.byte_length').run(
          record.id, existing?.promptCiphertext ?? null, responseAvailable ? encryptJson(response) : null, mergedChunks.length ? encryptJson(mergedChunks) : null, (existing?.byteLength ?? 0) + (responseBytes ?? 0),
        )
      }
      this.db.prepare('UPDATE conversation_audit_records SET completed_at = ?, audit_status = ?, http_status = ?, capture_state = ?, content_access_available = ?, response_body_ref = ?, response_bytes = ?, turns = ?, tool_calls = ?, total_tokens = ?, chunk_count = ?, termination_reason = ?, response_hash = ?, capture_error = ? WHERE id = ?').run(
        completion.completedAt, completion.status, completion.httpStatus ?? null, responseAvailable || record.promptBytes ? 'captured' : 'metadata_only', Number(Boolean(responseAvailable || record.promptBytes)), responseAvailable ? 'response:' + record.id : null, responseBytes, completion.turns ?? 0, completion.toolCalls ?? 0, completion.totalTokens ?? 0, mergedChunks.length, completion.terminationReason ?? null, responseAvailable ? hashValue(response) : null, completion.captureError ?? null, record.id,
      )
      this.db.exec('COMMIT')
      return this.getConversationAuditRecordById(record.id)
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private readConversationRecord(id: string) {
    return this.db.prepare('SELECT r.id, r.request_id AS requestId, r.captured_at AS capturedAt, r.person_id AS personId, COALESCE(u.display_name, \'已删除员工\') AS personName, r.key_id AS keyId, r.key_masked AS keyMasked, r.purpose_id AS purposeId, r.purpose_label AS purposeLabel, r.model_id AS modelId, r.model_label AS modelLabel, usage.actual_model AS actualModel, r.policy_id AS policyId, r.policy_label AS policyLabel, r.policy_scope AS policyScope, r.policy_expires_at AS policyExpiresAt, r.capture_state AS state, r.redaction_status AS redactionStatus, r.redaction_findings AS redactionFindings, r.grouping_type AS groupingType, r.grouping_reliable AS groupingReliable, r.grouping_label AS groupingLabel, r.turns, r.tool_calls AS toolCalls, r.total_tokens AS totalTokens, r.content_access_available AS contentAccessAvailable, r.endpoint, r.started_at AS startedAt, r.completed_at AS completedAt, r.audit_status AS auditStatus, r.http_status AS httpStatus, r.prompt_body_ref AS promptBodyRef, r.response_body_ref AS responseBodyRef, r.prompt_bytes AS promptBytes, r.response_bytes AS responseBytes, r.retention_until AS retentionUntil, r.export_count AS exportCount, r.streamed, r.chunk_count AS chunkCount, r.termination_reason AS terminationReason, r.prompt_hash AS promptHash, r.response_hash AS responseHash, r.capture_error AS captureError, r.deleted_at AS deletedAt FROM conversation_audit_records r LEFT JOIN users u ON u.id = r.person_id LEFT JOIN conversation_usage_links l ON l.record_id = r.id LEFT JOIN usage_requests usage ON usage.request_id = l.usage_request_id WHERE r.id = ? LIMIT 1').get(id) as PlatformConversationAuditRecord | undefined
  }

  getConversationAuditRecordById(id: string) {
    return this.readConversationRecord(id) ?? null
  }

  listConversationAuditRecords() {
    const ids = this.db.prepare('SELECT id FROM conversation_audit_records ORDER BY captured_at DESC, id DESC').all() as Array<{ id: string }>
    return ids.flatMap((item) => {
      const record = this.readConversationRecord(item.id)
      return record ? [record] : []
    })
  }

  getConversationAuditContent(recordId: string): PlatformConversationAuditContent | null {
    const record = this.readConversationRecord(recordId)
    if (!record || record.deletedAt || record.contentAccessAvailable !== 1) return null
    const content = this.db.prepare('SELECT prompt_ciphertext AS promptCiphertext, response_ciphertext AS responseCiphertext, chunks_ciphertext AS chunksCiphertext FROM conversation_audit_contents WHERE record_id = ?').get(recordId) as { promptCiphertext: string | null; responseCiphertext: string | null; chunksCiphertext: string | null } | undefined
    if (!content) return null
    const prompt = decryptJson(content.promptCiphertext)
    const response = decryptJson(content.responseCiphertext)
    const chunks = decryptJson(content.chunksCiphertext)
    return {
      prompt,
      response,
      chunks: Array.isArray(chunks) ? chunks : [],
      promptAvailable: prompt !== null,
      responseAvailable: response !== null,
      promptBytes: record.promptBytes,
      responseBytes: record.responseBytes,
      promptHash: record.promptHash,
      responseHash: record.responseHash,
    }
  }

  recordConversationAuditOperation(operation: PlatformConversationAuditOperation, now = this.now(), auditEvent?: PlatformAuditEventSeed) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO conversation_audit_operation_events(id, actor_user_id, record_id, request_id, key_id, action, field_type, result, reason_length, scope, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        operation.id, operation.actorUserId, operation.recordId, operation.requestId, operation.keyId, operation.action, operation.fieldType, operation.result, operation.reasonLength, operation.scope, now.toISOString(),
      )
      if (auditEvent) this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listConversationAuditOperations(recordId?: string) {
    return this.db.prepare('SELECT e.id, e.actor_user_id AS actorUserId, COALESCE(u.display_name, \'已删除用户\') AS actorName, e.record_id AS recordId, e.request_id AS requestId, e.key_id AS keyId, e.action, e.field_type AS fieldType, e.result, e.reason_length AS reasonLength, e.scope, e.occurred_at AS occurredAt FROM conversation_audit_operation_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE (? IS NULL OR e.record_id = ?) ORDER BY e.occurred_at DESC, e.id DESC LIMIT 50').all(recordId ?? null, recordId ?? null) as unknown as Array<PlatformConversationAuditOperation & { actorName: string; occurredAt: string }>
  }

  recordConversationAccess(event: PlatformConversationAccessCreate, now = this.now(), auditEvent?: PlatformAuditEventSeed) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO conversation_access_events(id, actor_user_id, record_id, request_id, action, reason_provided, reason_length, acknowledged_sensitive_scope, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        event.id, event.actorUserId, event.recordId, event.requestId, event.action, Number(event.reasonProvided), event.reasonLength, Number(event.acknowledgedSensitiveScope), now.toISOString(),
      )
      if (auditEvent) this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
      return { id: event.id, occurredAt: now.toISOString() }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listConversationAccessEvents(recordId?: string) {
    return this.db.prepare('SELECT e.id, e.actor_user_id AS actorUserId, COALESCE(u.display_name, \'已删除用户\') AS actorName, e.record_id AS recordId, e.request_id AS requestId, e.action, e.reason_provided AS reasonProvided, e.reason_length AS reasonLength, e.acknowledged_sensitive_scope AS acknowledgedSensitiveScope, e.occurred_at AS occurredAt FROM conversation_access_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE (? IS NULL OR e.record_id = ?) ORDER BY e.occurred_at DESC, e.id DESC LIMIT 20').all(recordId ?? null, recordId ?? null) as Array<{
      id: string; actorUserId: string; actorName: string; recordId: string; requestId: string; action: 'view'; reasonProvided: number; reasonLength: number; acknowledgedSensitiveScope: number; occurredAt: string
    }>
  }

  incrementConversationAuditExportCount(recordId: string) {
    this.db.prepare('UPDATE conversation_audit_records SET export_count = export_count + 1 WHERE id = ?').run(recordId)
  }

  deleteConversationAuditRecord(recordId: string, auditEvent: PlatformAuditEventSeed, now = this.now()): PlatformConversationAuditDeleteResult | null {
    const prior = this.db.prepare('SELECT request_id AS requestId, deleted_at AS deletedAt, deleted_content_bytes AS deletedContentBytes, audit_event_id AS auditEventId FROM conversation_audit_deletions WHERE record_id = ?').get(recordId) as { requestId: string; deletedAt: string; deletedContentBytes: number; auditEventId: string } | undefined
    if (prior) return { id: recordId, requestId: prior.requestId, deletedAt: prior.deletedAt, deletedContentBytes: prior.deletedContentBytes, auditEventId: prior.auditEventId, idempotent: true }
    const record = this.readConversationRecord(recordId)
    if (!record || record.contentAccessAvailable !== 1) return null
    const content = this.db.prepare('SELECT byte_length AS byteLength FROM conversation_audit_contents WHERE record_id = ?').get(recordId) as { byteLength: number } | undefined
    const deletedAt = now.toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const deletedContentBytes = content?.byteLength ?? 0
      this.db.prepare('DELETE FROM conversation_audit_contents WHERE record_id = ?').run(recordId)
      this.db.prepare('DELETE FROM conversation_audit_operation_events WHERE record_id = ?').run(recordId)
      this.db.prepare('DELETE FROM conversation_access_events WHERE record_id = ?').run(recordId)
      this.db.prepare('DELETE FROM conversation_usage_links WHERE record_id = ?').run(recordId)
      this.db.prepare('DELETE FROM conversation_audit_expiry_proofs WHERE record_id = ?').run(recordId)
      this.db.prepare('DELETE FROM conversation_audit_records WHERE id = ?').run(recordId)
      this.db.prepare('INSERT INTO conversation_audit_deletions(record_id, request_id, actor_user_id, deleted_at, deleted_content_bytes, audit_event_id) VALUES (?, ?, ?, ?, ?, ?)').run(recordId, record.requestId, auditEvent.actorUserId ?? 'user-super-admin', deletedAt, deletedContentBytes, auditEvent.id)
      this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
      return { id: recordId, requestId: record.requestId, deletedAt, deletedContentBytes, auditEventId: auditEvent.id, idempotent: false }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getConversationUsageLink(recordId: string): PlatformConversationUsageLink | null {
    return this.db.prepare('SELECT usage_request_id AS usageRequestId, link_source AS linkSource FROM conversation_usage_links WHERE record_id = ?').get(recordId) as PlatformConversationUsageLink | undefined ?? null
  }

  getUsageConversationLink(usageRequestId: string): PlatformUsageConversationLink | null {
    return this.db.prepare('SELECT record_id AS recordId, link_source AS linkSource FROM conversation_usage_links WHERE usage_request_id = ?').get(usageRequestId) as PlatformUsageConversationLink | undefined ?? null
  }

  purgeConversationAuditRecordsBefore(cutoff: Date | string): ConversationAuditPurgeResult {
    const parsed = cutoff instanceof Date ? cutoff : new Date(cutoff)
    if (Number.isNaN(parsed.getTime())) throw new Error('CONVERSATION_AUDIT_PURGE_CUTOFF_INVALID')
    const cutoffAt = parsed.toISOString()
    const records = this.db.prepare('SELECT id FROM conversation_audit_records WHERE captured_at < ?').all(cutoffAt) as Array<{ id: string }>
    if (!records.length) return { cutoffAt, deletedRecords: 0, deletedContents: 0, deletedOperationEvents: 0, deletedAccessEvents: 0, deletedUsageLinks: 0, deletedExpiryProofs: 0 }
    const placeholders = records.map(() => '?').join(',')
    const ids = records.map((item) => item.id)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const deletedOperationEvents = Number(this.db.prepare('DELETE FROM conversation_audit_operation_events WHERE record_id IN (' + placeholders + ')').run(...ids).changes)
      const deletedAccessEvents = Number(this.db.prepare('DELETE FROM conversation_access_events WHERE record_id IN (' + placeholders + ')').run(...ids).changes)
      const deletedUsageLinks = Number(this.db.prepare('DELETE FROM conversation_usage_links WHERE record_id IN (' + placeholders + ')').run(...ids).changes)
      const deletedExpiryProofs = Number(this.db.prepare('DELETE FROM conversation_audit_expiry_proofs WHERE record_id IN (' + placeholders + ')').run(...ids).changes)
      const deletedContents = Number(this.db.prepare('DELETE FROM conversation_audit_contents WHERE record_id IN (' + placeholders + ')').run(...ids).changes)
      const deletedRecords = Number(this.db.prepare('DELETE FROM conversation_audit_records WHERE id IN (' + placeholders + ')').run(...ids).changes)
      this.db.exec('COMMIT')
      return { cutoffAt, deletedRecords, deletedContents, deletedOperationEvents, deletedAccessEvents, deletedUsageLinks, deletedExpiryProofs }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  cleanupConversationAuditMetadata(triggeredBy: 'startup', now = this.now()) {
    const completedAt = now.toISOString()
    const candidates = this.db.prepare('SELECT id FROM conversation_audit_records WHERE retention_until <= ? AND capture_state = \'captured\'').all(completedAt) as Array<{ id: string }>
    if (!candidates.length) return { triggeredBy, completedAt, expiredRecords: 0, proofRecords: 0, deletedContentBytes: 0 }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const run = this.db.prepare('INSERT INTO conversation_audit_cleanup_runs(triggered_by, completed_at, expired_records, proof_records, deleted_content_bytes) VALUES (?, ?, 0, ?, 0)').run(triggeredBy, completedAt, candidates.length) as { lastInsertRowid: bigint }
      let deletedContentBytes = 0
      for (const item of candidates) {
        const bytes = this.db.prepare('SELECT byte_length AS byteLength FROM conversation_audit_contents WHERE record_id = ?').get(item.id) as { byteLength: number } | undefined
        deletedContentBytes += bytes?.byteLength ?? 0
        this.db.prepare('DELETE FROM conversation_audit_contents WHERE record_id = ?').run(item.id)
        this.db.prepare('UPDATE conversation_audit_records SET capture_state = \'expired\', content_access_available = 0 WHERE id = ?').run(item.id)
        this.db.prepare('INSERT OR REPLACE INTO conversation_audit_expiry_proofs(record_id, cleanup_run_id, expired_at, no_content_was_stored, notice, deleted_content_bytes) VALUES (?, ?, ?, 1, ?, ?)').run(item.id, Number(run.lastInsertRowid), completedAt, '正文已按 30 天策略删除。', bytes?.byteLength ?? 0)
      }
      this.db.prepare('UPDATE conversation_audit_cleanup_runs SET expired_records = ?, deleted_content_bytes = ? WHERE id = ?').run(candidates.length, deletedContentBytes, Number(run.lastInsertRowid))
      this.db.exec('COMMIT')
      return { triggeredBy, completedAt, expiredRecords: candidates.length, proofRecords: candidates.length, deletedContentBytes }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getConversationAuditCleanupStatus(): ConversationAuditCleanupStatus {
    const proofRecords = Number((this.db.prepare('SELECT COUNT(*) AS count FROM conversation_audit_expiry_proofs').get() as { count: number }).count)
    const lastRun = this.db.prepare('SELECT triggered_by AS triggeredBy, completed_at AS completedAt, expired_records AS expiredRecords, proof_records AS proofRecords FROM conversation_audit_cleanup_runs ORDER BY id DESC LIMIT 1').get() as ConversationAuditCleanupStatus['lastRun'] | undefined
    return { proofRecords, lastRun: lastRun ?? null }
  }

  createAuthSession(session: PlatformAuthSessionCreate, now = this.now()) {
    this.db.prepare('INSERT INTO user_sessions(id, user_id, token_hash, csrf_token_hash, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)').run(session.id, session.userId, session.tokenHash, session.csrfTokenHash, session.expiresAt, now.toISOString())
  }

  findAuthSession(tokenHash: string, now = this.now()) {
    const row = this.db.prepare('SELECT s.id AS sessionId, s.csrf_token_hash AS csrfTokenHash, s.expires_at AS expiresAt, u.id AS userId, u.username, u.display_name AS displayName, u.role, u.status FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = \'active\' LIMIT 1').get(tokenHash, now.toISOString()) as {
      sessionId: string; csrfTokenHash: string; expiresAt: string; userId: string; username: string; displayName: string; role: PlatformUserRole; status: 'active' | 'disabled'
    } | undefined
    if (!row) return null
    return { id: row.sessionId, csrfTokenHash: row.csrfTokenHash, expiresAt: row.expiresAt, user: { id: row.userId, username: row.username, displayName: row.displayName, role: row.role, roleLabel: '', status: row.status } }
  }

  isAuthSessionCsrfValid(tokenHash: string, csrfTokenHash: string, now = this.now()) {
    return Boolean(this.db.prepare('SELECT 1 FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.csrf_token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = \'active\' LIMIT 1').get(tokenHash, csrfTokenHash, now.toISOString()))
  }

  revokeAuthSession(tokenHash: string, now = this.now()) {
    this.db.prepare('UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?').run(now.toISOString(), tokenHash)
  }

  cleanupAuthSessions(triggeredBy: SessionCleanupTrigger, now = this.now()): SessionCleanupResult {
    const completedAt = now.toISOString()
    const revokedBefore = new Date(now.getTime() - REVOKED_SESSION_RETENTION_HOURS * 3_600_000).toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const deletedExpired = Number(this.db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(completedAt).changes)
      const deletedRevoked = Number(this.db.prepare('DELETE FROM user_sessions WHERE revoked_at IS NOT NULL AND revoked_at <= ?').run(revokedBefore).changes)
      this.db.prepare('INSERT INTO session_cleanup_runs(triggered_by, completed_at, deleted_expired, deleted_revoked, revoked_retention_hours) VALUES (?, ?, ?, ?, ?)').run(triggeredBy, completedAt, deletedExpired, deletedRevoked, REVOKED_SESSION_RETENTION_HOURS)
      this.db.exec('COMMIT')
      return { triggeredBy, completedAt, deletedExpired, deletedRevoked, revokedRetentionHours: REVOKED_SESSION_RETENTION_HOURS }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  tableCounts() {
    const count = (table: string) => Number((this.db.prepare('SELECT COUNT(*) AS count FROM ' + table).get() as { count: number }).count)
    return {
      users: count('users'),
      apiKeys: count('api_keys'),
      entityDeletions: count('entity_deletions'),
      auditEvents: count('audit_events'),
      usageRequests: count('usage_requests'),
      conversationAccessEvents: count('conversation_access_events'),
      conversationAuditRecords: count('conversation_audit_records'),
      conversationAuditDeletions: count('conversation_audit_deletions'),
      conversationAuditCleanupRuns: count('conversation_audit_cleanup_runs'),
      conversationAuditExpiryProofs: count('conversation_audit_expiry_proofs'),
      conversationUsageLinks: count('conversation_usage_links'),
      userSessions: count('user_sessions'),
      sessionCleanupRuns: count('session_cleanup_runs'),
    }
  }

  findUserByUsername(username: string) {
    return this.db.prepare('SELECT id, username, display_name AS displayName, role, status FROM users WHERE username = ? LIMIT 1').get(username) as PlatformUser | undefined ?? null
  }

  findUserByRole(role: PlatformUserRole) {
    return this.db.prepare('SELECT id, username, display_name AS displayName, role, status FROM users WHERE role = ? AND status = \'active\' ORDER BY created_at, id LIMIT 1').get(role) as PlatformUser | undefined ?? null
  }

  userExists(userId: string) {
    return Boolean(this.db.prepare('SELECT 1 FROM users WHERE id = ? LIMIT 1').get(userId))
  }

  passwordMatches(username: string, password: string) {
    const row = this.db.prepare('SELECT password_hash AS passwordHash FROM users WHERE username = ? AND status = \'active\' LIMIT 1').get(username) as { passwordHash: string } | undefined
    return Boolean(row && row.passwordHash === hashPlatformPassword(password))
  }

  close() {
    this.db.close()
  }
}

export function createPlatformDatabase(options: PlatformDatabaseOptions = {}) {
  return new PlatformDatabase(options)
}
