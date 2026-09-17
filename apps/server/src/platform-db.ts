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
]

export const databaseStatusSchema = z.object({
  state: z.literal('ready'),
  location: z.string(),
  migrationVersion: z.number().int().nonnegative(),
  tables: z.array(z.string()),
  checkedAt: z.string().datetime(),
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
    return { state: 'ready', location: this.filename, migrationVersion: version.version, tables: rows.map((item) => item.name), checkedAt: this.now().toISOString() }
  }

  seedUser(seed: PlatformUserSeed, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.prepare(`INSERT INTO users(id, username, display_name, role, password_hash, status, department_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET id = excluded.id, display_name = excluded.display_name,
      role = excluded.role, password_hash = excluded.password_hash, status = excluded.status,
      department_id = excluded.department_id, updated_at = excluded.updated_at`).run(
      seed.id, seed.username, seed.displayName, seed.role, hashPlatformPassword(seed.password), seed.status ?? 'active', seed.departmentId ?? null, timestamp, timestamp,
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
    this.db.prepare(`INSERT INTO audit_events(id, actor_user_id, action, resource_type, resource_id, result, request_id, summary_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET actor_user_id = excluded.actor_user_id, action = excluded.action,
      resource_type = excluded.resource_type, resource_id = excluded.resource_id, result = excluded.result,
      request_id = excluded.request_id, summary_json = excluded.summary_json, occurred_at = excluded.occurred_at`).run(
      seed.id, seed.actorUserId ?? null, seed.action, seed.resourceType, seed.resourceId ?? null, seed.result,
      seed.requestId ?? null, JSON.stringify(seed.summary), now.toISOString(),
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

  departmentExists(departmentId: string) {
    return Boolean(this.db.prepare('SELECT 1 FROM departments WHERE id = ? AND status = \'active\' LIMIT 1').get(departmentId))
  }

  createPerson(person: PlatformPersonCreate, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`INSERT INTO users(id, username, display_name, role, password_hash, status, department_id, created_at, updated_at)
        VALUES (?, ?, ?, 'employee', ?, 'active', ?, ?, ?)`).run(
        person.id, person.username, person.displayName, hashPlatformPassword(person.password), person.departmentId, timestamp, timestamp,
      )
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

  ownerExists(ownerUserId: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'employee' AND status = 'active' LIMIT 1").get(ownerUserId))
  }

  createApiKey(key: PlatformApiKeyCreate, now = this.now()) {
    const timestamp = now.toISOString()
    this.db.prepare(`INSERT INTO api_keys(id, owner_user_id, masked_value, purpose, status, expires_at, models_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`).run(
      key.id, key.ownerUserId, key.maskedValue, key.purpose, key.expiresAt, JSON.stringify(key.models), timestamp, timestamp,
    )
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
      a.summary_json AS summaryJson, a.occurred_at AS occurredAt
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
      }>
    return rows.map((row) => ({ ...row, summary: JSON.parse(row.summaryJson) as Record<string, unknown> }))
  }

  listUsageRequests() {
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
      ORDER BY r.occurred_at DESC, r.request_id DESC`).all() as Array<{
        requestId: string; occurredAt: string; personId: string; personName: string; departmentId: string | null; departmentName: string | null
        keyId: string; maskedValue: string; purposeId: string; purposeName: string; purposeAlias: string
        modelId: string; modelDisplayName: string; actualModel: string; channelId: string; channelName: string; channelType: 'official_api' | 'cpa_oauth'
        protocol: 'chat_completions' | 'responses'; streamed: number; inputTokens: number; outputTokens: number; points: number
        firstTokenMs: number | null; totalLatencyMs: number; costType: 'official_actual' | 'platform_estimate' | 'cpa_estimate'; costAmountUsd: number
        status: 'succeeded' | 'failed' | 'cancelled'; errorCategory: 'rate_limit' | 'timeout' | 'authentication' | 'server' | 'cancelled' | null; errorSummary: string | null
        routeAlias: string; retryCount: number; requestIdPropagated: number; clientName: 'Codex Desktop' | 'WorkBuddy'; clientMode: 'stream' | 'non_stream'
      }>
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
    }
  }

  findUserByUsername(username: string) {
    const row = this.db.prepare(`SELECT id, username, display_name AS displayName, role, status
      FROM users WHERE username = ? LIMIT 1`).get(username) as (PlatformUser & { status: PlatformUser['status'] }) | undefined
    return row ?? null
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
  })

  const people: PlatformUserSeed[] = [
    { id: 'user-ops-admin', username: 'ops-admin', displayName: '运营管理员', role: 'admin', roleLabel: '运营管理员', password: 'demo-ops-admin' },
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

  return database.tableCounts()
}
