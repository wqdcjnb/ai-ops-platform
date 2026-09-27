import { z } from 'zod'
import type { AppRole } from './auth.js'
import type { ConversationAuditCleanupStatus, PlatformConversationAuditRecord, PlatformDatabase } from './platform-db.js'

const periodSchema = z.enum(['today', '7d', '30d'])
const captureStateSchema = z.enum(['captured', 'metadata_only', 'deleted', 'expired'])
const groupingSchema = z.enum(['conversation', 'independent_call'])
const auditStatusSchema = z.enum(['streaming', 'succeeded', 'failed', 'cancelled', 'body_unavailable'])

export const conversationAuditQuerySchema = z.object({
  period: periodSchema.default('7d'),
  search: z.string().trim().max(80).default(''),
  person: z.string().trim().max(40).default('all'),
  key: z.string().trim().max(128).default('all'),
  purpose: z.string().trim().max(40).default('all'),
  model: z.string().trim().max(80).default('all'),
  policy: z.string().trim().max(40).default('all'),
  state: z.union([z.literal('all'), captureStateSchema]).default('all'),
  grouping: z.union([z.literal('all'), groupingSchema]).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(10),
})

export const conversationAuditParamsSchema = z.object({ id: z.string().regex(/^conv-audit-[a-z0-9-]+$/) })
export const conversationAccessBodySchema = z.object({
  // Viewing captured content is gated by server-side RBAC, not a free-form
  // reason prompt. Keep these fields optional for older clients, but direct
  // access now records a zero-length reason when they are omitted.
  reason: z.string().trim().max(200).optional().default(''),
  acknowledgeSensitiveScope: z.boolean().optional().default(false),
})

export const conversationDeleteBodySchema = z.object({
  idempotencyKey: z.string().regex(/^conversation-delete-[a-z0-9-]{8,96}$/),
  acknowledgeImpact: z.literal(true),
})

const optionSchema = z.object({ id: z.string(), label: z.string() })
const policySchema = z.object({ id: z.string(), label: z.string(), scope: z.string(), expiresAt: z.string().datetime() })
const recordSchema = z.object({
  id: z.string(), requestId: z.string().regex(/^req-[a-z0-9-]+$/), capturedAt: z.string().datetime(),
  person: z.object({ id: z.string(), name: z.string() }),
  key: z.object({ id: z.string(), masked: z.string() }), purpose: optionSchema,
  model: z.object({ id: z.string(), label: z.string(), actualModel: z.string().nullable() }), policy: policySchema,
  state: captureStateSchema,
  grouping: z.object({ type: groupingSchema, reliable: z.boolean(), label: z.string() }),
  metrics: z.object({ turns: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative() }),
  contentAccess: z.object({ available: z.boolean(), requiresReason: z.boolean(), requiredRole: z.literal('super_admin') }),
  endpoint: z.string().nullable(), startedAt: z.string().datetime(), completedAt: z.string().datetime().nullable(),
  status: auditStatusSchema.nullable(), httpStatus: z.number().int().nullable(), promptBodyRef: z.string().nullable(), responseBodyRef: z.string().nullable(),
  promptBytes: z.number().int().nonnegative().nullable(), responseBytes: z.number().int().nonnegative().nullable(), retentionUntil: z.string().datetime(),
  exportCount: z.number().int().nonnegative(), streamed: z.boolean(), chunkCount: z.number().int().nonnegative(), terminationReason: z.string().nullable(),
  promptAvailable: z.boolean(), responseAvailable: z.boolean(), bodyUnavailableReason: z.string().nullable(),
})

