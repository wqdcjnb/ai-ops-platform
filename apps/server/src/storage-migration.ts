import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PostgresDatabase } from './postgres.js'

// Explicit dependency order. Never import arbitrary tables, execute SQL from
// the legacy file, drop existing PostgreSQL data, or remove the source files.
export const LEGACY_TABLES = [
  'users', 'api_keys', 'api_key_operations', 'device_setup_tickets', 'entity_deletions',
  'usage_requests', 'audit_events', 'audit_chain_checkpoints', 'user_sessions', 'session_cleanup_runs',
  'conversation_audit_records', 'conversation_audit_contents', 'conversation_audit_operation_events',
  'conversation_access_events', 'conversation_audit_cleanup_runs', 'conversation_audit_expiry_proofs',
  'conversation_usage_links', 'conversation_audit_deletions',
] as const

export async function migrateLegacySqlite(database: PostgresDatabase, filename: string) {
  const marker = 'sqlite_to_postgres_v1'
  if((await database.query('SELECT name FROM data_migrations WHERE name = $1', [marker])).rowCount) return
  if(!existsSync(filename)) {
    await database.query('INSERT INTO data_migrations(name, completed_at, summary) VALUES ($1,$2,$3)', [marker, new Date().toISOString(), { source: 'new-installation' }])
    return
  }
  const { DatabaseSync, backup } = await import('node:sqlite')
  const legacy = new DatabaseSync(filename, { readOnly: true })
  try {
    const schema = legacy.prepare("SELECT name FROM schema_migrations WHERE name = 'final_ai_ops_schema_20260927'").get()
    if(!schema) throw new Error('SQLite migration requires the final AI OPS schema; source data has not been modified.')
    for(const table of LEGACY_TABLES) {
      if((await database.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount) {
        throw new Error('PostgreSQL is not empty and has no migration marker. Refusing to merge or overwrite existing data.')
      }
    }
    const backupDirectory = join(dirname(filename), 'backups', 'before-postgres-' + Date.now())
    await mkdir(backupDirectory, { recursive: true })
    await backup(legacy, join(backupDirectory, 'platform.sqlite'))
    const counts: Record<string, number> = {}
    for(const table of LEGACY_TABLES) {
      const info = legacy.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      const columns = info.map((column) => column.name)
      const target = await database.query('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [table])
      const allowed = new Set(target.rows.map((row) => row.column_name))
      if(!columns.length || columns.some((name) => !allowed.has(name))) throw new Error(`Unsupported legacy columns in ${table}; migration rolled back.`)
      const columnList = columns.map((column) => '"' + column.replaceAll('"', '""') + '"').join(',')
      let batch: Record<string, unknown>[] = []
      let count = 0
      const flush = async () => {
        if(!batch.length) return
        const values = batch.flatMap((row) => columns.map((column) => row[column]))
        const tuples = batch.map((_, row) => '(' + columns.map((_, index) => '$' + (row * columns.length + index + 1)).join(',') + ')').join(',')
        await database.query(`INSERT INTO ${table} (${columnList}) VALUES ${tuples}`, values)
        count += batch.length
        batch = []
      }
      for(const row of legacy.prepare(`SELECT * FROM ${table}`).iterate()) {
        batch.push(row)
        if(batch.length === 250) await flush()
      }
      await flush()
      const imported = Number((await database.query(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count)
      if(imported !== count) throw new Error(`Migration count mismatch in ${table}; migration rolled back.`)
      counts[table] = count
    }
    for(const [table, column] of [['audit_events', 'sequence'], ['session_cleanup_runs', 'id'], ['conversation_audit_cleanup_runs', 'id']]) {
      await database.query(`SELECT setval(pg_get_serial_sequence('${table}', '${column}'), COALESCE(MAX(${column}),1), COUNT(*) > 0) FROM ${table}`)
    }
    await database.query('INSERT INTO data_migrations(name, completed_at, summary) VALUES ($1,$2,$3)', [marker, new Date().toISOString(), { counts, backupDirectory }])
    console.info('SQLite migration verified; schema transaction will commit next. Original database retained.')
  } finally { legacy.close() }
}
