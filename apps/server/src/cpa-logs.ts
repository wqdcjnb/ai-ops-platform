import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Read-only, metadata-only view over CPA's request log.  The adapter never
 * parses request/response bodies (CPA error files can contain both), so the
 * audit page cannot accidentally turn a runtime log into a prompt store.
 */
export interface CpaLogRecord {
  id: string
  occurredAt: string
  traceId: string | null
  statusCode: number
  durationMs: number
  clientIp: string | null
  method: string
  path: string
  fileName: string
}

export interface CpaLogReader {
  readonly path: string | null
  readonly configured: boolean
  listLogs(limit?: number): readonly CpaLogRecord[]
}

const linePattern = /^\[(?<date>[^\]]+)\]\s+\[(?<trace>[^\]]+)\]\s+\[[^\]]+\]\s+\[[^\]]+\]\s+(?<status>\d{3})\s+\|\s+(?<duration>[^|]+)\|\s+(?<ip>[^|]+)\|\s+(?<method>[A-Z]+)\s+"(?<path>[^"]+)"/u

function parseTimestamp(value: string, offset: string) {
  const normalized = value.trim().replace(' ', 'T')
  const withOffset = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(normalized) ? normalized : `${normalized}${offset}`
  const date = new Date(withOffset)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function durationMs(value: string) {
  const normalized = value.trim().toLowerCase()
  const number = Number.parseFloat(normalized)
  if (!Number.isFinite(number) || number < 0) return 0
  if (normalized.endsWith('ms')) return Math.round(number)
  if (normalized.endsWith('us')) return Math.round(number / 1_000)
  if (normalized.endsWith('ns')) return Math.round(number / 1_000_000)
  if (normalized.endsWith('s')) return Math.round(number * 1_000)
  return Math.round(number)
}

function maskIp(value: string) {
  const ip = value.trim()
  if (!ip || ip === '-' || ip === 'unknown') return null
  if (ip.includes('.')) {
    const parts = ip.split('.')
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.*`
  }
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}:*`
  return null
}

function safeTrace(value: string) {
  const trace = value.trim()
  return trace && trace !== '--------' ? trace.replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 80) || null : null
}

function resolveLogPath(value = process.env.CPA_LOG_PATH?.trim()) {
  if (value) return resolve(value)
  const candidates = [
    resolve(process.cwd(), 'deploy/cpa/logs'),
    resolve(process.cwd(), '../../deploy/cpa/logs'),
    '/app/runtime/cpa/logs',
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function readMainLog(path: string, offset: string, limit: number) {
  let names: string[]
  try {
    const stat = statSync(path)
    names = stat.isFile() ? [path] : readdirSync(path).filter((name) => name === 'main.log' || /^main-.*\.log$/iu.test(name)).map((name) => join(path, name))
  } catch {
    return []
  }

  const rows: CpaLogRecord[] = []
  for (const name of names) {
    let content: string
    try {
      // Keep the adapter bounded even when a host keeps a very large log file.
      const size = statSync(name).size
      const raw = readFileSync(name, 'utf8')
      content = size > 8_000_000 ? raw.slice(-8_000_000) : raw
    } catch {
      continue
    }
    for (const line of content.split(/\r?\n/u)) {
      const match = linePattern.exec(line)
      if (!match?.groups) continue
      const occurredAt = parseTimestamp(match.groups.date ?? '', offset)
      const statusCode = Number(match.groups.status)
      if (!occurredAt || !Number.isInteger(statusCode)) continue
      const traceId = safeTrace(match.groups.trace ?? '')
      const method = (match.groups.method ?? 'GET').toUpperCase()
      const pathValue = (match.groups.path ?? '/').split('?')[0] ?? '/'
      const digest = createHash('sha256').update(`${name}|${line}`).digest('hex').slice(0, 24)
      rows.push({
        id: `cpa-${digest}`,
        occurredAt,
        traceId,
        statusCode,
        durationMs: durationMs(match.groups.duration ?? '0'),
        clientIp: maskIp(match.groups.ip ?? ''),
        method,
        path: pathValue.slice(0, 256),
        fileName: name.split(/[\\/]/u).pop() ?? 'main.log',
      })
      if (rows.length >= limit * 3) break
    }
  }
  return rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit)
}

export class ReadOnlyCpaLogReader implements CpaLogReader {
  readonly path: string | null
  readonly configured: boolean
  private readonly offset: string

  constructor(path = resolveLogPath(), offset = process.env.CPA_LOG_TIMEZONE_OFFSET?.trim() || '+08:00') {
    this.path = path
    this.configured = Boolean(path)
    this.offset = /^[+-]\d{2}:?\d{2}$/u.test(offset) ? offset : '+08:00'
  }

  listLogs(limit = 10_000) {
    if (!this.path) return []
    return readMainLog(this.path, this.offset, Math.min(50_000, Math.max(1, Math.floor(limit))))
  }
}

export function createCpaLogReader(path?: string) {
  return new ReadOnlyCpaLogReader(path ?? resolveLogPath())
}