const metaSchema = z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), period: periodSchema, notice: z.string() })
export const conversationAuditResponseSchema = z.object({
  meta: metaSchema,
  accessControl: z.object({ currentRole: z.enum(['super_admin', 'employee']), serverRbacVerified: z.literal(true), contentRequiresReason: z.boolean(), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), captured: z.number().int().nonnegative(), metadataOnly: z.number().int().nonnegative(), expiringSoon: z.number().int().nonnegative(), independentCalls: z.number().int().nonnegative() }),
  scope: z.object({ defaultCaptureEnabled: z.boolean(), activePolicies: z.number().int().nonnegative(), nearestExpiryAt: z.string().datetime(), storageEncryptedVerified: z.boolean(), accessAuditPersisted: z.boolean(), retention: z.object({ mode: z.enum(['metadata_only', 'encrypted_sqlite', 'encrypted_postgres']), proofRecords: z.number().int().nonnegative(), lastRunAt: z.string().datetime().nullable(), notice: z.string() }), notice: z.string() }),
  options: z.object({ people: z.array(optionSchema), keys: z.array(optionSchema), purposes: z.array(optionSchema), models: z.array(optionSchema), policies: z.array(optionSchema) }),
  items: z.array(recordSchema),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
})

const messageSchema = z.object({
  id: z.string(), role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']), label: z.string(), occurredAt: z.string().datetime(),
  text: z.string(),
  tool: z.object({ name: z.string(), summary: z.string(), argumentsAvailable: z.boolean(), outputAvailable: z.boolean(), arguments: z.unknown().optional(), output: z.unknown().optional() }).nullable(),
})

export const conversationAccessResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), notice: z.string() }),
  record: recordSchema,
  access: z.object({ accessRecordId: z.string(), auditEventId: z.string().regex(/^audit-[a-z0-9-]+$/).nullable(), reasonAccepted: z.literal(true), persisted: z.boolean(), authorizedByServerRbac: z.literal(true), copyAllowed: z.boolean(), exportAllowed: z.boolean(), deleteAllowed: z.boolean() }),
  content: z.object({ decrypted: z.literal(true), conversationTitle: z.string(), messages: z.array(messageSchema), prompt: z.unknown().optional(), response: z.unknown().optional(), chunks: z.array(z.unknown()).optional() }),
  retention: z.object({ expiresAt: z.string().datetime(), cleanupState: z.enum(['scheduled', 'expired', 'not_applicable']), deletionProofAvailable: z.boolean(), notice: z.string() }),
  linkedUsage: z.object({ auditRequestId: z.string(), usageRequestId: z.string().nullable(), metadataEndpoint: z.string().nullable(), linkVerified: z.boolean(), source: z.enum(['gateway_capture', 'unavailable']), notice: z.string() }),
})

export const conversationDeleteResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), completedAt: z.string().datetime(), notice: z.string() }),
  record: z.object({ id: z.string(), requestId: z.string().regex(/^req-[a-z0-9-]+$/), state: z.literal('deleted') }),
  operation: z.object({ idempotencyKey: z.string(), idempotent: z.boolean(), auditEventId: z.string().regex(/^audit-[a-z0-9-]+$/) }),
})

const conversationAccessHistoryItemSchema = z.object({
  id: z.string(), actorName: z.string(), requestId: z.string().regex(/^req-[a-z0-9-]+$/),
  action: z.enum(['view', 'copy', 'export']), reasonProvided: z.boolean(), reasonLength: z.number().int().min(0).max(200),
  acknowledgedSensitiveScope: z.boolean(), occurredAt: z.string().datetime(),
})

export const conversationAccessHistoryResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), notice: z.string() }),
  record: z.object({ id: z.string(), requestId: z.string().regex(/^req-[a-z0-9-]+$/) }),
  items: z.array(conversationAccessHistoryItemSchema).max(5),
})

export type ConversationAuditQuery = z.infer<typeof conversationAuditQuerySchema>
export type ConversationAuditRecord = z.infer<typeof recordSchema>
export type ConversationAccessBody = z.infer<typeof conversationAccessBodySchema>

