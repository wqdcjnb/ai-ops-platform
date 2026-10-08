import type { PostgresDatabase } from './postgres.js'

/** Each account is an independent, versioned row. Updating one account never
 * rewrites the other accounts or loses another server's concurrent update. */
export class ProviderStore<T extends { id: string }> {
  constructor(private readonly database: PostgresDatabase) { }

  async initialize(loadLegacy: () => Promise<T[]>) {
    await this.database.transaction(async () => {
      await this.database.lock('ai-ops:provider-migration')
      const migrated = await this.database.query("SELECT name FROM data_migrations WHERE name = 'providers_to_postgres_v1'")
      if(migrated.rowCount) return
      const legacy = await loadLegacy()
      if(legacy.length && (await this.database.query('SELECT 1 FROM external_providers LIMIT 1')).rowCount) throw new Error('Refusing to overwrite PostgreSQL providers during migration.')
      for(const provider of legacy) await this.database.query('INSERT INTO external_providers(id, configuration) VALUES ($1,$2)', [provider.id, provider])
      await this.database.query("INSERT INTO data_migrations(name, completed_at, summary) VALUES ('providers_to_postgres_v1',$1,$2)", [new Date().toISOString(), { providers: legacy.length }])
    })
  }

  async versions(): Promise<Array<{ id: string; revision: number }>> {
    return (await this.database.query('SELECT id, revision FROM external_providers ORDER BY id')).rows
  }

  async list(ids?: string[]): Promise<Array<{ configuration: T; revision: number }>> {
    return (await this.database.query('SELECT configuration, revision FROM external_providers WHERE ($1::text[] IS NULL OR id = ANY($1)) ORDER BY id', [ids ?? null])).rows
  }

  async save(provider: T, expectedRevision?: number) {
    if(expectedRevision === undefined) {
      const result = await this.database.query('INSERT INTO external_providers(id, configuration) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING RETURNING revision', [provider.id, provider])
      if(!result.rowCount) throw new Error('PROVIDER_CONCURRENT_UPDATE')
      return Number(result.rows[0].revision)
    }
    const result = await this.database.query('UPDATE external_providers SET configuration=$2, revision=revision+1 WHERE id=$1 AND revision=$3 RETURNING revision', [provider.id, provider, expectedRevision])
    if(!result.rowCount) throw new Error('PROVIDER_CONCURRENT_UPDATE')
    return Number(result.rows[0].revision)
  }

  async remove(id: string, expectedRevision: number) {
    const result = await this.database.query('DELETE FROM external_providers WHERE id=$1 AND revision=$2', [id, expectedRevision])
    if(!result.rowCount) throw new Error('PROVIDER_CONCURRENT_UPDATE')
  }
}
