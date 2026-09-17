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
    this.db.prepare(`INSERT INTO users(id, username, display_name, role, password_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(username) DO UPDATE SET id = excluded.id, display_name = excluded.display_name,
      role = excluded.role, password_hash = excluded.password_hash, status = 'active', updated_at = excluded.updated_at`).run(
      seed.id, seed.username, seed.displayName, seed.role, hashPlatformPassword(seed.password), timestamp, timestamp,
    )
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
