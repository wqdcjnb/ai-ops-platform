import type { PlatformConversationAuditCompletion, PlatformDatabase, PlatformGatewayKey } from '../platform-db.js'
import type { GatewayAuditHandle } from './schemas.js'
import { groupingForBody, isInternalTopicTitleRequest } from './protocol.js'

export async function beginGatewayAudit(database: PlatformDatabase | undefined, key: PlatformGatewayKey | null, input: {
  requestId: string
  model: string
  endpoint: string
  body: unknown
  originalBody?: unknown
  streamed: boolean
  startedAt: number
  httpStatus?: number | null
}, log: { warn: (bindings: Record<string, unknown>, message: string) => void }): Promise<GatewayAuditHandle | null> {
  if(!database || !key) return null
  if(isInternalTopicTitleRequest(input.originalBody ?? input.body)) return null
  try {
    const requestedRecordId = `conv-audit-${input.requestId.replace(/^req-/u, '').replace(/[^a-z0-9-]/giu, '-').toLowerCase()}`
    const grouping = groupingForBody(input.body)
    const record = (await database.startConversationAuditCapture({
      id: requestedRecordId,
      requestId: input.requestId,
      keyId: key.id,
      personId: key.ownerUserId,
      keyMasked: key.maskedValue,
      purpose: key.purpose,
      model: input.model,
      endpoint: input.endpoint,
      startedAt: new Date(input.startedAt).toISOString(),
      prompt: input.body,
      streamed: input.streamed,
      groupingType: grouping.type,
      groupingReliable: grouping.type === 'conversation',
      groupingLabel: grouping.label,
      httpStatus: input.httpStatus ?? null,
    }))
    if(!record) return null
    return { database, requestId: input.requestId, recordId: record.id, startedAt: input.startedAt, chunks: [], chunkBytes: 0, truncated: false, checkpoint: null, lastCheckpoint: Date.now() }
  } catch(error) {
    log.warn({ requestId: input.requestId, error: error instanceof Error ? error.message : 'unknown' }, 'conversation audit capture start failed')
    return null
  }
}

export function appendGatewayAuditChunk(handle: GatewayAuditHandle | null, chunk: unknown, log?: { warn: (bindings: Record<string, unknown>, message: string) => void }) {
  if(!handle) return
  const bytes = Buffer.byteLength(JSON.stringify(chunk), 'utf8')
  if(handle.chunkBytes + bytes > 524_288 || handle.chunks.length >= 4_000) { handle.truncated = true; return }
  handle.chunks.push(chunk)
  handle.chunkBytes += bytes
  // At most one checkpoint per second and one pending write per stream.
  // Backlogged database work cannot create an unbounded per-token queue.
  if(handle.checkpoint || Date.now() - handle.lastCheckpoint < 1_000) return
  handle.lastCheckpoint = Date.now()
  handle.checkpoint = handle.database.checkpointConversationChunks(handle.recordId, handle.chunks.slice())
    .catch(() => log?.warn({ requestId: handle.requestId }, 'conversation checkpoint failed'))
    .finally(() => { handle.checkpoint = null })
}

export async function completeGatewayAudit(handle: GatewayAuditHandle | null, completion: Omit<PlatformConversationAuditCompletion, 'completedAt'> & { completedAt?: string }, log: { warn: (bindings: Record<string, unknown>, message: string) => void }) {
  if(!handle) return
  try {
    await handle.checkpoint
    await handle.database.completeConversationAuditCapture(handle.requestId, { ...completion, responseChunks: handle.chunks, captureError: completion.captureError ?? (handle.truncated ? '流式审计事件达到保存上限；回复摘要仍单独保存。' : null), completedAt: completion.completedAt ?? new Date().toISOString() })
  } catch(error) {
    log.warn({ requestId: handle.requestId, error: error instanceof Error ? error.message : 'unknown' }, 'conversation audit capture completion failed')
  }
}
