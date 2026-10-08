import { AsyncLocalStorage } from 'node:async_hooks'
import pg from 'pg'

/** One checked-out connection per transaction; never share a transaction
 * between concurrent HTTP requests. The existing domain modules stay put. */
export class PostgresDatabase {
  readonly pool: pg.Pool
  private readonly transactionContext = new AsyncLocalStorage<pg.PoolClient>()

  constructor(connectionString = process.env.DATABASE_URL) {
    if(!connectionString) throw new Error('DATABASE_URL is required. Start PostgreSQL with start-docker.cmd.')
    const max = Number(process.env.AI_OPS_DB_POOL_SIZE ?? 20)
    if(!Number.isInteger(max) || max < 1 || max > 100) throw new Error('AI_OPS_DB_POOL_SIZE must be between 1 and 100')
    this.pool = new pg.Pool({
      connectionString,
      max,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 30_000,
      application_name: 'ai-ops',
    })
    // Do not print connection strings, query parameters or credential payloads.
    this.pool.on('error', () => console.error('PostgreSQL idle connection failed; pool will reconnect.'))
  }

  query(text: string, values: unknown[] = []) {
    return (this.transactionContext.getStore() ?? this.pool).query(text, values)
  }

  async exec(text: string) { await this.query(text) }

  prepare(text: string) {
    const sql = parameterize(text)
    return {
      all: async (...values: unknown[]): Promise<any[]> => (await this.query(sql, values)).rows,
      get: async (...values: unknown[]): Promise<any> => (await this.query(sql, values)).rows[0],
      run: async (...values: unknown[]) => {
        const result = await this.query(sql, values)
        return { changes: result.rowCount ?? 0, lastInsertRowid: Number(result.rows[0]?.id ?? result.rows[0]?.sequence ?? 0) }
      },
    }
  }

  async transaction<T>(work: () => Promise<T>, snapshot = false): Promise<T> {
    if(this.transactionContext.getStore()) return work()
    const client = await this.pool.connect()
    try {
      await client.query(snapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN')
      const result = await this.transactionContext.run(client, work)
      await client.query('COMMIT')
      return result
    } catch(error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async lock(resource: string) {
    if(!this.transactionContext.getStore()) throw new Error('Transaction lock requires an active transaction')
    await this.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [resource])
  }

  async health() { await this.query('SELECT 1') }
  async close() { await this.pool.end() }
}

/** Keep parameter values separate. Ignore question marks inside SQL string
 * literals; camelCase result aliases must be quoted in PostgreSQL. */
export function parameterize(sql: string) {
  let parameter = 0
  return sql.replace(/'(?:''|[^'])*'|\bAS\s+([a-zA-Z_]\w*)|\?/gi, (match, alias: string | undefined) => {
    if(match === '?') return '$' + ++parameter
    if(alias) return `AS "${alias}"`
    return match
  })
}
