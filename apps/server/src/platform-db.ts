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

  tableCounts() {
    const count = (table: string) => (this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
    return {
      departments: count('departments'),
      users: count('users'),
      apiKeys: count('api_keys'),
      quotaPolicies: count('quota_policies'),
      auditEvents: count('audit_events'),
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

export function seedDemoData(database: PlatformDatabase) {
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

  return database.tableCounts()
}