function recordFromDatabase(row: PlatformConversationAuditRecord, now = new Date()): ConversationAuditRecord {
  const realRecord = Boolean(row.auditStatus || row.promptBodyRef || row.responseBodyRef || row.endpoint)
  const startedAt = row.startedAt ?? row.capturedAt
  const retentionUntil = row.retentionUntil ?? row.policyExpiresAt
  const state = row.deletedAt ? 'deleted' as const : row.state
  // Body references intentionally remain as deletion evidence after retention
  // cleanup. Only expose availability while the encrypted content is still
  // accessible; otherwise the list would misleadingly offer expired bodies.
  const bodyAccessible = !row.deletedAt && row.contentAccessAvailable === 1 && state !== 'expired' && new Date(retentionUntil).getTime() > now.getTime()
  // Older stream captures persisted encrypted chunks but did not create a
  // standalone response reference. Those chunks still contain the model text
  // and can be reconstructed at read time.
  const hasRecoverableStreamResponse = row.streamed === 1 && (row.chunkCount ?? 0) > 0
  return {
    id: row.id,
    requestId: row.requestId,
    capturedAt: row.capturedAt,
    person: { id: row.personId, name: row.personName },
    key: { id: row.keyId, masked: row.keyMasked },
    purpose: { id: row.purposeId, label: row.purposeLabel },
    // The public model remains AI OPS for clients. The selected upstream model
    // is retained only in the administrator audit response via the linked
    // gateway usage record, and can be absent for older/metadata-only rows.
    model: { id: row.modelId, label: row.modelLabel, actualModel: row.actualModel ?? null },
    policy: { id: row.policyId, label: row.policyLabel, scope: row.policyScope, expiresAt: row.policyExpiresAt },
    state,
    grouping: { type: row.groupingType, reliable: row.groupingReliable === 1, label: row.groupingLabel },
    metrics: { turns: row.turns, toolCalls: row.toolCalls, totalTokens: row.totalTokens },
    contentAccess: { available: bodyAccessible, requiresReason: false, requiredRole: 'super_admin' },
    endpoint: row.endpoint ?? null,
    startedAt,
    completedAt: row.completedAt ?? null,
    status: row.auditStatus ?? (realRecord ? 'body_unavailable' : state === 'captured' ? 'succeeded' : null),
    httpStatus: row.httpStatus ?? null,
    promptBodyRef: row.promptBodyRef ?? null,
    responseBodyRef: row.responseBodyRef ?? null,
    promptBytes: row.promptBytes ?? null,
    responseBytes: row.responseBytes ?? null,
    retentionUntil,
    exportCount: row.exportCount ?? 0,
    streamed: row.streamed === 1,
    chunkCount: row.chunkCount ?? 0,
    terminationReason: row.terminationReason ?? null,
    promptAvailable: bodyAccessible && Boolean(row.promptBodyRef),
    responseAvailable: bodyAccessible && (Boolean(row.responseBodyRef) || hasRecoverableStreamResponse),
    bodyUnavailableReason: row.captureError ?? null,
  }
}

function periodMinutes(period: ConversationAuditQuery['period']) { return period === 'today' ? 1_440 : period === '7d' ? 10_080 : 43_200 }

function filterRecords(all: ConversationAuditRecord[], query: ConversationAuditQuery, now: Date) {
  const cutoff = now.getTime() - periodMinutes(query.period) * 60_000
  const needle = query.search.toLocaleLowerCase('zh-CN')
  return all.filter((item) => {
    const actualOrPublicModel = item.model.actualModel ?? item.model.id
    const matchesSearch = !needle || [item.id, item.requestId, item.person.name, item.key.masked, item.purpose.label, item.model.label, item.model.actualModel ?? '', item.policy.label].some((value) => value.toLocaleLowerCase('zh-CN').includes(needle))
    return new Date(item.capturedAt).getTime() >= cutoff && matchesSearch && (query.person === 'all' || item.person.id === query.person) && (query.key === 'all' || item.key.id === query.key) && (query.purpose === 'all' || item.purpose.id === query.purpose) && (query.model === 'all' || actualOrPublicModel === query.model) && (query.policy === 'all' || item.policy.id === query.policy) && (query.state === 'all' || item.state === query.state) && (query.grouping === 'all' || item.grouping.type === query.grouping)
  })
}

