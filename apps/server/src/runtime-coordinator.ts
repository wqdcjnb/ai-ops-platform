import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Redis } from 'ioredis'

const acquireScript = `
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
for i,key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE',key,'-inf',ms)
  if redis.call('ZCARD',key)>=tonumber(ARGV[i+2]) then return 0 end
end
for _,key in ipairs(KEYS) do redis.call('ZADD',key,ms+tonumber(ARGV[2]),ARGV[1]); redis.call('PEXPIRE',key,tonumber(ARGV[2])+1000) end
return 1`
const releaseScript = `for _,key in ipairs(KEYS) do redis.call('ZREM',key,ARGV[1]) end; return 1`
const renewScript = `
local now=redis.call('TIME'); local ms=now[1]*1000+math.floor(now[2]/1000)
for _,key in ipairs(KEYS) do if redis.call('ZSCORE',key,ARGV[1]) then redis.call('ZADD',key,ms+tonumber(ARGV[2]),ARGV[1]); redis.call('PEXPIRE',key,tonumber(ARGV[2])+1000) end end
return 1`

export function runtimeLimit(name: string, fallback: number, maximum = 10_000) {
  const value = Number(process.env[name] ?? fallback)
  if(!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be between 1 and ${maximum}`)
  return value
}

export class RuntimeCoordinator {
  readonly redis: Redis
  private waiting = 0
  readonly namespace = 'ai-ops:v2:'
  private readonly renewals = new Set<ReturnType<typeof setInterval>>()

  constructor(url = process.env.REDIS_URL) {
    if(!url) throw new Error('REDIS_URL is required. Start Redis with start-docker.cmd.')
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 3_000, commandTimeout: 3_000, retryStrategy: (attempt) => Math.min(attempt * 250, 3_000) })
    this.redis.on('error', () => { /* Readiness and request errors report safe messages. */ })
  }
  async initialize() { await this.redis.connect(); await this.redis.ping() }
  async health() { await this.redis.ping() }
  status() { return { connection: this.redis.status, waiting: this.waiting, localLeases: this.renewals.size } }

  /** Both per-person and global limits are acquired atomically. Leases expire
   * after process failure; release never decrements another request's lease. */
  async acquire(limits: Array<{ key: string; limit: number }>, options: { signal?: AbortSignal; waitMs?: number; leaseMs?: number } = {}): Promise<null | (() => Promise<void>)> {
    const keys = limits.map(({ key }) => this.namespace + 'active:' + key)
    const id = randomUUID()
    const leaseMs = options.leaseMs ?? 120_000
    const waitingLimit = runtimeLimit('AI_OPS_MAX_WAITING', 100)
    if(this.waiting >= waitingLimit) return null
    this.waiting++
    try {
      const deadline = Date.now() + (options.waitMs ?? 0)
      do {
        options.signal?.throwIfAborted()
        const acquired = await this.redis.eval(acquireScript, keys.length, ...keys, id, leaseMs, ...limits.map(({ limit }) => limit))
        if(acquired === 1) {
          let released = false
          const timer = setInterval(() => { void this.redis.eval(renewScript, keys.length, ...keys, id, leaseMs).catch(() => undefined) }, Math.floor(leaseMs / 3))
          timer.unref(); this.renewals.add(timer)
          return async () => {
            if(released) return
            released = true
            clearInterval(timer); this.renewals.delete(timer)
            await this.redis.eval(releaseScript, keys.length, ...keys, id)
          }
        }
        if(Date.now() >= deadline) return null
        await delay(Math.min(75, Math.max(1, deadline - Date.now())), undefined, { signal: options.signal })
      } while(Date.now() <= deadline)
      return null
    } finally { this.waiting-- }
  }

  async rateLimit(key: string, maximum: number, windowMs = 60_000) {
    const count = await this.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n", 1, this.namespace + 'rate:' + key, windowMs)
    return Number(count) <= maximum
  }

  async readHealth<T>(providerIds: string[]): Promise<Array<T | null>> {
    if(!providerIds.length) return []
    const values = await this.redis.mget(...providerIds.map((id) => this.namespace + 'health:' + id))
    return values.map((value) => { try { return value ? JSON.parse(value) as T : null } catch { return null } })
  }
  async writeHealth(providerId: string, health: unknown) {
    await this.redis.set(this.namespace + 'health:' + providerId, JSON.stringify(health), 'EX', 120)
  }
  async updateHealth<T>(providerId: string, kind: 'success' | 'failure' | 'probe', latencyMs = 0): Promise<T> {
    // Atomic updates keep concurrent workers from losing failures/clearing a
    // circuit. A successful /models probe is not a successful model call.
    const result = await this.redis.eval(`
local raw=redis.call('GET',KEYS[1]); local h=raw and cjson.decode(raw) or {failures=0,latencyMs=60000}
local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000); local ms=tonumber(ARGV[2])
h.checkedAt=now
if ARGV[1]=='failure' then
 h.failures=math.min(10,(h.failures or 0)+1)
 if h.failures>=3 then h.circuitUntil=now+30000 end
elseif ARGV[1]=='success' then
 h.firstTokenMs=h.firstTokenMs and math.floor(h.firstTokenMs*0.7+ms*0.3) or ms
 h.failures=0; h.circuitUntil=0
else h.latencyMs=ms end
local value=cjson.encode(h); redis.call('SET',KEYS[1],value,'EX',120); return value`, 1, this.namespace + 'health:' + providerId, kind, latencyMs)
    return JSON.parse(String(result)) as T
  }
  async probeLock(providerId: string) {
    return this.acquire([{ key: 'probe:' + providerId, limit: 1 }], { leaseMs: 10_000 })
  }
  async close() {
    for(const timer of this.renewals) clearInterval(timer)
    this.renewals.clear()
    this.redis.disconnect()
  }
}
