import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { z } from 'zod'

const migrationSql = [
  `CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES departments(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'department_lead', 'finance', 'employee')),
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    department_id TEXT REFERENCES departments(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    masked_value TEXT NOT NULL,
    purpose TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'expiring', 'revoked')),
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quota_policies (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL CHECK (level IN ('company', 'department', 'person', 'purpose', 'key')),
    subject_id TEXT NOT NULL,
    period TEXT NOT NULL CHECK (period IN ('hour', 'day', 'week', 'month')),
    target_points INTEGER NOT NULL CHECK (target_points >= 0),
    mode TEXT NOT NULL DEFAULT 'soft' CHECK (mode IN ('soft', 'hard')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    result TEXT NOT NULL CHECK (result IN ('success', 'failed', 'denied')),
    request_id TEXT,
    summary_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  );`,
  `ALTER TABLE api_keys ADD COLUMN models_json TEXT NOT NULL DEFAULT '["ecommerce-general"]';`,
  `CREATE TABLE IF NOT EXISTS usage_requests (
    request_id TEXT PRIMARY KEY,
    occurred_at TEXT NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    api_key_id TEXT NOT NULL REFERENCES api_keys(id),
    purpose_id TEXT NOT NULL,
    purpose_name TEXT NOT NULL,
    purpose_alias TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_display_name TEXT NOT NULL,
    actual_model TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    channel_type TEXT NOT NULL CHECK (channel_type IN ('official_api', 'cpa_oauth')),
    protocol TEXT NOT NULL CHECK (protocol IN ('chat_completions', 'responses')),
    streamed INTEGER NOT NULL CHECK (streamed IN (0, 1)),
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    points REAL NOT NULL CHECK (points >= 0),
    first_token_ms INTEGER CHECK (first_token_ms >= 0),
    total_latency_ms INTEGER NOT NULL CHECK (total_latency_ms >= 0),
    cost_type TEXT NOT NULL CHECK (cost_type IN ('official_actual', 'platform_estimate', 'cpa_estimate')),
    cost_amount_usd REAL NOT NULL CHECK (cost_amount_usd >= 0),
    status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled')),
    error_category TEXT CHECK (error_category IN ('rate_limit', 'timeout', 'authentication', 'server', 'cancelled')),
    error_summary TEXT,
    route_alias TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    request_id_propagated INTEGER NOT NULL DEFAULT 0 CHECK (request_id_propagated IN (0, 1)),
    client_name TEXT NOT NULL CHECK (client_name IN ('Codex Desktop', 'WorkBuddy')),
    client_mode TEXT NOT NULL CHECK (client_mode IN ('stream', 'non_stream'))
  );
  CREATE INDEX IF NOT EXISTS usage_requests_occurred_at_idx ON usage_requests(occurred_at DESC);
  CREATE INDEX IF NOT EXISTS usage_requests_owner_idx ON usage_requests(owner_user_id, occurred_at DESC);`,
  `CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('quota', 'traffic', 'error_rate', 'balance', 'credential', 'upstream')),
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    environment TEXT NOT NULL CHECK (environment IN ('production', 'experiment')),
    scope TEXT NOT NULL,
    condition_label TEXT NOT NULL,
    window_label TEXT NOT NULL,
    cooldown_minutes INTEGER NOT NULL CHECK (cooldown_minutes >= 0),
    notification_channel TEXT NOT NULL CHECK (notification_channel IN ('none', 'wecom', 'dingtalk')),
    last_triggered_at TEXT,
    trigger_count_7d INTEGER NOT NULL CHECK (trigger_count_7d >= 0),
    description TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alert_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
    status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'closed')),
    environment TEXT NOT NULL CHECK (environment IN ('production', 'experiment')),
    source TEXT NOT NULL CHECK (source IN ('quota', 'traffic', 'error_rate', 'balance', 'credential', 'upstream')),
    subject_type TEXT NOT NULL CHECK (subject_type IN ('company', 'department', 'person', 'key', 'channel', 'upstream')),
    subject_id TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    rule_id TEXT NOT NULL REFERENCES alert_rules(id),
    rule_name TEXT NOT NULL,
    rule_metric TEXT NOT NULL,
    threshold_label TEXT NOT NULL,
    trigger_value_label TEXT NOT NULL,
    trigger_comparator TEXT NOT NULL CHECK (trigger_comparator IN ('gte', 'gt', 'lte', 'eq')),
    first_occurred_at TEXT NOT NULL,
    last_occurred_at TEXT NOT NULL,
    occurrences INTEGER NOT NULL CHECK (occurrences > 0),
    assignee_user_id TEXT REFERENCES users(id),
    acknowledged_at TEXT,
    closed_at TEXT,
    notification_state TEXT NOT NULL CHECK (notification_state IN ('not_configured', 'not_sent', 'sent', 'failed')),
    notification_channel TEXT NOT NULL CHECK (notification_channel IN ('none', 'wecom', 'dingtalk')),
    notification_sent_at TEXT,
    silence_active INTEGER NOT NULL CHECK (silence_active IN (0, 1)),
    silence_until TEXT,
    related_request_ids_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS alert_events_last_occurred_at_idx ON alert_events(last_occurred_at DESC);
  CREATE INDEX IF NOT EXISTS alert_events_status_idx ON alert_events(status, severity, environment);`,
  `CREATE TABLE IF NOT EXISTS conversation_access_events (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    record_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('view_synthetic')),
    reason_provided INTEGER NOT NULL CHECK (reason_provided IN (0, 1)),
    reason_length INTEGER NOT NULL CHECK (reason_length BETWEEN 8 AND 200),
    acknowledged_sensitive_scope INTEGER NOT NULL CHECK (acknowledged_sensitive_scope IN (0, 1)),
    occurred_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS conversation_access_events_record_idx ON conversation_access_events(record_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS conversation_access_events_actor_idx ON conversation_access_events(actor_user_id, occurred_at DESC);`,
  `CREATE TABLE IF NOT EXISTS system_business_rules (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    label TEXT NOT NULL,
    value TEXT NOT NULL,
    impact TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('fixed', 'unverified')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS system_feature_flags (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    reason TEXT NOT NULL,
    risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS system_role_definitions (
    id TEXT PRIMARY KEY CHECK (id IN ('super_admin', 'admin', 'department_lead', 'finance', 'employee')),
    name TEXT NOT NULL,
    data_scope TEXT NOT NULL,
    permission_summary TEXT NOT NULL,
    high_privilege INTEGER NOT NULL CHECK (high_privilege IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS system_retention_policies (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    retention_days INTEGER NOT NULL CHECK (retention_days >= 0),
    applies_to TEXT NOT NULL,
    cleanup_state TEXT NOT NULL CHECK (cleanup_state IN ('not_configured', 'unverified')),
    minimum_necessary INTEGER NOT NULL CHECK (minimum_necessary IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS system_backup_status (
    id TEXT PRIMARY KEY CHECK (id = 'platform-sqlite'),
    configured INTEGER NOT NULL DEFAULT 0 CHECK (configured = 0),
    storage_target_configured INTEGER NOT NULL DEFAULT 0 CHECK (storage_target_configured = 0),
    last_backup_at TEXT CHECK (last_backup_at IS NULL),
    last_verified_at TEXT CHECK (last_verified_at IS NULL),
    last_restore_drill_at TEXT CHECK (last_restore_drill_at IS NULL),
    browser_download_allowed INTEGER NOT NULL DEFAULT 0 CHECK (browser_download_allowed = 0),
    notice TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `ALTER TABLE users ADD COLUMN employee_code TEXT;
  ALTER TABLE users ADD COLUMN manager_name TEXT;
  ALTER TABLE users ADD COLUMN joined_at TEXT;`,
  `CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
    csrf_token_hash TEXT NOT NULL CHECK (length(csrf_token_hash) = 64),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS user_sessions_active_token_idx ON user_sessions(token_hash, expires_at) WHERE revoked_at IS NULL;`,
  `CREATE TABLE IF NOT EXISTS session_cleanup_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    triggered_by TEXT NOT NULL CHECK (triggered_by IN ('startup', 'login')),
    completed_at TEXT NOT NULL,
    deleted_expired INTEGER NOT NULL CHECK (deleted_expired >= 0),
    deleted_revoked INTEGER NOT NULL CHECK (deleted_revoked >= 0),
    revoked_retention_hours INTEGER NOT NULL CHECK (revoked_retention_hours > 0)
  );
  CREATE INDEX IF NOT EXISTS session_cleanup_runs_completed_idx ON session_cleanup_runs(completed_at DESC);`,
  `ALTER TABLE audit_events ADD COLUMN previous_hash TEXT;
  ALTER TABLE audit_events ADD COLUMN event_hash TEXT;`,
]

export const databaseStatusSchema = z.object({
  state: z.literal('ready'),
  location: z.string(),
  migrationVersion: z.number().int().nonnegative(),
  tables: z.array(z.string()),
  checkedAt: z.string().datetime(),
  sessionCleanup: z.object({
    revokedRetentionHours: z.literal(24),
    lastRun: z.object({
      triggeredBy: z.enum(['startup', 'login']),
      completedAt: z.string().datetime(),
      deletedExpired: z.number().int().nonnegative(),
      deletedRevoked: z.number().int().nonnegative(),
    }).nullable(),
  }),
  auditChain: z.object({
    algorithm: z.literal('sha256'),
    verified: z.boolean(),
    checkedAt: z.string().datetime(),
    eventCount: z.number().int().nonnegative(),
    firstInvalidEventId: z.string().nullable(),
  }),
})
export type DatabaseStatus = z.infer<typeof databaseStatusSchema>

export type PlatformUserRole = 'super_admin' | 'admin' | 'department_lead' | 'finance' | 'employee'
export interface PlatformUser {
  id: string
  username: string
  displayName: string
  role: PlatformUserRole
  roleLabel: string
  status: 'active' | 'disabled'
  departmentId: string | null
}

export interface PlatformUserSeed {
  id: string
  username: string
  displayName: string
  role: PlatformUserRole
  roleLabel: string
  password: string
  status?: 'active' | 'disabled'
  departmentId?: string | null
  employeeCode?: string | null
  managerName?: string | null
  joinedAt?: string | null
}

export interface PlatformDepartmentSeed {
  id: string
  name: string
  parentId?: string | null
  status?: 'active' | 'inactive'
}

export interface PlatformApiKeySeed {
  id: string
  ownerUserId: string
  maskedValue: string
  purpose: string
  status: 'active' | 'expiring' | 'revoked'
  expiresAt?: string | null
  models?: string[]
}

export interface PlatformQuotaPolicySeed {
  id: string
  level: 'company' | 'department' | 'person' | 'purpose' | 'key'
  subjectId: string
  period: 'hour' | 'day' | 'week' | 'month'
  targetPoints: number
  mode?: 'soft' | 'hard'
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
  channel: { id: string; name: string; type: 'official_api' | 'cpa_oauth' }
  protocol?: 'chat_completions' | 'responses'
  streamed?: boolean
  tokens: { input: number; output: number }
  points: number
  latency: { firstTokenMs: number | null; totalMs: number }
  cost: { type: 'official_actual' | 'platform_estimate' | 'cpa_estimate'; amountUsd: number }
  status: 'succeeded' | 'failed' | 'cancelled'
  error?: { category: 'rate_limit' | 'timeout' | 'authentication' | 'server' | 'cancelled'; summary: string } | null
  routeAlias: string
  retryCount?: number
  requestIdPropagated?: boolean
  client: { name: 'Codex Desktop' | 'WorkBuddy'; mode: 'stream' | 'non_stream' }
}

export interface PlatformAlertRuleSeed {
  id: string
  name: string
  category: 'quota' | 'traffic' | 'error_rate' | 'balance' | 'credential' | 'upstream'
  severity: 'critical' | 'warning' | 'info'
  enabled: boolean
  environment: 'production' | 'experiment'
  scope: string
  condition: string
  window: string
  cooldownMinutes: number
  notificationChannel?: 'none' | 'wecom' | 'dingtalk'
  lastTriggeredAt?: string | null
  triggerCount7d: number
  description: string
}

export interface PlatformAlertEventSeed {
  id: string
  title: string
  summary: string
  severity: 'critical' | 'warning' | 'info'
  status: 'open' | 'acknowledged' | 'closed'
  environment: 'production' | 'experiment'
  source: PlatformAlertRuleSeed['category']
  subject: { type: 'company' | 'department' | 'person' | 'key' | 'channel' | 'upstream'; id: string; name: string }
  rule: { id: string; name: string; metric: string; thresholdLabel: string }
  trigger: { valueLabel: string; comparator: 'gte' | 'gt' | 'lte' | 'eq' }
  firstOccurredAt: string
  lastOccurredAt: string
  occurrences: number
  assigneeUserId?: string | null
  acknowledgedAt?: string | null
  closedAt?: string | null
  notification?: { state: 'not_configured' | 'not_sent' | 'sent' | 'failed'; channel: 'none' | 'wecom' | 'dingtalk'; sentAt?: string | null }
  silence?: { active: boolean; until?: string | null }
  relatedRequestIds?: string[]
}

export interface PlatformPersonCreate {
  id: string
  username: string
  displayName: string
  departmentId: string
  password: string
}

export interface PlatformApiKeyCreate {
  id: string
  ownerUserId: string
  maskedValue: string
  purpose: string
  expiresAt: string
  models: string[]
}

export interface PlatformConversationAccessCreate {
  id: string
  actorUserId: string
  recordId: string
  requestId: string
  action: 'view_synthetic'
  reasonProvided: boolean
  reasonLength: number
  acknowledgedSensitiveScope: boolean
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

export interface AuditChainVerification {
  algorithm: 'sha256'
  verified: boolean
  checkedAt: string
  eventCount: number
  firstInvalidEventId: string | null
}

interface AuditChainRow {
  sequence: number
  id: string
  actorUserId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  result: 'success' | 'failed' | 'denied'
  requestId: string | null
  summaryJson: string
  occurredAt: string
  previousHash: string | null
  eventHash: string | null
}

function auditEventHash(row: Omit<AuditChainRow, 'sequence' | 'previousHash' | 'eventHash'>, previousHash: string | null) {
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    previousHash,
    id: row.id,
    actorUserId: row.actorUserId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    result: row.result,
    requestId: row.requestId,
    summaryJson: row.summaryJson,
    occurredAt: row.occurredAt,
  })).digest('hex')
}

export interface PlatformBusinessRuleSeed {
  id: string
  version: string
  label: string
  value: string
  impact: string
  status: 'fixed' | 'unverified'
}

export interface PlatformFeatureFlagSeed {
  id: string
  label: string
  enabled: boolean
  reason: string
  risk: 'low' | 'medium' | 'high'
}

export interface PlatformRoleDefinitionSeed {
  id: PlatformUserRole
  name: string
  dataScope: string
  permissionSummary: string
  highPrivilege: boolean
}

export interface PlatformRetentionPolicySeed {
  id: string
  label: string
  days: number
  appliesTo: string
  cleanupState: 'not_configured' | 'unverified'
  minimumNecessary: boolean
}

export interface PlatformBackupStatusSeed {
  id: 'platform-sqlite'
  notice: string
}

export function hashPlatformPassword(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export interface PlatformDatabaseOptions {
  filename?: string
  now?: () => Date
}

export class PlatformDatabase {
  readonly filename: string
  private readonly db: DatabaseSync
  private readonly now: () => Date

  constructor(options: PlatformDatabaseOptions = {}) {
    this.filename = options.filename ?? resolve(process.cwd(), 'data', 'platform.sqlite')
    this.now = options.now ?? (() => new Date())
    if (this.filename !== ':memory:') mkdirSync(dirname(this.filename), { recursive: true })
    this.db = new DatabaseSync(this.filename)
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    if (this.filename !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;')
    this.migrate()
  }

  migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);')
    const applied = this.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>
    const appliedVersions = new Set(applied.map((item) => item.version))
    for (const [index, sql] of migrationSql.entries()) {
      const version = index + 1
      if (appliedVersions.has(version)) continue
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec(sql)
        if (version === 13) this.rebuildAuditChain()
        this.db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(version, `platform_core_${version}`, this.now().toISOString())
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
  }

  status(): DatabaseStatus {
    const version = this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number }
    const rows = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>
    const lastRun = this.db.prepare(`SELECT triggered_by AS triggeredBy, completed_at AS completedAt,
      deleted_expired AS deletedExpired, deleted_revoked AS deletedRevoked
      FROM session_cleanup_runs ORDER BY id DESC LIMIT 1`).get() as Omit<SessionCleanupResult, 'revokedRetentionHours'> | undefined
    return {
      state: 'ready', location: this.filename, migrationVersion: version.version, tables: rows.map((item) => item.name), checkedAt: this.now().toISOString(),
      sessionCleanup: { revokedRetentionHours: REVOKED_SESSION_RETENTION_HOURS, lastRun: lastRun ?? null },
      auditChain: this.verifyAuditChain(),
    }
  }

  private auditChainRows() {
    return this.db.prepare(`SELECT rowid AS sequence, id, actor_user_id AS actorUserId, action,
      resource_type AS resourceType, resource_id AS resourceId, result, request_id AS requestId,
      summary_json AS summaryJson, occurred_at AS occurredAt, previous_hash AS previousHash, event_hash AS eventHash
      FROM audit_events ORDER BY rowid ASC`).all() as unknown as AuditChainRow[]
  }

  private rebuildAuditChain() {
    let previousHash: string | null = null
    const update = this.db.prepare('UPDATE audit_events SET previous_hash = ?, event_hash = ? WHERE rowid = ?')
    for (const row of this.auditChainRows()) {
      const eventHash = auditEventHash(row, previousHash)
      update.run(previousHash, eventHash, row.sequence)
      previousHash = eventHash
    }
  }

  verifyAuditChain(now = this.now()): AuditChainVerification {
    let previousHash: string | null = null
    const rows = this.auditChainRows()
    for (const row of rows) {
      const expectedHash = auditEventHash(row, previousHash)
      if (row.previousHash !== previousHash || row.eventHash !== expectedHash) {
        return { algorithm: 'sha256', verified: false, checkedAt: now.toISOString(), eventCount: rows.length, firstInvalidEventId: row.id }
      }
      previousHash = row.eventHash
    }
    return { algorithm: 'sha256', verified: true, checkedAt: now.toISOString(), eventCount: rows.length, firstInvalidEventId: null }
  }

  seedUser(seed: PlatformUserSeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.prepare(`INSERT INTO users(id, username, display_name, role, password_hash, status, department_id, employee_code, manager_name, joined_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET id = excluded.id, display_name = excluded.display_name,
      role = excluded.role, password_hash = excluded.password_hash, status = excluded.status,
      department_id = excluded.department_id, employee_code = excluded.employee_code,
      manager_name = excluded.manager_name, joined_at = excluded.joined_at, updated_at = excluded.updated_at`).run(
      seed.id, seed.username, seed.displayName, seed.role, hashPlatformPassword(seed.password), seed.status ?? 'active', seed.departmentId ?? null,
      seed.employeeCode ?? null, seed.managerName ?? null, seed.joinedAt ?? null, timestamp, timestamp,
    )
  }

  seedDepartment(seed: PlatformDepartmentSeed, now = this.now()) {
    this.db.prepare(`INSERT INTO departments(id, name, parent_id, status, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id, status = excluded.status`).run(
      seed.id, seed.name, seed.parentId ?? null, seed.status ?? 'active', now.toISOString(),
    )
  }

  seedApiKey(seed: PlatformApiKeySeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.prepare(`INSERT INTO api_keys(id, owner_user_id, masked_value, purpose, status, expires_at, models_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner_user_id = excluded.owner_user_id, masked_value = excluded.masked_value,
      purpose = excluded.purpose, status = excluded.status, expires_at = excluded.expires_at, models_json = excluded.models_json, updated_at = excluded.updated_at`).run(
      seed.id, seed.ownerUserId, seed.maskedValue, seed.purpose, seed.status, seed.expiresAt ?? null, JSON.stringify(seed.models ?? ['ecommerce-general']), timestamp, timestamp,
    )
  }

  seedQuotaPolicy(seed: PlatformQuotaPolicySeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.prepare(`INSERT INTO quota_policies(id, level, subject_id, period, target_points, mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET level = excluded.level, subject_id = excluded.subject_id,
      period = excluded.period, target_points = excluded.target_points, mode = excluded.mode, updated_at = excluded.updated_at`).run(
      seed.id, seed.level, seed.subjectId, seed.period, seed.targetPoints, seed.mode ?? 'soft', timestamp, timestamp,
    )
  }

  seedAuditEvent(seed: PlatformAuditEventSeed, now = this.now()) {
    if (this.db.prepare('SELECT 1 FROM audit_events WHERE id = ? LIMIT 1').get(seed.id)) return
    this.appendAuditEvent(seed, now)
  }

  appendAuditEvent(seed: PlatformAuditEventSeed, now = this.now()) {
    const integrity = this.verifyAuditChain(now)
    if (!integrity.verified) throw new Error(`AUDIT_CHAIN_INVALID:${integrity.firstInvalidEventId}`)
    const previousHash = this.db.prepare('SELECT event_hash AS eventHash FROM audit_events ORDER BY rowid DESC LIMIT 1').get() as { eventHash: string } | undefined
    const row = {
      id: seed.id, actorUserId: seed.actorUserId ?? null, action: seed.action, resourceType: seed.resourceType,
      resourceId: seed.resourceId ?? null, result: seed.result, requestId: seed.requestId ?? null,
      summaryJson: JSON.stringify(seed.summary), occurredAt: now.toISOString(),
    }
    const eventHash = auditEventHash(row, previousHash?.eventHash ?? null)
    this.db.prepare(`INSERT INTO audit_events(id, actor_user_id, action, resource_type, resource_id, result, request_id, summary_json, occurred_at, previous_hash, event_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      row.id, row.actorUserId, row.action, row.resourceType, row.resourceId, row.result,
      row.requestId, row.summaryJson, row.occurredAt, previousHash?.eventHash ?? null, eventHash,
    )
  }

  seedUsageRequest(seed: PlatformUsageRequestSeed) {
    this.db.prepare(`INSERT INTO usage_requests(
      request_id, occurred_at, owner_user_id, api_key_id, purpose_id, purpose_name, purpose_alias,
      model_id, model_display_name, actual_model, channel_id, channel_name, channel_type, protocol,
      streamed, input_tokens, output_tokens, points, first_token_ms, total_latency_ms, cost_type,
      cost_amount_usd, status, error_category, error_summary, route_alias, retry_count,
      request_id_propagated, client_name, client_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(request_id) DO UPDATE SET
      occurred_at = excluded.occurred_at, owner_user_id = excluded.owner_user_id, api_key_id = excluded.api_key_id,
      purpose_id = excluded.purpose_id, purpose_name = excluded.purpose_name, purpose_alias = excluded.purpose_alias,
      model_id = excluded.model_id, model_display_name = excluded.model_display_name, actual_model = excluded.actual_model,
      channel_id = excluded.channel_id, channel_name = excluded.channel_name, channel_type = excluded.channel_type,
      protocol = excluded.protocol, streamed = excluded.streamed, input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens, points = excluded.points, first_token_ms = excluded.first_token_ms,
      total_latency_ms = excluded.total_latency_ms, cost_type = excluded.cost_type, cost_amount_usd = excluded.cost_amount_usd,
      status = excluded.status, error_category = excluded.error_category, error_summary = excluded.error_summary,
      route_alias = excluded.route_alias, retry_count = excluded.retry_count,
      request_id_propagated = excluded.request_id_propagated, client_name = excluded.client_name, client_mode = excluded.client_mode`).run(
      seed.requestId, seed.occurredAt, seed.ownerUserId, seed.apiKeyId, seed.purpose.id, seed.purpose.name, seed.purpose.alias,
      seed.model.id, seed.model.displayName, seed.model.actualModel, seed.channel.id, seed.channel.name, seed.channel.type,
      seed.protocol ?? 'chat_completions', Number(seed.streamed ?? false), seed.tokens.input, seed.tokens.output,
      seed.points, seed.latency.firstTokenMs, seed.latency.totalMs, seed.cost.type, seed.cost.amountUsd, seed.status,
      seed.error?.category ?? null, seed.error?.summary ?? null, seed.routeAlias, seed.retryCount ?? 0,
      Number(seed.requestIdPropagated ?? true), seed.client.name, seed.client.mode,
    )
  }

  seedAlertRule(seed: PlatformAlertRuleSeed) {
    this.db.prepare(`INSERT INTO alert_rules(
      id, name, category, severity, enabled, environment, scope, condition_label, window_label,
      cooldown_minutes, notification_channel, last_triggered_at, trigger_count_7d, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, category = excluded.category, severity = excluded.severity, enabled = excluded.enabled,
      environment = excluded.environment, scope = excluded.scope, condition_label = excluded.condition_label,
      window_label = excluded.window_label, cooldown_minutes = excluded.cooldown_minutes,
      notification_channel = excluded.notification_channel, last_triggered_at = excluded.last_triggered_at,
      trigger_count_7d = excluded.trigger_count_7d, description = excluded.description`).run(
      seed.id, seed.name, seed.category, seed.severity, Number(seed.enabled), seed.environment, seed.scope,
      seed.condition, seed.window, seed.cooldownMinutes, seed.notificationChannel ?? 'none',
      seed.lastTriggeredAt ?? null, seed.triggerCount7d, seed.description,
    )
  }

  seedAlertEvent(seed: PlatformAlertEventSeed) {
    this.db.prepare(`INSERT INTO alert_events(
      id, title, summary, severity, status, environment, source, subject_type, subject_id, subject_name,
      rule_id, rule_name, rule_metric, threshold_label, trigger_value_label, trigger_comparator,
      first_occurred_at, last_occurred_at, occurrences, assignee_user_id, acknowledged_at, closed_at,
      notification_state, notification_channel, notification_sent_at, silence_active, silence_until,
      related_request_ids_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, summary = excluded.summary, severity = excluded.severity, status = excluded.status,
      environment = excluded.environment, source = excluded.source, subject_type = excluded.subject_type,
      subject_id = excluded.subject_id, subject_name = excluded.subject_name, rule_id = excluded.rule_id,
      rule_name = excluded.rule_name, rule_metric = excluded.rule_metric, threshold_label = excluded.threshold_label,
      trigger_value_label = excluded.trigger_value_label, trigger_comparator = excluded.trigger_comparator,
      first_occurred_at = excluded.first_occurred_at, last_occurred_at = excluded.last_occurred_at,
      occurrences = excluded.occurrences, assignee_user_id = excluded.assignee_user_id,
      acknowledged_at = excluded.acknowledged_at, closed_at = excluded.closed_at,
      notification_state = excluded.notification_state, notification_channel = excluded.notification_channel,
      notification_sent_at = excluded.notification_sent_at, silence_active = excluded.silence_active,
      silence_until = excluded.silence_until, related_request_ids_json = excluded.related_request_ids_json`).run(
      seed.id, seed.title, seed.summary, seed.severity, seed.status, seed.environment, seed.source,
      seed.subject.type, seed.subject.id, seed.subject.name, seed.rule.id, seed.rule.name, seed.rule.metric,
      seed.rule.thresholdLabel, seed.trigger.valueLabel, seed.trigger.comparator, seed.firstOccurredAt,
      seed.lastOccurredAt, seed.occurrences, seed.assigneeUserId ?? null, seed.acknowledgedAt ?? null,
      seed.closedAt ?? null, seed.notification?.state ?? 'not_configured', seed.notification?.channel ?? 'none',
      seed.notification?.sentAt ?? null, Number(seed.silence?.active ?? false), seed.silence?.until ?? null,
      JSON.stringify(seed.relatedRequestIds ?? []),
    )
  }

  seedBusinessRule(seed: PlatformBusinessRuleSeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.prepare(`INSERT INTO system_business_rules(id, version, label, value, impact, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET version = excluded.version, label = excluded.label, value = excluded.value,
      impact = excluded.impact, status = excluded.status, updated_at = excluded.updated_at`).run(
      seed.id, seed.version, seed.label, seed.value, seed.impact, seed.status, timestamp, timestamp,
    )
  }

  seedFeatureFlag(seed: PlatformFeatureFlagSeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.prepare(`INSERT INTO system_feature_flags(id, label, enabled, reason, risk, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET label = excluded.label, enabled = excluded.enabled, reason = excluded.reason,
      risk = excluded.risk, updated_at = excluded.updated_at`).run(
      seed.id, seed.label, Number(seed.enabled), seed.reason, seed.risk, timestamp, timestamp,
    )
  }

  seedRoleDefinition(seed: PlatformRoleDefinitionSeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.prepare(`INSERT INTO system_role_definitions(
      id, name, data_scope, permission_summary, high_privilege, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, data_scope = excluded.data_scope,
    permission_summary = excluded.permission_summary, high_privilege = excluded.high_privilege,
    updated_at = excluded.updated_at`).run(
      seed.id, seed.name, seed.dataScope, seed.permissionSummary, Number(seed.highPrivilege), timestamp, timestamp,
    )
  }

  seedRetentionPolicy(seed: PlatformRetentionPolicySeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.prepare(`INSERT INTO system_retention_policies(
      id, label, retention_days, applies_to, cleanup_state, minimum_necessary, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET label = excluded.label, retention_days = excluded.retention_days,
    applies_to = excluded.applies_to, cleanup_state = excluded.cleanup_state,
    minimum_necessary = excluded.minimum_necessary, updated_at = excluded.updated_at`).run(
      seed.id, seed.label, seed.days, seed.appliesTo, seed.cleanupState, Number(seed.minimumNecessary), timestamp, timestamp,
    )
  }

  seedBackupStatus(seed: PlatformBackupStatusSeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.prepare(`INSERT INTO system_backup_status(
      id, configured, storage_target_configured, last_backup_at, last_verified_at, last_restore_drill_at,
      browser_download_allowed, notice, created_at, updated_at
    ) VALUES (?, 0, 0, NULL, NULL, NULL, 0, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET notice = excluded.notice, updated_at = excluded.updated_at`).run(
      seed.id, seed.notice, timestamp, timestamp,
    )
  }

  setUserDepartment(userId: string, departmentId: string | null) {
    this.db.prepare('UPDATE users SET department_id = ?, updated_at = ? WHERE id = ?').run(departmentId, this.now().toISOString(), userId)
  }

  listPeople() {
    return this.db.prepare(`SELECT u.id, u.username, u.display_name AS displayName, u.status,
      d.id AS departmentId, d.name AS departmentName
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.role = 'employee' ORDER BY u.created_at, u.display_name`).all() as Array<{
        id: string
        username: string
        displayName: string
        status: 'active' | 'disabled'
        departmentId: string | null
        departmentName: string | null
      }>
  }

  getEmployeeProfile(userId: string) {
    return this.db.prepare(`SELECT u.id, u.display_name AS displayName, u.status,
      COALESCE(d.name, '未分配部门') AS departmentName,
      COALESCE(u.employee_code, 'LOCAL-' || UPPER(SUBSTR(u.id, 1, 8))) AS employeeCode,
      COALESCE(u.manager_name, '未设置负责人') AS managerName,
      SUBSTR(COALESCE(u.joined_at, u.created_at), 1, 10) AS joinedAt
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = ? AND u.role = 'employee' AND u.status = 'active' LIMIT 1`).get(userId) as {
        id: string
        displayName: string
        status: 'active'
        departmentName: string
        employeeCode: string
        managerName: string
        joinedAt: string
      } | undefined
  }

  departmentExists(departmentId: string) {
    return Boolean(this.db.prepare('SELECT 1 FROM departments WHERE id = ? AND status = \'active\' LIMIT 1').get(departmentId))
  }

  createPerson(person: PlatformPersonCreate, auditEvent?: PlatformAuditEventSeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`INSERT INTO users(id, username, display_name, role, password_hash, status, department_id, created_at, updated_at)
        VALUES (?, ?, ?, 'employee', ?, 'active', ?, ?, ?)`).run(
        person.id, person.username, person.displayName, hashPlatformPassword(person.password), person.departmentId, timestamp, timestamp,
      )
      if (auditEvent) this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.listPeople().find((item) => item.id === person.id) ?? null
  }

  listApiKeys() {
    const rows = this.db.prepare(`SELECT k.id, k.owner_user_id AS ownerUserId, k.masked_value AS maskedValue,
      k.purpose, k.status, k.expires_at AS expiresAt, k.models_json AS modelsJson, k.created_at AS createdAt,
      u.display_name AS ownerName, d.id AS departmentId, d.name AS departmentName
      FROM api_keys k JOIN users u ON u.id = k.owner_user_id
      LEFT JOIN departments d ON d.id = u.department_id ORDER BY k.created_at DESC, k.id`).all() as Array<{
        id: string
        ownerUserId: string
        maskedValue: string
        purpose: string
        status: 'active' | 'expiring' | 'revoked'
        expiresAt: string | null
        modelsJson: string
        createdAt: string
        ownerName: string
        departmentId: string | null
        departmentName: string | null
      }>
    return rows.map((row) => ({ ...row, models: JSON.parse(row.modelsJson) as string[] }))
  }

  listApiKeysForOwner(ownerUserId: string) {
    const rows = this.db.prepare(`SELECT k.id, k.masked_value AS maskedValue, k.purpose, k.status,
      k.expires_at AS expiresAt, k.models_json AS modelsJson, k.created_at AS createdAt,
      MAX(r.occurred_at) AS lastUsedAt
      FROM api_keys k LEFT JOIN usage_requests r ON r.api_key_id = k.id AND r.owner_user_id = k.owner_user_id
      WHERE k.owner_user_id = ? AND k.status IN ('active', 'expiring')
      GROUP BY k.id, k.masked_value, k.purpose, k.status, k.expires_at, k.models_json, k.created_at
      ORDER BY k.created_at DESC, k.id`).all(ownerUserId) as Array<{
        id: string
        maskedValue: string
        purpose: string
        status: 'active' | 'expiring'
        expiresAt: string | null
        modelsJson: string
        createdAt: string
        lastUsedAt: string | null
      }>
    return rows.map((row) => ({ ...row, models: JSON.parse(row.modelsJson) as string[] }))
  }

  findPersonDepartmentId(personId: string) {
    const row = this.db.prepare("SELECT department_id AS departmentId FROM users WHERE id = ? AND role = 'employee' LIMIT 1").get(personId) as { departmentId: string | null } | undefined
    return row?.departmentId ?? null
  }

  findKeyDepartmentId(keyId: string) {
    const row = this.db.prepare(`SELECT u.department_id AS departmentId FROM api_keys k
      JOIN users u ON u.id = k.owner_user_id WHERE k.id = ? LIMIT 1`).get(keyId) as { departmentId: string | null } | undefined
    return row?.departmentId ?? null
  }

  ownerExists(ownerUserId: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'employee' AND status = 'active' LIMIT 1").get(ownerUserId))
  }

  createApiKey(key: PlatformApiKeyCreate, auditEvent?: PlatformAuditEventSeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`INSERT INTO api_keys(id, owner_user_id, masked_value, purpose, status, expires_at, models_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`).run(
        key.id, key.ownerUserId, key.maskedValue, key.purpose, key.expiresAt, JSON.stringify(key.models), timestamp, timestamp,
      )
      if (auditEvent) this.appendAuditEvent(auditEvent, now)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.listApiKeys().find((item) => item.id === key.id) ?? null
  }

  listQuotaPolicies() {
    return this.db.prepare(`SELECT id, level, subject_id AS subjectId, period, target_points AS targetPoints, mode,
      created_at AS createdAt, updated_at AS updatedAt FROM quota_policies ORDER BY level, subject_id, period`).all() as Array<{
        id: string
        level: 'company' | 'department' | 'person' | 'purpose' | 'key'
        subjectId: string
        period: 'hour' | 'day' | 'week' | 'month'
        targetPoints: number
        mode: 'soft' | 'hard'
        createdAt: string
      updatedAt: string
      }>
  }

  listAuditEvents() {
    const rows = this.db.prepare(`SELECT a.id, a.actor_user_id AS actorUserId, u.display_name AS actorName, u.role AS actorRole,
      a.action, a.resource_type AS resourceType, a.resource_id AS resourceId, a.result, a.request_id AS requestId,
      a.summary_json AS summaryJson, a.occurred_at AS occurredAt, a.previous_hash AS previousHash, a.event_hash AS eventHash
      FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
      ORDER BY a.occurred_at DESC, a.id DESC`).all() as Array<{
        id: string
        actorUserId: string | null
        actorName: string | null
        actorRole: PlatformUserRole | null
        action: string
        resourceType: string
        resourceId: string | null
        result: 'success' | 'failed' | 'denied'
        requestId: string | null
        summaryJson: string
        occurredAt: string
        previousHash: string | null
        eventHash: string | null
      }>
    return rows.map((row) => {
      try {
        return { ...row, summary: JSON.parse(row.summaryJson) as Record<string, unknown> }
      } catch {
        return { ...row, summary: {} }
      }
    })
  }

  listUsageRequests(ownerUserId?: string) {
    return this.db.prepare(`SELECT r.request_id AS requestId, r.occurred_at AS occurredAt,
      u.id AS personId, u.display_name AS personName, d.id AS departmentId, d.name AS departmentName,
      k.id AS keyId, k.masked_value AS maskedValue,
      r.purpose_id AS purposeId, r.purpose_name AS purposeName, r.purpose_alias AS purposeAlias,
      r.model_id AS modelId, r.model_display_name AS modelDisplayName, r.actual_model AS actualModel,
      r.channel_id AS channelId, r.channel_name AS channelName, r.channel_type AS channelType,
      r.protocol, r.streamed, r.input_tokens AS inputTokens, r.output_tokens AS outputTokens, r.points,
      r.first_token_ms AS firstTokenMs, r.total_latency_ms AS totalLatencyMs, r.cost_type AS costType,
      r.cost_amount_usd AS costAmountUsd, r.status, r.error_category AS errorCategory, r.error_summary AS errorSummary,
      r.route_alias AS routeAlias, r.retry_count AS retryCount, r.request_id_propagated AS requestIdPropagated,
      r.client_name AS clientName, r.client_mode AS clientMode
      FROM usage_requests r
      JOIN users u ON u.id = r.owner_user_id
      LEFT JOIN departments d ON d.id = u.department_id
      JOIN api_keys k ON k.id = r.api_key_id
      WHERE (? IS NULL OR r.owner_user_id = ?)
      ORDER BY r.occurred_at DESC, r.request_id DESC`).all(ownerUserId ?? null, ownerUserId ?? null) as Array<{
        requestId: string; occurredAt: string; personId: string; personName: string; departmentId: string | null; departmentName: string | null
        keyId: string; maskedValue: string; purposeId: string; purposeName: string; purposeAlias: string
        modelId: string; modelDisplayName: string; actualModel: string; channelId: string; channelName: string; channelType: 'official_api' | 'cpa_oauth'
        protocol: 'chat_completions' | 'responses'; streamed: number; inputTokens: number; outputTokens: number; points: number
        firstTokenMs: number | null; totalLatencyMs: number; costType: 'official_actual' | 'platform_estimate' | 'cpa_estimate'; costAmountUsd: number
        status: 'succeeded' | 'failed' | 'cancelled'; errorCategory: 'rate_limit' | 'timeout' | 'authentication' | 'server' | 'cancelled' | null; errorSummary: string | null
        routeAlias: string; retryCount: number; requestIdPropagated: number; clientName: 'Codex Desktop' | 'WorkBuddy'; clientMode: 'stream' | 'non_stream'
      }>
  }

  listAlertRules() {
    return this.db.prepare(`SELECT id, name, category, severity, enabled, environment, scope,
      condition_label AS condition, window_label AS window, cooldown_minutes AS cooldownMinutes,
      notification_channel AS notificationChannel, last_triggered_at AS lastTriggeredAt,
      trigger_count_7d AS triggerCount7d, description
      FROM alert_rules ORDER BY environment, category, id`).all() as Array<{
        id: string; name: string; category: PlatformAlertRuleSeed['category']; severity: PlatformAlertRuleSeed['severity']; enabled: number
        environment: 'production' | 'experiment'; scope: string; condition: string; window: string; cooldownMinutes: number
        notificationChannel: 'none' | 'wecom' | 'dingtalk'; lastTriggeredAt: string | null; triggerCount7d: number; description: string
      }>
  }

  listAlertEvents() {
    const rows = this.db.prepare(`SELECT e.id, e.title, e.summary, e.severity, e.status, e.environment, e.source,
      e.subject_type AS subjectType, e.subject_id AS subjectId, e.subject_name AS subjectName,
      e.rule_id AS ruleId, e.rule_name AS ruleName, e.rule_metric AS ruleMetric, e.threshold_label AS thresholdLabel,
      e.trigger_value_label AS triggerValueLabel, e.trigger_comparator AS triggerComparator,
      e.first_occurred_at AS firstOccurredAt, e.last_occurred_at AS lastOccurredAt, e.occurrences,
      e.assignee_user_id AS assigneeUserId, u.display_name AS assigneeName, e.acknowledged_at AS acknowledgedAt,
      e.closed_at AS closedAt, e.notification_state AS notificationState, e.notification_channel AS notificationChannel,
      e.notification_sent_at AS notificationSentAt, e.silence_active AS silenceActive, e.silence_until AS silenceUntil,
      e.related_request_ids_json AS relatedRequestIdsJson
      FROM alert_events e LEFT JOIN users u ON u.id = e.assignee_user_id
      ORDER BY e.last_occurred_at DESC, e.id DESC`).all() as Array<{
        id: string; title: string; summary: string; severity: PlatformAlertRuleSeed['severity']; status: 'open' | 'acknowledged' | 'closed'
        environment: 'production' | 'experiment'; source: PlatformAlertRuleSeed['category']; subjectType: PlatformAlertEventSeed['subject']['type']
        subjectId: string; subjectName: string; ruleId: string; ruleName: string; ruleMetric: string; thresholdLabel: string
        triggerValueLabel: string; triggerComparator: PlatformAlertEventSeed['trigger']['comparator']; firstOccurredAt: string
        lastOccurredAt: string; occurrences: number; assigneeUserId: string | null; assigneeName: string | null; acknowledgedAt: string | null
        closedAt: string | null; notificationState: 'not_configured' | 'not_sent' | 'sent' | 'failed'; notificationChannel: 'none' | 'wecom' | 'dingtalk'
        notificationSentAt: string | null; silenceActive: number; silenceUntil: string | null; relatedRequestIdsJson: string
      }>
    return rows.map((row) => ({ ...row, relatedRequestIds: JSON.parse(row.relatedRequestIdsJson) as string[] }))
  }

  listBusinessRules() {
    return this.db.prepare(`SELECT id, version, label, value, impact, status FROM system_business_rules
      ORDER BY id`).all() as Array<{
        id: string
        version: string
        label: string
        value: string
        impact: string
        status: 'fixed' | 'unverified'
      }>
  }

  listFeatureFlags() {
    return this.db.prepare(`SELECT id, label, enabled, reason, risk FROM system_feature_flags
      ORDER BY id`).all() as Array<{
        id: string
        label: string
        enabled: number
        reason: string
        risk: 'low' | 'medium' | 'high'
    }>
  }

  getOrganizationSummary() {
    const company = this.db.prepare(`SELECT name FROM departments
      WHERE parent_id IS NULL AND status = 'active' ORDER BY created_at, id LIMIT 1`).get() as { name: string } | undefined
    const departmentCount = (this.db.prepare(`SELECT COUNT(*) AS count FROM departments
      WHERE parent_id IS NOT NULL AND status = 'active'`).get() as { count: number }).count
    const peopleCount = (this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'employee'").get() as { count: number }).count
    const roles = this.db.prepare(`SELECT d.id, d.name, d.data_scope AS dataScope,
      d.permission_summary AS permissionSummary, d.high_privilege AS highPrivilege,
      COUNT(u.id) AS memberCount
      FROM system_role_definitions d LEFT JOIN users u ON u.role = d.id
      GROUP BY d.id, d.name, d.data_scope, d.permission_summary, d.high_privilege
      ORDER BY CASE d.id
        WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 WHEN 'department_lead' THEN 3
        WHEN 'finance' THEN 4 WHEN 'employee' THEN 5 ELSE 99 END`).all() as Array<{
        id: PlatformUserRole
        name: string
        dataScope: string
        permissionSummary: string
        highPrivilege: number
        memberCount: number
      }>
    return {
      company: company?.name ?? '未配置组织',
      departments: departmentCount,
      people: peopleCount,
      roles: roles.map((role) => ({ ...role, highPrivilege: role.highPrivilege === 1 })),
    }
  }

  listRetentionPolicies() {
    return this.db.prepare(`SELECT id, label, retention_days AS days, applies_to AS appliesTo,
      cleanup_state AS cleanupState, minimum_necessary AS minimumNecessary
      FROM system_retention_policies ORDER BY id`).all() as Array<{
        id: string
        label: string
        days: number
        appliesTo: string
        cleanupState: 'not_configured' | 'unverified'
        minimumNecessary: number
    }>
  }

  getBackupStatus() {
    const row = this.db.prepare(`SELECT configured, storage_target_configured AS storageTargetConfigured,
      last_backup_at AS lastBackupAt, last_verified_at AS lastVerifiedAt,
      last_restore_drill_at AS lastRestoreDrillAt, browser_download_allowed AS browserDownloadAllowed, notice
      FROM system_backup_status WHERE id = 'platform-sqlite'`).get() as {
        configured: number
        storageTargetConfigured: number
        lastBackupAt: null
        lastVerifiedAt: null
        lastRestoreDrillAt: null
        browserDownloadAllowed: number
        notice: string
    } | undefined
    return row ? {
      configured: false as const,
      storageTargetConfigured: false as const,
      lastBackupAt: row.lastBackupAt,
      lastVerifiedAt: row.lastVerifiedAt,
      lastRestoreDrillAt: row.lastRestoreDrillAt,
      browserDownloadAllowed: false as const,
      notice: row.notice,
    } : null
  }

  recordConversationAccess(event: PlatformConversationAccessCreate, now = this.now()) {
    const occurredAt = now.toISOString()
    this.db.prepare(`INSERT INTO conversation_access_events(
      id, actor_user_id, record_id, request_id, action, reason_provided, reason_length, acknowledged_sensitive_scope, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      event.id, event.actorUserId, event.recordId, event.requestId, event.action, Number(event.reasonProvided),
      event.reasonLength, Number(event.acknowledgedSensitiveScope), occurredAt,
    )
    return { id: event.id, occurredAt }
  }

  listConversationAccessEvents() {
    return this.db.prepare(`SELECT e.id, e.actor_user_id AS actorUserId, u.display_name AS actorName, e.record_id AS recordId,
      e.request_id AS requestId, e.action, e.reason_provided AS reasonProvided, e.reason_length AS reasonLength,
      e.acknowledged_sensitive_scope AS acknowledgedSensitiveScope, e.occurred_at AS occurredAt
      FROM conversation_access_events e JOIN users u ON u.id = e.actor_user_id
      ORDER BY e.occurred_at DESC, e.id DESC`).all() as Array<{
        id: string; actorUserId: string; actorName: string; recordId: string; requestId: string; action: 'view_synthetic'
        reasonProvided: number; reasonLength: number; acknowledgedSensitiveScope: number; occurredAt: string
      }>
  }

  createAuthSession(session: PlatformAuthSessionCreate, now = this.now()) {
    this.db.prepare(`INSERT INTO user_sessions(id, user_id, token_hash, csrf_token_hash, expires_at, created_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)`).run(
      session.id, session.userId, session.tokenHash, session.csrfTokenHash, session.expiresAt, now.toISOString(),
    )
  }

  findAuthSession(tokenHash: string, now = this.now()) {
    const row = this.db.prepare(`SELECT s.id AS sessionId, s.csrf_token_hash AS csrfTokenHash, s.expires_at AS expiresAt,
      u.id AS userId, u.username, u.display_name AS displayName, u.role, u.status, u.department_id AS departmentId
      FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'
      LIMIT 1`).get(tokenHash, now.toISOString()) as {
        sessionId: string
        csrfTokenHash: string
        expiresAt: string
        userId: string
        username: string
        displayName: string
        role: PlatformUserRole
        status: PlatformUser['status']
        departmentId: string | null
      } | undefined
    if (!row) return null
    return {
      id: row.sessionId,
      csrfTokenHash: row.csrfTokenHash,
      expiresAt: row.expiresAt,
      user: { id: row.userId, username: row.username, displayName: row.displayName, role: row.role, roleLabel: '', status: row.status, departmentId: row.departmentId },
    }
  }

  isAuthSessionCsrfValid(tokenHash: string, csrfTokenHash: string, now = this.now()) {
    return Boolean(this.db.prepare(`SELECT 1 FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.csrf_token_hash = ? AND s.revoked_at IS NULL
      AND s.expires_at > ? AND u.status = 'active' LIMIT 1`).get(tokenHash, csrfTokenHash, now.toISOString()))
  }

  revokeAuthSession(tokenHash: string, now = this.now()) {
    this.db.prepare(`UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, ?)
      WHERE token_hash = ?`).run(now.toISOString(), tokenHash)
  }

  cleanupAuthSessions(triggeredBy: SessionCleanupTrigger, now = this.now()): SessionCleanupResult {
    const completedAt = now.toISOString()
    const revokedBefore = new Date(now.getTime() - REVOKED_SESSION_RETENTION_HOURS * 3_600_000).toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const deletedExpired = Number(this.db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(completedAt).changes)
      const deletedRevoked = Number(this.db.prepare('DELETE FROM user_sessions WHERE revoked_at IS NOT NULL AND revoked_at <= ?').run(revokedBefore).changes)
      this.db.prepare(`INSERT INTO session_cleanup_runs(triggered_by, completed_at, deleted_expired, deleted_revoked, revoked_retention_hours)
        VALUES (?, ?, ?, ?, ?)`).run(triggeredBy, completedAt, deletedExpired, deletedRevoked, REVOKED_SESSION_RETENTION_HOURS)
      this.db.exec('COMMIT')
      return { triggeredBy, completedAt, deletedExpired, deletedRevoked, revokedRetentionHours: REVOKED_SESSION_RETENTION_HOURS }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  tableCounts() {
    const count = (table: string) => (this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
    return {
      departments: count('departments'),
      users: count('users'),
      apiKeys: count('api_keys'),
      quotaPolicies: count('quota_policies'),
      auditEvents: count('audit_events'),
      usageRequests: count('usage_requests'),
      alertRules: count('alert_rules'),
      alertEvents: count('alert_events'),
      conversationAccessEvents: count('conversation_access_events'),
      businessRules: count('system_business_rules'),
      featureFlags: count('system_feature_flags'),
      roleDefinitions: count('system_role_definitions'),
      retentionPolicies: count('system_retention_policies'),
      backupStatus: count('system_backup_status'),
      userSessions: count('user_sessions'),
      sessionCleanupRuns: count('session_cleanup_runs'),
    }
  }

  findUserByUsername(username: string) {
    const row = this.db.prepare(`SELECT id, username, display_name AS displayName, role, status, department_id AS departmentId
      FROM users WHERE username = ? LIMIT 1`).get(username) as (PlatformUser & { status: PlatformUser['status'] }) | undefined
    return row ?? null
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

export function seedDemoData(database: PlatformDatabase, now = new Date()) {
  const departments: PlatformDepartmentSeed[] = [
    { id: 'company-xinzhi', name: '新知科技' },
    { id: 'content', name: '内容运营', parentId: 'company-xinzhi' },
    { id: 'ads', name: '广告投放', parentId: 'company-xinzhi' },
    { id: 'global', name: '跨境运营', parentId: 'company-xinzhi' },
    { id: 'service', name: '客户服务', parentId: 'company-xinzhi' },
    { id: 'merch', name: '商品运营', parentId: 'company-xinzhi' },
  ]
  for (const department of departments) database.seedDepartment(department)

  const roleDefinitions: PlatformRoleDefinitionSeed[] = [
    { id: 'super_admin', name: '超级管理员', dataScope: '全公司', permissionSummary: '组织、服务、策略与敏感审计', highPrivilege: true },
    { id: 'admin', name: '运营管理员', dataScope: '全公司运营数据', permissionSummary: '人员、Key、额度、路由与告警', highPrivilege: true },
    { id: 'department_lead', name: '部门负责人', dataScope: '本部门', permissionSummary: '人员、Key、用量与额度只读', highPrivilege: false },
    { id: 'finance', name: '财务只读', dataScope: '全公司汇总', permissionSummary: '成本、额度和用量只读', highPrivilege: false },
    { id: 'employee', name: '员工', dataScope: '本人', permissionSummary: '个人 Key、模型与用量', highPrivilege: false },
  ]
  for (const role of roleDefinitions) database.seedRoleDefinition(role)

  database.seedUser({
    id: 'user-super-admin',
    username: process.env.AUTH_ADMIN_USERNAME ?? 'admin',
    displayName: process.env.AUTH_ADMIN_DISPLAY_NAME ?? '超级管理员',
    role: 'super_admin',
    roleLabel: '超级管理员',
    password: process.env.AUTH_ADMIN_PASSWORD ?? 'admin-demo',
  })
  database.seedUser({
    id: 'person-lin',
    username: process.env.AUTH_EMPLOYEE_USERNAME ?? 'employee',
    displayName: process.env.AUTH_EMPLOYEE_DISPLAY_NAME ?? '林筱雨',
    role: 'employee',
    roleLabel: '员工',
    password: process.env.AUTH_EMPLOYEE_PASSWORD ?? 'employee-demo',
    departmentId: 'content',
    employeeCode: 'OPS-017',
    managerName: '内容运营负责人',
    joinedAt: '2025-03-17',
  })

  const people: PlatformUserSeed[] = [
    { id: 'user-ops-admin', username: 'ops-admin', displayName: '运营管理员', role: 'admin', roleLabel: '运营管理员', password: 'demo-ops-admin' },
    { id: 'user-service-admin', username: 'service-admin', displayName: '服务管理员', role: 'admin', roleLabel: '运营管理员', password: 'demo-service-admin' },
    { id: 'lead-content', username: 'lead-content', displayName: '内容运营负责人', role: 'department_lead', roleLabel: '部门负责人', password: 'demo-lead-content', departmentId: 'content' },
    { id: 'lead-ads', username: 'lead-ads', displayName: '广告投放负责人', role: 'department_lead', roleLabel: '部门负责人', password: 'demo-lead-ads', departmentId: 'ads' },
    { id: 'lead-global', username: 'lead-global', displayName: '跨境运营负责人', role: 'department_lead', roleLabel: '部门负责人', password: 'demo-lead-global', departmentId: 'global' },
    { id: 'lead-service', username: 'lead-service', displayName: '客户服务负责人', role: 'department_lead', roleLabel: '部门负责人', password: 'demo-lead-service', departmentId: 'service' },
    { id: 'user-finance', username: 'finance-reader', displayName: '财务只读', role: 'finance', roleLabel: '财务只读', password: 'demo-finance-reader' },
    { id: 'person-zhou', username: 'demo-zhou', displayName: '周明远', role: 'employee', roleLabel: '员工', password: 'demo-person-zhou', departmentId: 'ads' },
    { id: 'person-chen', username: 'demo-chen', displayName: '陈安琪', role: 'employee', roleLabel: '员工', password: 'demo-person-chen', departmentId: 'global' },
    { id: 'person-xu', username: 'demo-xu', displayName: '许嘉禾', role: 'employee', roleLabel: '员工', password: 'demo-person-xu', departmentId: 'service' },
    { id: 'person-tang', username: 'demo-tang', displayName: '唐语宁', role: 'employee', roleLabel: '员工', password: 'demo-person-tang', departmentId: 'merch' },
    { id: 'person-he', username: 'demo-he', displayName: '何沐晨', role: 'employee', roleLabel: '员工', password: 'demo-person-he', departmentId: 'content' },
    { id: 'person-luo', username: 'demo-luo', displayName: '罗一帆', role: 'employee', roleLabel: '员工', password: 'demo-person-luo', departmentId: 'ads' },
    { id: 'person-su', username: 'demo-su', displayName: '苏澄', role: 'employee', roleLabel: '员工', password: 'demo-person-su', departmentId: 'global' },
    { id: 'person-qiao', username: 'demo-qiao', displayName: '乔南星', role: 'employee', roleLabel: '员工', password: 'demo-person-qiao', departmentId: 'service' },
    { id: 'person-guo', username: 'demo-guo', displayName: '郭子谦', role: 'employee', roleLabel: '员工', password: 'demo-person-guo', departmentId: 'merch' },
    { id: 'person-yan', username: 'demo-yan', displayName: '严可欣', role: 'employee', roleLabel: '员工', password: 'demo-person-yan', status: 'disabled', departmentId: 'content' },
    { id: 'person-wei', username: 'demo-wei', displayName: '魏昭', role: 'employee', roleLabel: '员工', password: 'demo-person-wei', departmentId: 'service' },
  ]
  for (const person of people) database.seedUser(person)
  database.setUserDepartment('user-super-admin', null)
  database.setUserDepartment('person-lin', 'content')

  const keys: PlatformApiKeySeed[] = [
    { id: 'key-lin-1', ownerUserId: 'person-lin', maskedValue: 'sk-ops••••••7F2A', purpose: '商品文案', status: 'active', expiresAt: '2026-12-31T15:59:59.000Z', models: ['ecommerce-copy', 'ecommerce-general'] },
    { id: 'key-lin-2', ownerUserId: 'person-lin', maskedValue: 'sk-ops••••••3C91', purpose: '临时项目', status: 'expiring', expiresAt: '2026-10-15T15:59:59.000Z', models: ['ecommerce-copy'] },
    { id: 'key-zhou-1', ownerUserId: 'person-zhou', maskedValue: 'sk-ops••••••8B14', purpose: '策略分析', status: 'active', expiresAt: '2027-01-31T15:59:59.000Z', models: ['ecommerce-analysis', 'ecommerce-general'] },
    { id: 'key-chen-1', ownerUserId: 'person-chen', maskedValue: 'sk-ops••••••6D20', purpose: '多语翻译', status: 'active', expiresAt: '2026-12-31T15:59:59.000Z', models: ['ecommerce-translate', 'ecommerce-general'] },
    { id: 'key-xu-1', ownerUserId: 'person-xu', maskedValue: 'sk-ops••••••A921', purpose: '回复建议', status: 'revoked', expiresAt: '2026-09-01T15:59:59.000Z', models: ['ecommerce-service'] },
  ]
  for (const key of keys) database.seedApiKey(key)

  const policies: PlatformQuotaPolicySeed[] = [
    { id: 'quota-company-month', level: 'company', subjectId: 'company-xinzhi', period: 'month', targetPoints: 12000 },
    { id: 'quota-content-month', level: 'department', subjectId: 'content', period: 'month', targetPoints: 2600 },
    { id: 'quota-ads-month', level: 'department', subjectId: 'ads', period: 'month', targetPoints: 2400 },
    { id: 'quota-lin-month', level: 'person', subjectId: 'person-lin', period: 'month', targetPoints: 860 },
    { id: 'quota-copy-month', level: 'purpose', subjectId: 'ecommerce-copy', period: 'month', targetPoints: 5000 },
    { id: 'quota-key-lin-1-month', level: 'key', subjectId: 'key-lin-1', period: 'month', targetPoints: 860 },
  ]
  for (const policy of policies) database.seedQuotaPolicy(policy)

  const businessRules: PlatformBusinessRuleSeed[] = [
    { id: 'timezone', version: 'draft-v0.1', label: '业务时区', value: 'Asia/Shanghai (UTC+8)', impact: '账期、告警窗口和日志展示', status: 'fixed' },
    { id: 'currency', version: 'draft-v0.1', label: '预算单位', value: 'CNY · 点数', impact: '预算、分摊与软目标展示', status: 'unverified' },
    { id: 'billing-cycle', version: 'draft-v0.1', label: '用量周期', value: '自然月 · 每月 1 日重置', impact: '个人、用途与公司软目标', status: 'fixed' },
    { id: 'failed-billing', version: 'draft-v0.1', label: '失败请求计费', value: '不计点数', impact: '失败、取消及上游异常', status: 'unverified' },
    { id: 'retry-billing', version: 'draft-v0.1', label: '重试计费', value: '按最终成功请求记一次', impact: '网关自动重试与成本归集', status: 'unverified' },
  ]
  for (const rule of businessRules) database.seedBusinessRule(rule)

  const featureFlags: PlatformFeatureFlagSeed[] = [
    { id: 'management-writes', label: '管理写操作', enabled: false, reason: '登录、RBAC、幂等、审计和回滚未完成', risk: 'high' },
    { id: 'conversation-capture', label: '对话正文采集', enabled: false, reason: '独立存储、加密、脱敏和到期清理未完成', risk: 'high' },
    { id: 'hard-quota', label: '硬额度阻断', enabled: false, reason: '并发预留、结算和恢复路径未验收', risk: 'high' },
    { id: 'data-export', label: '数据导出', enabled: false, reason: '数据范围、敏感扫描和导出审计未完成', risk: 'medium' },
    { id: 'employee-portal', label: '员工自助入口', enabled: false, reason: '本人数据范围与接入说明尚未完成', risk: 'medium' },
  ]
  for (const feature of featureFlags) database.seedFeatureFlag(feature)

  const retentionPolicies: PlatformRetentionPolicySeed[] = [
    { id: 'usage-metadata', label: '调用元数据', days: 180, appliesTo: '请求 ID、Token、耗时、成本与状态', cleanupState: 'unverified', minimumNecessary: true },
    { id: 'conversation-content', label: '对话审计正文', days: 7, appliesTo: '仅限获准策略采集的脱敏内容', cleanupState: 'not_configured', minimumNecessary: true },
    { id: 'operation-audit', label: '操作审计', days: 365, appliesTo: '管理员操作与访问原因证明', cleanupState: 'unverified', minimumNecessary: true },
    { id: 'export-files', label: '导出文件', days: 7, appliesTo: '异步生成的受控下载文件', cleanupState: 'not_configured', minimumNecessary: true },
  ]
  for (const policy of retentionPolicies) database.seedRetentionPolicy(policy)

  database.seedBackupStatus({
    id: 'platform-sqlite',
    notice: '尚未配置平台数据库备份作业；页面不允许直接下载数据库、密钥或认证文件。',
  })

  const auditEvents: PlatformAuditEventSeed[] = [
    { id: 'audit-login-success', actorUserId: 'user-super-admin', action: 'login', resourceType: 'session', resourceId: 'session-demo-01', result: 'success', requestId: 'req-audit-login-01', summary: { message: '超级管理员通过本机演示身份进入管理控制台。' } },
    { id: 'audit-key-rotate', actorUserId: 'user-super-admin', action: 'rotate', resourceType: 'key', resourceId: 'key-lin-1', result: 'success', requestId: 'req-audit-key-02', summary: { message: '完成访问 Key 轮换；审计记录不保存新旧密钥值。', sensitive: true } },
    { id: 'audit-quota-update', actorUserId: 'user-ops-admin', action: 'update', resourceType: 'quota', resourceId: 'quota-content-month', result: 'success', requestId: 'req-audit-quota-03', summary: { message: '将内容运营月度软目标从 2,000 点调整为 2,600 点。' } },
    { id: 'audit-export-denied', actorUserId: 'user-ops-admin', action: 'export', resourceType: 'export', resourceId: 'export-usage-01', result: 'denied', requestId: 'req-audit-export-05', summary: { message: '导出范围包含无权访问的部门，申请被权限边界拒绝。' } },
  ]
  for (const event of auditEvents) database.seedAuditEvent(event)

  const usageSeeds: Array<Omit<PlatformUsageRequestSeed, 'occurredAt'> & { minutes: number }> = [
    { requestId: 'req-demo-001', minutes: 8, ownerUserId: 'person-lin', apiKeyId: 'key-lin-1', purpose: { id: 'copy', name: '商品文案', alias: 'ecommerce-copy' }, model: { id: 'model-mini', displayName: '通用轻量模型', actualModel: 'gpt-5.1-mini' }, channel: { id: 'channel-official-cn-1', name: 'Official CN · 01', type: 'official_api' }, protocol: 'responses', streamed: true, tokens: { input: 1840, output: 726 }, points: 2.6, latency: { firstTokenMs: 620, totalMs: 2180 }, cost: { type: 'official_actual', amountUsd: .00191 }, status: 'succeeded', routeAlias: 'ecommerce-copy', client: { name: 'Codex Desktop', mode: 'stream' } },
    { requestId: 'req-demo-002', minutes: 19, ownerUserId: 'person-zhou', apiKeyId: 'key-zhou-1', purpose: { id: 'analysis', name: '策略分析', alias: 'ecommerce-analysis' }, model: { id: 'model-general', displayName: '通用高能力模型', actualModel: 'gpt-5.1' }, channel: { id: 'channel-official-global-1', name: 'Official Global · 01', type: 'official_api' }, streamed: true, tokens: { input: 6230, output: 2140 }, points: 8.4, latency: { firstTokenMs: 1680, totalMs: 8940 }, cost: { type: 'platform_estimate', amountUsd: .02919 }, status: 'succeeded', routeAlias: 'ecommerce-analysis', client: { name: 'WorkBuddy', mode: 'stream' } },
    { requestId: 'req-demo-003', minutes: 31, ownerUserId: 'person-xu', apiKeyId: 'key-xu-1', purpose: { id: 'service', name: '回复建议', alias: 'ecommerce-service' }, model: { id: 'model-mini', displayName: '通用轻量模型', actualModel: 'gpt-5.1-mini' }, channel: { id: 'channel-official-cn-2', name: 'Official CN · 02', type: 'official_api' }, tokens: { input: 960, output: 188 }, points: 1.2, latency: { firstTokenMs: null, totalMs: 3840 }, cost: { type: 'official_actual', amountUsd: .00062 }, status: 'failed', error: { category: 'rate_limit', summary: '上游短时 429，已记录且未保存完整响应。' }, routeAlias: 'ecommerce-service', retryCount: 1, client: { name: 'Codex Desktop', mode: 'non_stream' } },
    { requestId: 'req-demo-004', minutes: 47, ownerUserId: 'person-zhou', apiKeyId: 'key-zhou-1', purpose: { id: 'experiment', name: '高能力实验', alias: 'ecommerce-pro-lab' }, model: { id: 'model-lab', displayName: 'CPA 高能力实验', actualModel: 'pro-oauth-lab' }, channel: { id: 'channel-cpa-lab-1', name: 'CPA Lab · 01', type: 'cpa_oauth' }, protocol: 'responses', streamed: true, tokens: { input: 4820, output: 1680 }, points: 6.5, latency: { firstTokenMs: 2420, totalMs: 11320 }, cost: { type: 'cpa_estimate', amountUsd: .0184 }, status: 'succeeded', routeAlias: 'ecommerce-pro-lab', client: { name: 'WorkBuddy', mode: 'stream' } },
    { requestId: 'req-demo-005', minutes: 73, ownerUserId: 'person-lin', apiKeyId: 'key-lin-2', purpose: { id: 'translate', name: '多语翻译', alias: 'ecommerce-translate' }, model: { id: 'model-mini', displayName: '通用轻量模型', actualModel: 'gpt-5.1-mini' }, channel: { id: 'channel-official-cn-1', name: 'Official CN · 01', type: 'official_api' }, streamed: true, tokens: { input: 3260, output: 1420 }, points: 4.7, latency: { firstTokenMs: 810, totalMs: 4260 }, cost: { type: 'official_actual', amountUsd: .00366 }, status: 'succeeded', routeAlias: 'ecommerce-translate', client: { name: 'Codex Desktop', mode: 'stream' } },
    { requestId: 'req-demo-006', minutes: 126, ownerUserId: 'person-zhou', apiKeyId: 'key-zhou-1', purpose: { id: 'analysis', name: '策略分析', alias: 'ecommerce-analysis' }, model: { id: 'model-general', displayName: '通用高能力模型', actualModel: 'gpt-5.1' }, channel: { id: 'channel-official-global-1', name: 'Official Global · 01', type: 'official_api' }, tokens: { input: 7120, output: 1830 }, points: 9, latency: { firstTokenMs: null, totalMs: 12000 }, cost: { type: 'platform_estimate', amountUsd: .0272 }, status: 'failed', error: { category: 'timeout', summary: '总耗时超过路由阈值，已在官方分组内结束请求。' }, routeAlias: 'ecommerce-analysis', retryCount: 1, client: { name: 'WorkBuddy', mode: 'non_stream' } },
    { requestId: 'req-demo-007', minutes: 184, ownerUserId: 'person-xu', apiKeyId: 'key-xu-1', purpose: { id: 'service', name: '回复建议', alias: 'ecommerce-service' }, model: { id: 'model-mini', displayName: '通用轻量模型', actualModel: 'gpt-5.1-mini' }, channel: { id: 'channel-official-cn-1', name: 'Official CN · 01', type: 'official_api' }, protocol: 'responses', streamed: true, tokens: { input: 1280, output: 640 }, points: 1.9, latency: { firstTokenMs: 540, totalMs: 1980 }, cost: { type: 'official_actual', amountUsd: .0016 }, status: 'succeeded', routeAlias: 'ecommerce-service', client: { name: 'Codex Desktop', mode: 'stream' } },
    { requestId: 'req-demo-008', minutes: 265, ownerUserId: 'person-zhou', apiKeyId: 'key-zhou-1', purpose: { id: 'experiment', name: '高能力实验', alias: 'ecommerce-pro-lab' }, model: { id: 'model-lab', displayName: 'CPA 高能力实验', actualModel: 'pro-oauth-lab' }, channel: { id: 'channel-cpa-lab-1', name: 'CPA Lab · 01', type: 'cpa_oauth' }, protocol: 'responses', streamed: true, tokens: { input: 2290, output: 0 }, points: 2.3, latency: { firstTokenMs: null, totalMs: 1320 }, cost: { type: 'cpa_estimate', amountUsd: .0062 }, status: 'cancelled', error: { category: 'cancelled', summary: '客户端主动取消流式响应。' }, routeAlias: 'ecommerce-pro-lab', client: { name: 'WorkBuddy', mode: 'stream' } },
    { requestId: 'req-demo-009', minutes: 1_580, ownerUserId: 'person-lin', apiKeyId: 'key-lin-1', purpose: { id: 'copy', name: '商品文案', alias: 'ecommerce-copy' }, model: { id: 'model-mini', displayName: '通用轻量模型', actualModel: 'gpt-5.1-mini' }, channel: { id: 'channel-official-cn-2', name: 'Official CN · 02', type: 'official_api' }, streamed: true, tokens: { input: 2410, output: 990 }, points: 3.4, latency: { firstTokenMs: 730, totalMs: 3120 }, cost: { type: 'official_actual', amountUsd: .00258 }, status: 'succeeded', routeAlias: 'ecommerce-copy', client: { name: 'Codex Desktop', mode: 'stream' } },
    { requestId: 'req-demo-010', minutes: 1_940, ownerUserId: 'person-chen', apiKeyId: 'key-chen-1', purpose: { id: 'translate', name: '多语翻译', alias: 'ecommerce-translate' }, model: { id: 'model-general', displayName: '通用高能力模型', actualModel: 'gpt-5.1' }, channel: { id: 'channel-official-global-1', name: 'Official Global · 01', type: 'official_api' }, protocol: 'responses', streamed: true, tokens: { input: 8640, output: 3210 }, points: 11.9, latency: { firstTokenMs: 1920, totalMs: 10480 }, cost: { type: 'platform_estimate', amountUsd: .0429 }, status: 'succeeded', routeAlias: 'ecommerce-translate', client: { name: 'WorkBuddy', mode: 'stream' } },
    { requestId: 'req-demo-011', minutes: 3_080, ownerUserId: 'person-xu', apiKeyId: 'key-xu-1', purpose: { id: 'service', name: '回复建议', alias: 'ecommerce-service' }, model: { id: 'model-mini', displayName: '通用轻量模型', actualModel: 'gpt-5.1-mini' }, channel: { id: 'channel-official-cn-1', name: 'Official CN · 01', type: 'official_api' }, streamed: true, tokens: { input: 770, output: 430 }, points: 1.2, latency: { firstTokenMs: 510, totalMs: 1690 }, cost: { type: 'official_actual', amountUsd: .00105 }, status: 'succeeded', routeAlias: 'ecommerce-service', client: { name: 'Codex Desktop', mode: 'stream' } },
    { requestId: 'req-demo-012', minutes: 4_330, ownerUserId: 'person-zhou', apiKeyId: 'key-zhou-1', purpose: { id: 'experiment', name: '高能力实验', alias: 'ecommerce-pro-lab' }, model: { id: 'model-lab', displayName: 'CPA 高能力实验', actualModel: 'pro-oauth-lab' }, channel: { id: 'channel-cpa-lab-1', name: 'CPA Lab · 01', type: 'cpa_oauth' }, streamed: true, tokens: { input: 5560, output: 1940 }, points: 7.5, latency: { firstTokenMs: 2840, totalMs: 13620 }, cost: { type: 'cpa_estimate', amountUsd: .0212 }, status: 'succeeded', routeAlias: 'ecommerce-pro-lab', client: { name: 'WorkBuddy', mode: 'stream' } },
  ]
  for (const { minutes, ...request } of usageSeeds) database.seedUsageRequest({ ...request, occurredAt: new Date(now.getTime() - minutes * 60_000).toISOString() })

  const at = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString()
  const alertRules: PlatformAlertRuleSeed[] = [
    { id: 'rule-quota-warning', name: '软额度 80% 预警', category: 'quota', severity: 'warning', enabled: true, environment: 'production', scope: '公司 / 部门 / 人员 / 用途 / Key', condition: '使用率 ≥ 80%', window: '小时 / 日 / 周 / 月', cooldownMinutes: 60, lastTriggeredAt: at(120), triggerCount7d: 9, description: '提前提示额度接近目标，不会阻断调用。' },
    { id: 'rule-quota-critical', name: '软额度 100% 告警', category: 'quota', severity: 'critical', enabled: true, environment: 'production', scope: '公司 / 部门 / 人员 / 用途 / Key', condition: '使用率 ≥ 100%', window: '小时 / 日 / 周 / 月', cooldownMinutes: 30, lastTriggeredAt: at(1270), triggerCount7d: 3, description: '达到软目标后记录严重告警，硬阻断仍未启用。' },
    { id: 'rule-traffic-spike', name: '流量突增提示', category: 'traffic', severity: 'info', enabled: true, environment: 'production', scope: '全公司请求', condition: '请求量 ≥ 同期基线 2.5 倍', window: '10 分钟', cooldownMinutes: 30, lastTriggeredAt: at(132), triggerCount7d: 4, description: '识别异常请求增长，辅助核对活动或自动化任务。' },
    { id: 'rule-error-critical', name: '错误率严重告警', category: 'error_rate', severity: 'critical', enabled: true, environment: 'production', scope: '官方生产渠道', condition: '5xx 错误率 ≥ 5%', window: '5 分钟', cooldownMinutes: 15, lastTriggeredAt: at(3), triggerCount7d: 7, description: '监控生产渠道服务异常，不展示上游完整错误正文。' },
    { id: 'rule-balance-low', name: '上游余额预警', category: 'balance', severity: 'warning', enabled: true, environment: 'production', scope: '官方上游账号', condition: '预计可用天数 ≤ 3 天', window: '每天', cooldownMinutes: 720, lastTriggeredAt: at(35), triggerCount7d: 2, description: '按近期消耗估算余额安全天数。' },
    { id: 'rule-credential-expiry', name: '凭证到期告警', category: 'credential', severity: 'critical', enabled: true, environment: 'experiment', scope: 'CPA 实验账号', condition: '剩余有效时间 ≤ 24 小时', window: '每小时', cooldownMinutes: 360, lastTriggeredAt: at(88), triggerCount7d: 2, description: '仅返回凭证状态与到期时间，不返回任何凭证内容。' },
    { id: 'rule-upstream-failure', name: '上游连续失败', category: 'upstream', severity: 'warning', enabled: true, environment: 'experiment', scope: 'CPA 实验上游', condition: '连续失败次数 ≥ 3', window: '10 分钟', cooldownMinutes: 30, lastTriggeredAt: at(21), triggerCount7d: 4, description: '实验流量出现上游异常时提醒，不会回退至生产渠道。' },
    { id: 'rule-upstream-latency', name: '上游延迟异常', category: 'upstream', severity: 'info', enabled: true, environment: 'production', scope: '官方生产渠道', condition: 'P95 总耗时 ≥ 10 秒', window: '10 分钟', cooldownMinutes: 30, lastTriggeredAt: at(2770), triggerCount7d: 6, description: '记录并跟踪上游延迟恢复状态。' },
  ]
  for (const rule of alertRules) database.seedAlertRule(rule)

  const alertEvents: PlatformAlertEventSeed[] = [
    { id: 'alert-error-global', title: '官方全球组错误率持续升高', summary: '近 5 分钟 5xx 错误率超过严重阈值，路由仍限定在官方生产组。', severity: 'critical', status: 'open', environment: 'production', source: 'error_rate', subject: { type: 'channel', id: 'channel-official-global-1', name: 'Official Global · 01' }, rule: { id: 'rule-error-critical', name: '错误率严重告警', metric: '5xx 错误率', thresholdLabel: '≥ 5% / 5 分钟' }, trigger: { valueLabel: '8.4%', comparator: 'gte' }, firstOccurredAt: at(42), lastOccurredAt: at(3), occurrences: 7 },
    { id: 'alert-balance-low', title: '官方全球账号余额偏低', summary: '按近 7 天消耗速度估算，可用余额低于 3 天安全线。', severity: 'warning', status: 'open', environment: 'production', source: 'balance', subject: { type: 'upstream', id: 'upstream-official-global-1', name: 'Official Global · 01' }, rule: { id: 'rule-balance-low', name: '上游余额预警', metric: '预计可用天数', thresholdLabel: '≤ 3 天' }, trigger: { valueLabel: '2.1 天', comparator: 'lte' }, firstOccurredAt: at(310), lastOccurredAt: at(35), occurrences: 3 },
    { id: 'alert-cpa-credential', title: 'CPA 实验凭证即将到期', summary: '实验渠道凭证预计 18 小时后失效，生产路由不会回退至该渠道。', severity: 'critical', status: 'acknowledged', environment: 'experiment', source: 'credential', subject: { type: 'upstream', id: 'upstream-cpa-lab-2', name: 'CPA Lab · 02' }, rule: { id: 'rule-credential-expiry', name: '凭证到期告警', metric: '剩余有效时间', thresholdLabel: '≤ 24 小时' }, trigger: { valueLabel: '18 小时', comparator: 'lte' }, firstOccurredAt: at(520), lastOccurredAt: at(88), occurrences: 2, assigneeUserId: 'user-super-admin', acknowledgedAt: at(76) },
    { id: 'alert-quota-content', title: '内容运营部门本月额度接近目标', summary: '部门月度软额度达到 84.7%，当前仅提示，不会阻断请求。', severity: 'warning', status: 'open', environment: 'production', source: 'quota', subject: { type: 'department', id: 'content', name: '内容运营' }, rule: { id: 'rule-quota-warning', name: '软额度 80% 预警', metric: '月度额度使用率', thresholdLabel: '≥ 80%' }, trigger: { valueLabel: '84.7%', comparator: 'gte' }, firstOccurredAt: at(930), lastOccurredAt: at(120), occurrences: 5 },
    { id: 'alert-traffic-copy', title: '商品文案用途请求量突增', summary: '10 分钟请求量较过去 7 天同时间段基线高 2.8 倍。', severity: 'info', status: 'acknowledged', environment: 'production', source: 'traffic', subject: { type: 'company', id: 'company-xinzhi', name: '新知科技' }, rule: { id: 'rule-traffic-spike', name: '流量突增提示', metric: '请求量基线倍数', thresholdLabel: '≥ 2.5 倍 / 10 分钟' }, trigger: { valueLabel: '2.8 倍', comparator: 'gte' }, firstOccurredAt: at(160), lastOccurredAt: at(132), occurrences: 2, assigneeUserId: 'user-super-admin', acknowledgedAt: at(128), silence: { active: true, until: later(45) }, relatedRequestIds: ['req-demo-004'] },
    { id: 'alert-cpa-upstream', title: 'CPA Lab · 01 出现短时 5xx', summary: '实验流量独立运行，异常未跨组影响官方生产渠道。', severity: 'warning', status: 'open', environment: 'experiment', source: 'upstream', subject: { type: 'upstream', id: 'upstream-cpa-lab-1', name: 'CPA Lab · 01' }, rule: { id: 'rule-upstream-failure', name: '上游连续失败', metric: '连续失败次数', thresholdLabel: '≥ 3 次' }, trigger: { valueLabel: '4 次', comparator: 'gte' }, firstOccurredAt: at(68), lastOccurredAt: at(21), occurrences: 4, relatedRequestIds: ['req-demo-007', 'req-demo-012'] },
    { id: 'alert-key-limit', title: '林筱雨 Key 达到单小时软目标', summary: 'Key 仅保存掩码；本次达到目标后继续放行，并记录告警。', severity: 'critical', status: 'closed', environment: 'production', source: 'quota', subject: { type: 'key', id: 'key-lin-1', name: 'sk-ops••••••7F2A' }, rule: { id: 'rule-quota-critical', name: '软额度 100% 告警', metric: '小时额度使用率', thresholdLabel: '≥ 100%' }, trigger: { valueLabel: '102.3%', comparator: 'gte' }, firstOccurredAt: at(1320), lastOccurredAt: at(1270), occurrences: 2, assigneeUserId: 'user-super-admin', acknowledgedAt: at(1260), closedAt: at(1190), relatedRequestIds: ['req-demo-001'] },
    { id: 'alert-channel-recovered', title: 'Official CN · 02 延迟已恢复', summary: 'P95 延迟回落至正常区间，事件已自动关闭。', severity: 'info', status: 'closed', environment: 'production', source: 'upstream', subject: { type: 'channel', id: 'channel-official-cn-2', name: 'Official CN · 02' }, rule: { id: 'rule-upstream-latency', name: '上游延迟异常', metric: 'P95 总耗时', thresholdLabel: '≥ 10 秒 / 10 分钟' }, trigger: { valueLabel: '已恢复至 3.2 秒', comparator: 'lte' }, firstOccurredAt: at(2880), lastOccurredAt: at(2770), occurrences: 6, closedAt: at(2760), relatedRequestIds: ['req-demo-003'] },
  ]
  for (const event of alertEvents) database.seedAlertEvent(event)

  return database.tableCounts()
}