function createConversationAuditResponse(all: ConversationAuditRecord[], query: ConversationAuditQuery, now: Date, currentRole: AppRole, accessAuditPersisted: boolean, cleanupStatus: ConversationAuditCleanupStatus | null = null) {
  const filtered = filterRecords(all, query, now)
  const start = (query.page - 1) * query.pageSize
  const unique = <T extends { id: string; label: string }>(values: T[]) => [...new Map(values.map((item) => [item.id, item])).values()]
  const expiry = all.filter((item) => item.state === 'captured').map((item) => item.policy.expiresAt).sort()[0] ?? now.toISOString()
  const hasRealCapture = all.some((item) => item.endpoint || item.promptAvailable || item.responseAvailable || item.status === 'streaming')
  const retentionMode = hasRealCapture ? 'encrypted_sqlite' as const : 'metadata_only' as const
  return {
    meta: { source: 'database' as const, generatedAt: now.toISOString(), period: query.period, notice: hasRealCapture ? '真实网关请求已在服务端采集；正文以加密引用保存在本地 SQLite，列表不返回正文。' : '当前没有可展示的正文采集记录；未采集的历史请求无法还原正文。' },
    accessControl: { currentRole, serverRbacVerified: true as const, contentRequiresReason: false as const, notice: '当前请求已通过服务端超级管理员 RBAC；选择记录后可直接查看正文，查看、复制和导出仍会写入访问审计。' },
    summary: { total: filtered.length, captured: filtered.filter((item) => item.state === 'captured').length, metadataOnly: filtered.filter((item) => item.state === 'metadata_only').length, expiringSoon: filtered.filter((item) => item.state === 'captured' && new Date(item.policy.expiresAt).getTime() - now.getTime() <= 1_440 * 60_000).length, independentCalls: filtered.filter((item) => item.grouping.type === 'independent_call').length },
    scope: {
      defaultCaptureEnabled: hasRealCapture,
      activePolicies: hasRealCapture ? 1 : 0,
      nearestExpiryAt: expiry,
      storageEncryptedVerified: hasRealCapture,
      accessAuditPersisted,
      retention: {
        mode: retentionMode,
        proofRecords: cleanupStatus?.proofRecords ?? 0,
        lastRunAt: cleanupStatus?.lastRun?.completedAt ?? null,
        notice: cleanupStatus?.proofRecords
          ? hasRealCapture ? '到期任务会删除加密正文并保留元数据删除证明。' : '本地到期证明仅确认历史元数据；这些记录没有正文可删除。'
          : hasRealCapture ? '暂无新的到期删除批次。' : '尚未发现需要生成本地到期证明的历史元数据。',
      },
      notice: hasRealCapture ? '网关鉴权和模型校验通过后开始采集；正文与元数据分离保存，采集失败不会改变上游请求语义。' : '未采集的历史请求只有元数据；新的已鉴权网关请求会在转发边界生成正文审计记录。',
    },
    options: { people: unique(all.map((item) => ({ id: item.person.id, label: item.person.name }))), keys: unique(all.map((item) => ({ id: item.key.id, label: item.key.masked }))), purposes: unique(all.map((item) => item.purpose)), models: unique(all.map((item) => ({ id: item.model.actualModel ?? item.model.id, label: item.model.actualModel ?? item.model.label }))), policies: unique(all.map((item) => ({ id: item.policy.id, label: item.policy.label }))) },
    items: filtered.slice(start, start + query.pageSize), pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) },
  }
}

export function createDatabaseConversationAudits(database: PlatformDatabase, query: ConversationAuditQuery, now = new Date(), currentRole: AppRole = 'super_admin') {
  return createConversationAuditResponse(database.listConversationAuditRecords().map((row) => recordFromDatabase(row, now)), query, now, currentRole, true, database.getConversationAuditCleanupStatus())
}

export function getDatabaseConversationAuditRecord(database: PlatformDatabase, id: string, now = new Date()) {
  return database.listConversationAuditRecords().map((row) => recordFromDatabase(row, now)).find((item) => item.id === id) ?? null
}

export function createDatabaseConversationAccessHistory(database: PlatformDatabase, id: string, now = new Date()) {
  const record = getDatabaseConversationAuditRecord(database, id)
  if (!record) return null
  return {
     meta: { source: 'database' as const, generatedAt: now.toISOString(), notice: '仅显示最近 5 条正文访问、复制和导出元数据；系统上下文和凭据均不返回。' },
     record: { id: record.id, requestId: record.requestId },
     items: [
       ...database.listConversationAccessEvents(record.id).map((item) => ({
       id: item.id,
       actorName: item.actorName,
       requestId: item.requestId,
       action: 'view' as const,
       reasonProvided: item.reasonProvided === 1,
       reasonLength: item.reasonLength,
       acknowledgedSensitiveScope: item.acknowledgedSensitiveScope === 1,
       occurredAt: item.occurredAt,
       })),
       ...database.listConversationAuditOperations(record.id).map((item) => ({
         id: item.id,
         actorName: item.actorName,
         requestId: item.requestId,
         action: item.action,
         reasonProvided: item.reasonLength > 0,
         reasonLength: item.reasonLength,
         acknowledgedSensitiveScope: true,
         occurredAt: item.occurredAt,
       })),
     ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 5),
   }
}

function jsonText(value: unknown) {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) ?? '' } catch { return String(value ?? '') }
}

function userQueryBlocks(value: unknown) {
  const text = jsonText(value).replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  const blocks: string[] = []
  const pattern = /<user_query\b[^>]*>([\s\S]*?)<\/user_query>/gi
  for (const match of text.matchAll(pattern)) {
    const block = match[1]?.trim()
    if (block && !blocks.includes(block)) blocks.push(block)
  }
  return blocks
}

function textParts(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((item) => textParts(item))
  if (!value || typeof value !== 'object') return []
  const item = value as Record<string, unknown>
  if (typeof item.text === 'string') return [item.text]
  if (typeof item.input_text === 'string') return [item.input_text]
  return 'content' in item ? textParts(item.content) : []
}

function visibleUserText(value: string) {
  const decoded = value.replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  const request = decoded.match(/(?:^|\n)##\s*My request:\s*([\s\S]*)$/iu)?.[1]
  const text = (request ?? decoded)
    .replace(/<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/giu, '')
    .trim()
  return text
}

function isInternalCodexContext(value: string) {
  return /^(?:#\s*AGENTS\.md instructions\b|<environment_context\b|<app-context\b|<skills_instructions\b|<permissions instructions\b|<collaboration_mode\b|<model_switch\b)/iu.test(value.trim())
}

const maximumRecoveredStreamTextChars = 250_000

function streamChunkText(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const payload = value as Record<string, unknown>
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return streamChunkText(payload.data)
  if (typeof payload.delta === 'string') return payload.delta
  if (typeof payload.output_text === 'string') return payload.output_text
  if (typeof payload.text === 'string') return payload.text
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  return choices.map((choice) => {
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return ''
    const item = choice as Record<string, unknown>
    const message = item.delta && typeof item.delta === 'object' ? item.delta : item.message && typeof item.message === 'object' ? item.message : item
    return typeof (message as Record<string, unknown>).content === 'string' ? (message as Record<string, unknown>).content as string : ''
  }).join('')
}

function nativeResponsesStreamText(chunks: unknown[]): string | null | undefined {
  let text = ''
  let receivedOutputTextDelta = false
  let sawNativeResponsesEvent = false
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) continue
    const event = chunk as Record<string, unknown>
    const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data as Record<string, unknown> : null
    const eventType = typeof event.event === 'string' ? event.event : typeof data?.type === 'string' ? data.type : ''
    if (!eventType.startsWith('response.')) continue
    sawNativeResponsesEvent = true
    let next = ''
    if (eventType === 'response.output_text.delta') {
      receivedOutputTextDelta = true
      next = typeof data?.delta === 'string' ? data.delta : ''
    } else if (!receivedOutputTextDelta && eventType === 'response.output_text.done') {
      next = typeof data?.text === 'string' ? data.text : ''
    }
    if (next && text.length < maximumRecoveredStreamTextChars) text += next.slice(0, maximumRecoveredStreamTextChars - text.length)
  }
  if (!sawNativeResponsesEvent) return undefined
  return text
}

function responseFromStreamChunks(chunks: unknown[]) {
  const nativeResponsesText = nativeResponsesStreamText(chunks)
  if (nativeResponsesText !== undefined) return nativeResponsesText ? { protocol: 'stream', text: nativeResponsesText } : null
  let text = ''
  for (const chunk of chunks) {
    if (text.length >= maximumRecoveredStreamTextChars) break
    const next = streamChunkText(chunk)
    if (next) text += next.slice(0, maximumRecoveredStreamTextChars - text.length)
  }
  return text ? { protocol: 'stream', text } : null
}

function realMessages(prompt: unknown, response: unknown, capturedAt: string) {
  const messages: Array<z.infer<typeof messageSchema>> = []
  const seenUserQueries = new Set<string>()
  const seenAssistantReplies = new Set<string>()
  const add = (role: z.infer<typeof messageSchema>['role'], label: string, value: unknown, id: string, occurredAt = capturedAt, tool: z.infer<typeof messageSchema>['tool'] = null) => {
    const text = jsonText(value)
    messages.push({ id, role, label, occurredAt, text, tool })
  }
  const addUniqueUserText = (value: string, id: string, occurredAt = capturedAt) => {
    const text = value.trim()
    if (!text || seenUserQueries.has(text)) return false
    seenUserQueries.add(text)
    add('user', '用户输入', text, id, occurredAt)
    return true
  }
  const addUserQuery = (value: unknown, id: string, occurredAt = capturedAt) => {
    const blocks = userQueryBlocks(value)
    blocks.forEach((block, index) => {
      addUniqueUserText(block, `${id}-user-query-${index}`, occurredAt)
    })
    return blocks.length > 0
  }
  const addUserInput = (value: unknown, id: string, occurredAt = capturedAt) => {
    const parts = textParts(value)
    if (!parts.length) return false
    parts.forEach((part, index) => {
      if (addUserQuery(part, `${id}-${index}`, occurredAt)) return
      const text = visibleUserText(part)
      if (!isInternalCodexContext(text)) addUniqueUserText(text, `${id}-${index}`, occurredAt)
    })
    return true
  }
  const addAssistantReply = (value: unknown, id: string, occurredAt = capturedAt) => {
    const parts = textParts(value)
    const replies = parts.length ? parts : [jsonText(value)]
    let added = false
    replies.forEach((reply, index) => {
      const text = reply.trim()
      if (!text || seenAssistantReplies.has(text)) return
      seenAssistantReplies.add(text)
      add('assistant', '模型回复', text, `${id}-${index}`, occurredAt)
      added = true
    })
    return added
  }
  const roleLabel = (role: z.infer<typeof messageSchema>['role']) => role === 'user' ? '用户输入' : role === 'system' ? '系统指令' : role === 'developer' ? '开发者指令' : role === 'tool' ? '工具结果' : '模型消息'
  const roleOf = (value: unknown): z.infer<typeof messageSchema>['role'] => {
    if (value === 'system' || value === 'developer' || value === 'assistant' || value === 'tool') return value
    return 'user'
  }
  const toolDetails = (value: Record<string, unknown>) => {
    const functionValue = value.function && typeof value.function === 'object' ? value.function as Record<string, unknown> : value
    const name = typeof functionValue.name === 'string' ? functionValue.name : typeof value.name === 'string' ? value.name : 'tool'
    const args = functionValue.arguments ?? value.arguments
    return { name, summary: jsonText(args ?? value.output ?? value.content ?? ''), argumentsAvailable: args !== undefined, outputAvailable: value.output !== undefined || value.content !== undefined, ...(args !== undefined ? { arguments: args } : {}), ...(value.output !== undefined ? { output: value.output } : {}) }
  }
  if (prompt && typeof prompt === 'object') {
    const body = prompt as Record<string, unknown>
    if (typeof body.instructions === 'string') addUserQuery(body.instructions, 'prompt-instructions')
    if (Array.isArray(body.messages)) {
      body.messages.forEach((item, index) => {
        if (!item || typeof item !== 'object') return
        const message = item as Record<string, unknown>
        const role = roleOf(message.role)
        const value = message.content ?? message
        if (role === 'system' || role === 'developer') addUserQuery(value, `prompt-${index}`, capturedAt)
        else if (role === 'user' && !addUserInput(value, `prompt-${index}`, capturedAt)) add(role, roleLabel(role), value, `prompt-${index}`, capturedAt)
        else if (role !== 'user') add(role, roleLabel(role), value, `prompt-${index}`, capturedAt, role === 'tool' ? toolDetails(message) : null)
        if (role !== 'system' && role !== 'developer' && Array.isArray(message.tool_calls)) message.tool_calls.forEach((call, callIndex) => {
          if (call && typeof call === 'object') add('tool', '工具调用', call, `prompt-${index}-tool-${callIndex}`, capturedAt, toolDetails(call as Record<string, unknown>))
        })
      })
    } else if (typeof body.input === 'string') {
      if (!addUserInput(body.input, 'prompt-input')) add('user', '用户输入', body.input, 'prompt-input')
    }
    else if (Array.isArray(body.input)) body.input.forEach((item, index) => {
      if (item && typeof item === 'object') {
        const entry = item as Record<string, unknown>
        const role = roleOf(entry.role)
        const value = entry.content ?? entry.input_text ?? entry.text ?? entry
        if (role === 'system' || role === 'developer') addUserQuery(value, `prompt-input-${index}`)
        else if (role === 'user' && !addUserInput(value, `prompt-input-${index}`)) add('user', '用户输入', value, `prompt-input-${index}`)
        else if (role !== 'user') add(role, roleLabel(role), value, `prompt-input-${index}`)
      } else if (!addUserInput(item, `prompt-input-${index}`)) add('user', '用户输入', item, `prompt-input-${index}`)
    })
  } else if (prompt !== null && prompt !== undefined && !addUserInput(prompt, 'prompt-input')) add('user', '用户输入', prompt, 'prompt-input')

  if (response !== null && response !== undefined) {
    let responseContentAdded = false
    if (typeof response === 'object' && !Array.isArray(response)) {
      const body = response as Record<string, unknown>
      if (body.protocol === 'stream' && typeof body.text === 'string') responseContentAdded = addAssistantReply(body.text, 'response-stream-text') || responseContentAdded
      else if (typeof body.output_text === 'string') responseContentAdded = addAssistantReply(body.output_text, 'response-output-text') || responseContentAdded
      else if (typeof body.text === 'string') responseContentAdded = addAssistantReply(body.text, 'response-text') || responseContentAdded
      const choices = Array.isArray(body.choices) ? body.choices : []
      choices.forEach((choice, index) => {
        if (!choice || typeof choice !== 'object') return
        const item = choice as Record<string, unknown>
        const message = item.message && typeof item.message === 'object' ? item.message as Record<string, unknown> : item.delta && typeof item.delta === 'object' ? item.delta as Record<string, unknown> : item
        const role = message.role === 'tool' ? 'tool' : 'assistant'
        if (role === 'tool') {
          add(role, '工具调用', message.content ?? message, `response-choice-${index}`, capturedAt, toolDetails(message))
          responseContentAdded = true
        } else responseContentAdded = addAssistantReply(message.content ?? message.output_text ?? message.text ?? message, `response-choice-${index}`, capturedAt) || responseContentAdded
        if (Array.isArray(message.tool_calls)) message.tool_calls.forEach((call, callIndex) => {
          if (call && typeof call === 'object') {
            add('tool', '工具调用', call, `response-choice-${index}-tool-${callIndex}`, capturedAt, toolDetails(call as Record<string, unknown>))
            responseContentAdded = true
          }
        })
      })
      if (Array.isArray(body.output)) body.output.forEach((item, index) => {
        if (item && typeof item === 'object') {
          const entry = item as Record<string, unknown>
          const role = roleOf(entry.role === 'tool' ? 'tool' : 'assistant')
          if (role === 'tool') {
            add(role, roleLabel(role), entry.content ?? entry.output_text ?? entry.text ?? entry, `response-output-${index}`, capturedAt, toolDetails(entry))
            responseContentAdded = true
          } else responseContentAdded = addAssistantReply(entry.content ?? entry.output_text ?? entry.text ?? entry, `response-output-${index}`, capturedAt) || responseContentAdded
        } else responseContentAdded = addAssistantReply(item, `response-output-${index}`, capturedAt) || responseContentAdded
      })
      if (!responseContentAdded) addAssistantReply(response, 'response-body')
    } else addAssistantReply(response, 'response-body')
  }
  return messages
}

function createRealConversationAccess(database: PlatformDatabase, record: ConversationAuditRecord, now: Date, accessRecord: { id: string; persisted: boolean; auditEventId?: string | null } | undefined) {
  const stored = database.getConversationAuditContent(record.id)
  if (!stored || (!stored.promptAvailable && !stored.responseAvailable && stored.chunks.length === 0)) return null
  const expired = new Date(record.retentionUntil).getTime() <= now.getTime() || record.state === 'expired'
  const usageLink = database.getConversationUsageLink(record.id)
  // Prefer the raw stream events for streamed calls. They preserve the actual
  // output-text deltas and let us exclude reasoning summaries and terminal
  // snapshots that some Responses-compatible upstreams also emit.
  const response = (record.streamed ? responseFromStreamChunks(stored.chunks) : null) ?? stored.response ?? responseFromStreamChunks(stored.chunks)
  const messages = realMessages(stored.prompt, response, record.startedAt)
  return {
    meta: { source: 'database' as const, generatedAt: now.toISOString(), notice: '已从本地 SQLite 解密读取真实请求/回复正文；系统上下文已过滤，仅展示 user_query 与模型可见轮次，不包含认证 Header 或完整 Key。' },
    record,
    access: { accessRecordId: accessRecord?.id ?? `access-${record.id}`, auditEventId: accessRecord?.auditEventId ?? null, reasonAccepted: true as const, persisted: accessRecord?.persisted ?? false, authorizedByServerRbac: true as const, copyAllowed: true, exportAllowed: true, deleteAllowed: true as const },
    // Do not return the raw captured request body. It can contain long client
    // system prompts and internal reminders; `messages` is already normalized
    // to user_query/user-visible turns by realMessages above.
    content: { decrypted: true as const, conversationTitle: `${record.person.name} · ${record.model.actualModel ?? record.model.label}`, messages },
    retention: { expiresAt: record.retentionUntil, cleanupState: expired ? 'expired' as const : 'scheduled' as const, deletionProofAvailable: expired, notice: expired ? '正文已按 30 天保留策略清理，页面不提供恢复。' : '正文按 30 天保留策略保存，到期后由本地清理任务删除。' },
    linkedUsage: usageLink
      ? { auditRequestId: record.requestId, usageRequestId: usageLink.usageRequestId, metadataEndpoint: `/api/usage/${usageLink.usageRequestId}`, linkVerified: true, source: 'gateway_capture' as const, notice: '已关联同一 request_id 的网关用量元数据。' }
      : { auditRequestId: record.requestId, usageRequestId: null, metadataEndpoint: null, linkVerified: false, source: 'unavailable' as const, notice: '当前请求尚无可关联的用量记录。' },
  }
}

export function createDatabaseConversationAccess(database: PlatformDatabase, record: ConversationAuditRecord, body: ConversationAccessBody, now = new Date(), accessRecord?: { id: string; persisted: boolean; auditEventId?: string | null }) {
  void body
  if (!record.contentAccess.available) return null
  return createRealConversationAccess(database, record, now, accessRecord)
}
