import { z } from 'zod'
import type { AppRole } from './auth.js'
import type { ConversationAuditCleanupStatus, PlatformConversationAuditRecord, PlatformDatabase } from './platform-db.js'

const periodSchema = z.enum(['today', '7d', '30d'])
const captureStateSchema = z.enum(['captured', 'metadata_only', 'expired'])
const redactionStateSchema = z.enum(['passed', 'review_required', 'not_applicable'])
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
  redaction: z.union([z.literal('all'), redactionStateSchema]).default('all'),
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

const optionSchema = z.object({ id: z.string(), label: z.string() })
const policySchema = z.object({ id: z.string(), label: z.string(), scope: z.string(), expiresAt: z.string().datetime() })
const recordSchema = z.object({
  id: z.string(), requestId: z.string().regex(/^req-[a-z0-9-]+$/), capturedAt: z.string().datetime(),
  person: z.object({ id: z.string(), name: z.string(), department: z.string() }),
  key: z.object({ id: z.string(), masked: z.string() }), purpose: optionSchema,
  model: z.object({ id: z.string(), label: z.string() }), policy: policySchema,
  state: captureStateSchema,
  redaction: z.object({ status: redactionStateSchema, findings: z.number().int().nonnegative(), rawContentAvailable: z.boolean() }),
  grouping: z.object({ type: groupingSchema, reliable: z.boolean(), label: z.string() }),
  metrics: z.object({ turns: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative() }),
  contentAccess: z.object({ available: z.boolean(), requiresReason: z.boolean(), requiredRole: z.literal('super_admin') }),
  externalTokenId: z.string().nullable(), endpoint: z.string().nullable(), startedAt: z.string().datetime(), completedAt: z.string().datetime().nullable(),
  status: auditStatusSchema.nullable(), httpStatus: z.number().int().nullable(), promptBodyRef: z.string().nullable(), responseBodyRef: z.string().nullable(),
  promptBytes: z.number().int().nonnegative().nullable(), responseBytes: z.number().int().nonnegative().nullable(), retentionUntil: z.string().datetime(),
  exportCount: z.number().int().nonnegative(), streamed: z.boolean(), chunkCount: z.number().int().nonnegative(), terminationReason: z.string().nullable(),
  promptAvailable: z.boolean(), responseAvailable: z.boolean(), bodyUnavailableReason: z.string().nullable(),
})

const metaSchema = z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), period: periodSchema, notice: z.string() })
export const conversationAuditResponseSchema = z.object({
  meta: metaSchema,
  accessControl: z.object({ currentRole: z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee']), serverRbacVerified: z.literal(true), contentRequiresReason: z.boolean(), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), captured: z.number().int().nonnegative(), metadataOnly: z.number().int().nonnegative(), expiringSoon: z.number().int().nonnegative(), independentCalls: z.number().int().nonnegative(), reviewRequired: z.number().int().nonnegative() }),
  scope: z.object({ defaultCaptureEnabled: z.boolean(), activePolicies: z.number().int().nonnegative(), nearestExpiryAt: z.string().datetime(), storageEncryptedVerified: z.boolean(), accessAuditPersisted: z.boolean(), retention: z.object({ mode: z.enum(['metadata_only', 'encrypted_sqlite']), proofRecords: z.number().int().nonnegative(), lastRunAt: z.string().datetime().nullable(), notice: z.string() }), notice: z.string() }),
  options: z.object({ people: z.array(optionSchema), keys: z.array(optionSchema), purposes: z.array(optionSchema), models: z.array(optionSchema), policies: z.array(optionSchema) }),
  items: z.array(recordSchema),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
})

const messageSchema = z.object({
  id: z.string(), role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']), label: z.string(), occurredAt: z.string().datetime(),
  text: z.string(), redacted: z.boolean(), redactionLabels: z.array(z.string()),
  tool: z.object({ name: z.string(), summary: z.string(), argumentsAvailable: z.boolean(), outputAvailable: z.boolean(), arguments: z.unknown().optional(), output: z.unknown().optional() }).nullable(),
})

export const conversationAccessResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), notice: z.string() }),
  record: recordSchema,
  access: z.object({ accessRecordId: z.string(), auditEventId: z.string().regex(/^audit-[a-z0-9-]+$/).nullable(), reasonAccepted: z.literal(true), persisted: z.boolean(), authorizedByServerRbac: z.literal(true), copyAllowed: z.boolean(), exportAllowed: z.boolean(), deleteAllowed: z.literal(false) }),
  content: z.object({ synthetic: z.boolean(), decrypted: z.boolean(), redactionPassed: z.boolean(), conversationTitle: z.string(), messages: z.array(messageSchema), prompt: z.unknown().optional(), response: z.unknown().optional(), chunks: z.array(z.unknown()).optional() }),
  retention: z.object({ expiresAt: z.string().datetime(), cleanupState: z.enum(['scheduled', 'expired', 'not_applicable']), deletionProofAvailable: z.boolean(), notice: z.string() }),
  linkedUsage: z.object({ auditRequestId: z.string(), usageRequestId: z.string().nullable(), metadataEndpoint: z.string().nullable(), linkVerified: z.boolean(), source: z.enum(['synthetic_seed', 'gateway_capture', 'unavailable']), notice: z.string() }),
})

const conversationAccessHistoryItemSchema = z.object({
  id: z.string(), actorName: z.string(), requestId: z.string().regex(/^req-[a-z0-9-]+$/),
  action: z.enum(['view_synthetic', 'view', 'copy', 'export']), reasonProvided: z.boolean(), reasonLength: z.number().int().min(0).max(200),
  acknowledgedSensitiveScope: z.boolean(), occurredAt: z.string().datetime(),
})

export const conversationAccessHistoryResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), notice: z.string() }),
  record: z.object({ id: z.string(), requestId: z.string().regex(/^req-[a-z0-9-]+$/) }),
  items: z.array(conversationAccessHistoryItemSchema).max(20),
})

export type ConversationAuditQuery = z.infer<typeof conversationAuditQuerySchema>
export type ConversationAuditRecord = z.infer<typeof recordSchema>
export type ConversationAccessBody = z.infer<typeof conversationAccessBodySchema>

const ago = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()
const after = (now: Date, minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString()

interface Seed extends Omit<ConversationAuditRecord, 'capturedAt' | 'policy' | 'externalTokenId' | 'endpoint' | 'startedAt' | 'completedAt' | 'status' | 'httpStatus' | 'promptBodyRef' | 'responseBodyRef' | 'promptBytes' | 'responseBytes' | 'retentionUntil' | 'exportCount' | 'streamed' | 'chunkCount' | 'terminationReason' | 'promptAvailable' | 'responseAvailable' | 'bodyUnavailableReason'> { minutes: number; policy: Omit<ConversationAuditRecord['policy'], 'expiresAt'> & { expiresInMinutes: number } }

const seeds: Seed[] = [
  { id: 'conv-audit-copy-01', requestId: 'req-260915-8f31', minutes: 18, person: { id: 'person-lin', name: '林梓雨', department: '内容运营' }, key: { id: 'key-lin-1', masked: 'sk-ops••••••7F2A' }, purpose: { id: 'purpose-copy', label: '商品文案' }, model: { id: 'gpt-5.5', label: 'GPT-5.5' }, policy: { id: 'policy-key-lin', label: '林梓雨测试 Key', scope: '指定 Key', expiresInMinutes: 2_820 }, state: 'captured', redaction: { status: 'passed', findings: 2, rawContentAvailable: false }, grouping: { type: 'conversation', reliable: true, label: '会话 conv-demo-copy-01' }, metrics: { turns: 3, toolCalls: 1, totalTokens: 2_430 }, contentAccess: { available: true, requiresReason: true, requiredRole: 'super_admin' } },
  { id: 'conv-audit-support-02', requestId: 'req-260915-a217', minutes: 72, person: { id: 'person-xu', name: '徐静怡', department: '客户成功' }, key: { id: 'key-xu-2', masked: 'sk-ops••••••A921' }, purpose: { id: 'purpose-support', label: '客服回复' }, model: { id: 'gpt-5.5', label: 'GPT-5.5' }, policy: { id: 'policy-purpose-support', label: '客服质检试点', scope: '指定用途', expiresInMinutes: 1_380 }, state: 'captured', redaction: { status: 'review_required', findings: 4, rawContentAvailable: false }, grouping: { type: 'conversation', reliable: true, label: '会话 conv-demo-support-02' }, metrics: { turns: 5, toolCalls: 0, totalTokens: 3_980 }, contentAccess: { available: true, requiresReason: true, requiredRole: 'super_admin' } },
  { id: 'conv-audit-independent-03', requestId: 'req-260915-b903', minutes: 155, person: { id: 'person-zhou', name: '周阳远', department: '增长投放' }, key: { id: 'key-zhou-1', masked: 'sk-ops••••••8B14' }, purpose: { id: 'purpose-analysis', label: '策略分析' }, model: { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }, policy: { id: 'policy-person-zhou', label: '周阳远排障窗口', scope: '指定人员', expiresInMinutes: 540 }, state: 'captured', redaction: { status: 'passed', findings: 1, rawContentAvailable: false }, grouping: { type: 'independent_call', reliable: false, label: '独立调用' }, metrics: { turns: 1, toolCalls: 2, totalTokens: 1_860 }, contentAccess: { available: true, requiresReason: true, requiredRole: 'super_admin' } },
  { id: 'conv-audit-metadata-04', requestId: 'req-260915-c114', minutes: 230, person: { id: 'person-chen', name: '陈宇航', department: '商品运营' }, key: { id: 'key-chen-1', masked: 'sk-ops••••••3C91' }, purpose: { id: 'purpose-copy', label: '商品文案' }, model: { id: 'gpt-5.5', label: 'GPT-5.5' }, policy: { id: 'policy-disabled', label: '默认关闭', scope: '未命中策略', expiresInMinutes: 43_200 }, state: 'metadata_only', redaction: { status: 'not_applicable', findings: 0, rawContentAvailable: false }, grouping: { type: 'independent_call', reliable: false, label: '独立调用' }, metrics: { turns: 0, toolCalls: 0, totalTokens: 820 }, contentAccess: { available: false, requiresReason: true, requiredRole: 'super_admin' } },
  { id: 'conv-audit-expired-05', requestId: 'req-260914-d702', minutes: 1_460, person: { id: 'person-lin', name: '林梓雨', department: '内容运营' }, key: { id: 'key-lin-1', masked: 'sk-ops••••••7F2A' }, purpose: { id: 'purpose-copy', label: '商品文案' }, model: { id: 'gpt-5.5', label: 'GPT-5.5' }, policy: { id: 'policy-key-lin-old', label: '历史测试窗口', scope: '指定 Key', expiresInMinutes: -20 }, state: 'expired', redaction: { status: 'passed', findings: 1, rawContentAvailable: false }, grouping: { type: 'conversation', reliable: true, label: '会话 conv-demo-expired-05' }, metrics: { turns: 4, toolCalls: 1, totalTokens: 2_910 }, contentAccess: { available: false, requiresReason: true, requiredRole: 'super_admin' } },
  { id: 'conv-audit-research-06', requestId: 'req-260913-e420', minutes: 2_780, person: { id: 'person-lin', name: '林梓雨', department: '内容运营' }, key: { id: 'key-lin-3', masked: 'sk-ops••••••D410' }, purpose: { id: 'purpose-research', label: '资料整理' }, model: { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' }, policy: { id: 'policy-person-lin', label: '内容团队试点', scope: '指定人员', expiresInMinutes: 5_760 }, state: 'captured', redaction: { status: 'passed', findings: 3, rawContentAvailable: false }, grouping: { type: 'conversation', reliable: true, label: '会话 conv-demo-research-06' }, metrics: { turns: 7, toolCalls: 3, totalTokens: 8_240 }, contentAccess: { available: true, requiresReason: true, requiredRole: 'super_admin' } },
  { id: 'conv-audit-metadata-07', requestId: 'req-260912-f815', minutes: 4_310, person: { id: 'person-xu', name: '徐静怡', department: '客户成功' }, key: { id: 'key-xu-3', masked: 'sk-ops••••••F055' }, purpose: { id: 'purpose-summary', label: '会议纪要' }, model: { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }, policy: { id: 'policy-disabled', label: '默认关闭', scope: '未命中策略', expiresInMinutes: 43_200 }, state: 'metadata_only', redaction: { status: 'not_applicable', findings: 0, rawContentAvailable: false }, grouping: { type: 'independent_call', reliable: false, label: '独立调用' }, metrics: { turns: 0, toolCalls: 0, totalTokens: 1_120 }, contentAccess: { available: false, requiresReason: true, requiredRole: 'super_admin' } },
]

function records(now: Date): ConversationAuditRecord[] {
  return seeds.map(({ minutes, policy, ...item }) => {
    const capturedAt = ago(now, minutes)
    const retentionUntil = after(now, policy.expiresInMinutes)
    return {
      ...item,
      contentAccess: { ...item.contentAccess, requiresReason: false },
      capturedAt,
      policy: { id: policy.id, label: policy.label, scope: policy.scope, expiresAt: retentionUntil },
      externalTokenId: null,
      endpoint: null,
      startedAt: capturedAt,
      completedAt: null,
      status: item.state === 'captured' ? 'succeeded' as const : null,
      httpStatus: null,
      promptBodyRef: null,
      responseBodyRef: null,
      promptBytes: null,
      responseBytes: null,
      retentionUntil,
      exportCount: 0,
      streamed: false,
      chunkCount: 0,
      terminationReason: null,
      promptAvailable: false,
      responseAvailable: false,
      bodyUnavailableReason: item.state === 'metadata_only' ? '该历史请求未启用正文采集' : null,
    }
  })
}

function recordFromDatabase(row: PlatformConversationAuditRecord, now = new Date()): ConversationAuditRecord {
  const realRecord = Boolean(row.auditStatus || row.promptBodyRef || row.responseBodyRef || row.externalTokenId)
  const startedAt = row.startedAt ?? row.capturedAt
  const retentionUntil = row.retentionUntil ?? row.policyExpiresAt
  // Body references intentionally remain as deletion evidence after retention
  // cleanup. Only expose availability while the encrypted content is still
  // accessible; otherwise the list would misleadingly offer expired bodies.
  const bodyAccessible = row.contentAccessAvailable === 1 && row.state !== 'expired' && new Date(retentionUntil).getTime() > now.getTime()
  return {
    id: row.id,
    requestId: row.requestId,
    capturedAt: row.capturedAt,
    person: { id: row.personId, name: row.personName, department: row.departmentName },
    key: { id: row.keyId, masked: row.keyMasked },
    purpose: { id: row.purposeId, label: row.purposeLabel },
    model: { id: row.modelId, label: row.modelLabel },
    policy: { id: row.policyId, label: row.policyLabel, scope: row.policyScope, expiresAt: row.policyExpiresAt },
    state: row.state,
    redaction: { status: row.redactionStatus, findings: row.redactionFindings, rawContentAvailable: bodyAccessible && Boolean(row.promptBodyRef || row.responseBodyRef) },
    grouping: { type: row.groupingType, reliable: row.groupingReliable === 1, label: row.groupingLabel },
    metrics: { turns: row.turns, toolCalls: row.toolCalls, totalTokens: row.totalTokens },
    contentAccess: { available: bodyAccessible, requiresReason: false, requiredRole: 'super_admin' },
    externalTokenId: row.externalTokenId ?? null,
    endpoint: row.endpoint ?? null,
    startedAt,
    completedAt: row.completedAt ?? null,
    status: row.auditStatus ?? (realRecord ? 'body_unavailable' : row.state === 'captured' ? 'succeeded' : null),
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
    responseAvailable: bodyAccessible && Boolean(row.responseBodyRef),
    bodyUnavailableReason: row.captureError ?? null,
  }
}

function periodMinutes(period: ConversationAuditQuery['period']) { return period === 'today' ? 1_440 : period === '7d' ? 10_080 : 43_200 }

function filterRecords(all: ConversationAuditRecord[], query: ConversationAuditQuery, now: Date) {
  const cutoff = now.getTime() - periodMinutes(query.period) * 60_000
  const needle = query.search.toLocaleLowerCase('zh-CN')
  return all.filter((item) => {
    const matchesSearch = !needle || [item.id, item.requestId, item.person.name, item.key.masked, item.purpose.label, item.model.label, item.policy.label].some((value) => value.toLocaleLowerCase('zh-CN').includes(needle))
    return new Date(item.capturedAt).getTime() >= cutoff && matchesSearch && (query.person === 'all' || item.person.id === query.person) && (query.key === 'all' || item.key.id === query.key) && (query.purpose === 'all' || item.purpose.id === query.purpose) && (query.model === 'all' || item.model.id === query.model) && (query.policy === 'all' || item.policy.id === query.policy) && (query.state === 'all' || item.state === query.state) && (query.redaction === 'all' || item.redaction.status === query.redaction) && (query.grouping === 'all' || item.grouping.type === query.grouping)
  })
}

function createConversationAuditResponse(all: ConversationAuditRecord[], query: ConversationAuditQuery, now: Date, currentRole: AppRole, source: 'demo' | 'database', accessAuditPersisted: boolean, cleanupStatus: ConversationAuditCleanupStatus | null = null) {
  const filtered = filterRecords(all, query, now)
  const start = (query.page - 1) * query.pageSize
  const unique = <T extends { id: string; label: string }>(values: T[]) => [...new Map(values.map((item) => [item.id, item])).values()]
  const expiry = all.filter((item) => item.state === 'captured').map((item) => item.policy.expiresAt).sort()[0] ?? now.toISOString()
  const databaseMetadata = source === 'database'
  const hasRealCapture = all.some((item) => item.externalTokenId || item.endpoint || item.promptAvailable || item.responseAvailable || item.status === 'streaming')
  const retentionMode = hasRealCapture ? 'encrypted_sqlite' as const : 'metadata_only' as const
  return {
    meta: { source, generatedAt: now.toISOString(), period: query.period, notice: hasRealCapture ? '真实网关请求已在服务端采集；正文以加密引用保存在本地 SQLite，列表不返回正文。' : databaseMetadata ? '本地 SQLite 当前只有历史元数据演示记录；未采集的历史请求无法还原正文。' : '独立审计存储尚未接入；列表为不含真实正文的安全演示数据' },
    accessControl: { currentRole, serverRbacVerified: true as const, contentRequiresReason: false as const, notice: '当前请求已通过服务端超级管理员 RBAC；选择记录后可直接查看正文，查看、复制和导出仍会写入访问审计。' },
    summary: { total: filtered.length, captured: filtered.filter((item) => item.state === 'captured').length, metadataOnly: filtered.filter((item) => item.state === 'metadata_only').length, expiringSoon: filtered.filter((item) => item.state === 'captured' && new Date(item.policy.expiresAt).getTime() - now.getTime() <= 1_440 * 60_000).length, independentCalls: filtered.filter((item) => item.grouping.type === 'independent_call').length, reviewRequired: filtered.filter((item) => item.redaction.status === 'review_required').length },
    scope: {
      defaultCaptureEnabled: hasRealCapture,
      activePolicies: hasRealCapture ? 1 : 3,
      nearestExpiryAt: expiry,
      storageEncryptedVerified: hasRealCapture,
      accessAuditPersisted,
      retention: {
        mode: retentionMode,
        proofRecords: cleanupStatus?.proofRecords ?? 0,
        lastRunAt: cleanupStatus?.lastRun?.completedAt ?? null,
        notice: databaseMetadata
          ? cleanupStatus?.proofRecords
          ? hasRealCapture ? '到期任务会删除加密正文并保留元数据删除证明。' : '本地到期证明仅确认历史元数据；这些记录没有正文可删除。'
            : hasRealCapture ? '暂无新的到期删除批次。' : '尚未发现需要生成本地到期证明的历史元数据。'
          : '演示页面未执行数据库到期处理。',
      },
      notice: hasRealCapture ? '网关鉴权和模型校验通过后开始采集；正文与元数据分离保存，采集失败不会改变上游请求语义。' : databaseMetadata ? '未采集的历史请求只有元数据；新的已鉴权网关请求会在转发边界生成正文审计记录。' : '演示页面不代表正文加密、访问审计或到期清理已经验收。',
    },
    options: { people: unique(all.map((item) => ({ id: item.person.id, label: item.person.name }))), keys: unique(all.map((item) => ({ id: item.key.id, label: item.key.masked }))), purposes: unique(all.map((item) => item.purpose)), models: unique(all.map((item) => ({ id: item.model.id, label: item.model.label }))), policies: unique(all.map((item) => ({ id: item.policy.id, label: item.policy.label }))) },
    items: filtered.slice(start, start + query.pageSize), pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) },
  }
}

export function createDatabaseConversationAudits(database: PlatformDatabase, query: ConversationAuditQuery, now = new Date(), currentRole: AppRole = 'super_admin') {
  return createConversationAuditResponse(database.listConversationAuditRecords().map((row) => recordFromDatabase(row, now)), query, now, currentRole, 'database', true, database.getConversationAuditCleanupStatus())
}

export function getDatabaseConversationAuditRecord(database: PlatformDatabase, id: string, now = new Date()) {
  return database.listConversationAuditRecords().map((row) => recordFromDatabase(row, now)).find((item) => item.id === id) ?? null
}

export function createDatabaseConversationAccessHistory(database: PlatformDatabase, id: string, now = new Date()) {
  const record = getDatabaseConversationAuditRecord(database, id)
  if (!record) return null
  return {
     meta: { source: 'database' as const, generatedAt: now.toISOString(), notice: '仅显示最近 50 条正文访问、复制和导出元数据；系统上下文和凭据均不返回。' },
     record: { id: record.id, requestId: record.requestId },
     items: [
       ...database.listConversationAccessEvents(record.id).map((item) => ({
       id: item.id,
       actorName: item.actorName,
       requestId: item.requestId,
       action: 'view_synthetic' as const,
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
     ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 50),
   }
}

export function createDemoConversationAudits(query: ConversationAuditQuery, now = new Date(), currentRole: AppRole = 'super_admin', accessAuditPersisted = false) {
  return createConversationAuditResponse(records(now), query, now, currentRole, 'demo', accessAuditPersisted)
}

export function getDemoConversationAuditRecord(id: string, now = new Date()) {
  return records(now).find((item) => item.id === id) ?? null
}

function createSyntheticConversationAccess(record: ConversationAuditRecord, now: Date, accessRecord: { id: string; persisted: boolean; auditEventId?: string | null } | undefined, source: 'demo' | 'database', usageLink: { usageRequestId: string; linkSource: 'synthetic_seed' | 'gateway_capture' } | null = null) {
  const baseTime = new Date(record.capturedAt).getTime()
  const at = (seconds: number) => new Date(baseTime + seconds * 1_000).toISOString()
  const expired = new Date(record.policy.expiresAt).getTime() <= now.getTime()
  return {
    meta: { source, generatedAt: now.toISOString(), notice: source === 'database' ? '以下为合成且预先脱敏的演示轮次；SQLite 仅保存元数据，未读取、解密或返回任何真实对话正文。' : '以下为合成且预先脱敏的演示轮次；未读取、解密或返回任何真实对话正文。' }, record,
    access: { accessRecordId: accessRecord?.id ?? `access-demo-${record.id.replace('conv-audit-', '')}`, auditEventId: accessRecord?.auditEventId ?? null, reasonAccepted: true as const, persisted: accessRecord?.persisted ?? false, authorizedByServerRbac: true as const, copyAllowed: false as const, exportAllowed: false as const, deleteAllowed: false as const },
    content: { synthetic: true as const, decrypted: false as const, redactionPassed: record.redaction.status === 'passed', conversationTitle: record.grouping.type === 'independent_call' ? '独立调用 · 演示内容' : `${record.purpose.label} · 演示会话`, messages: [
      { id: 'msg-user-1', role: 'user' as const, label: '用户输入', occurredAt: at(0), text: '请根据订单 [ORDER_ID] 的公开商品信息，整理一版不超过 120 字的回复。客户联系方式已替换为 [PHONE_REDACTED]。', redacted: true, redactionLabels: ['订单编号', '手机号'], tool: null },
      { id: 'msg-tool-1', role: 'tool' as const, label: '工具调用摘要', occurredAt: at(2), text: '读取公开商品目录，返回 3 条匹配记录。参数和原始输出未保留。', redacted: false, redactionLabels: [], tool: { name: 'catalog_search', summary: '按脱敏商品编号查询公开目录', argumentsAvailable: false as const, outputAvailable: false as const } },
      { id: 'msg-assistant-1', role: 'assistant' as const, label: '模型回答', occurredAt: at(5), text: '您好，已为您核对该商品信息。当前订单状态正常，预计将在承诺时段内完成处理；如状态变化，我们会通过原渠道通知您。', redacted: false, redactionLabels: [], tool: null },
    ] },
    retention: { expiresAt: record.policy.expiresAt, cleanupState: expired ? 'expired' as const : 'scheduled' as const, deletionProofAvailable: false as const, notice: expired ? '该合成元数据已到期；页面不提供恢复、正文删除或真实删除证明。' : '到期时仅生成合成元数据的无正文证明；本页面不提供删除操作。' },
    linkedUsage: usageLink
      ? { auditRequestId: record.requestId, usageRequestId: usageLink.usageRequestId, metadataEndpoint: `/api/usage/${usageLink.usageRequestId}`, linkVerified: true, source: usageLink.linkSource, notice: '已关联 SQLite 中明确保存的合成用量映射；不代表真实网关请求 ID 透传或真实调用日志对账。' }
      : { auditRequestId: record.requestId, usageRequestId: null, metadataEndpoint: null, linkVerified: false, source: 'unavailable' as const, notice: '尚未关联 SQLite 模拟用量元数据；不代表真实网关请求 ID 丢失。' },
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

function realMessages(prompt: unknown, response: unknown, capturedAt: string) {
  const messages: Array<z.infer<typeof messageSchema>> = []
  const seenUserQueries = new Set<string>()
  const add = (role: z.infer<typeof messageSchema>['role'], label: string, value: unknown, id: string, occurredAt = capturedAt, tool: z.infer<typeof messageSchema>['tool'] = null) => {
    const text = jsonText(value)
    messages.push({ id, role, label, occurredAt, text, redacted: text.includes('[REDACTED]'), redactionLabels: text.includes('[REDACTED]') ? ['凭据字段'] : [], tool })
  }
  const addUserQuery = (value: unknown, id: string, occurredAt = capturedAt) => {
    const blocks = userQueryBlocks(value)
    blocks.forEach((block, index) => {
      if (seenUserQueries.has(block)) return
      seenUserQueries.add(block)
      add('user', '用户输入', block, `${id}-user-query-${index}`, occurredAt)
    })
    return blocks.length > 0
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
        else if (role === 'user' && !addUserQuery(value, `prompt-${index}`, capturedAt)) add(role, roleLabel(role), value, `prompt-${index}`, capturedAt)
        else if (role !== 'user') add(role, roleLabel(role), value, `prompt-${index}`, capturedAt, role === 'tool' ? toolDetails(message) : null)
        if (role !== 'system' && role !== 'developer' && Array.isArray(message.tool_calls)) message.tool_calls.forEach((call, callIndex) => {
          if (call && typeof call === 'object') add('tool', '工具调用', call, `prompt-${index}-tool-${callIndex}`, capturedAt, toolDetails(call as Record<string, unknown>))
        })
      })
    } else if (typeof body.input === 'string') {
      if (!addUserQuery(body.input, 'prompt-input')) add('user', '用户输入', body.input, 'prompt-input')
    }
    else if (Array.isArray(body.input)) body.input.forEach((item, index) => {
      if (item && typeof item === 'object') {
        const entry = item as Record<string, unknown>
        const role = roleOf(entry.role)
        const value = entry.content ?? entry.input_text ?? entry
        if (role === 'system' || role === 'developer') addUserQuery(value, `prompt-input-${index}`)
        else if (role === 'user' && !addUserQuery(value, `prompt-input-${index}`)) add('user', '用户输入', value, `prompt-input-${index}`)
        else if (role !== 'user') add(role, roleLabel(role), value, `prompt-input-${index}`)
      } else if (!addUserQuery(item, `prompt-input-${index}`)) add('user', '用户输入', item, `prompt-input-${index}`)
    })
  } else if (prompt !== null && prompt !== undefined && !addUserQuery(prompt, 'prompt-input')) add('user', '用户输入', prompt, 'prompt-input')

  if (response !== null && response !== undefined) {
    if (typeof response === 'object' && !Array.isArray(response)) {
      const body = response as Record<string, unknown>
      if (body.protocol === 'stream' && typeof body.text === 'string') add('assistant', '模型回复', body.text, 'response-stream-text')
      else if (typeof body.output_text === 'string') add('assistant', '模型回复', body.output_text, 'response-output-text')
      else if (typeof body.text === 'string') add('assistant', '模型回复', body.text, 'response-text')
      const choices = Array.isArray(body.choices) ? body.choices : []
      choices.forEach((choice, index) => {
        if (!choice || typeof choice !== 'object') return
        const item = choice as Record<string, unknown>
        const message = item.message && typeof item.message === 'object' ? item.message as Record<string, unknown> : item.delta && typeof item.delta === 'object' ? item.delta as Record<string, unknown> : item
        const role = message.role === 'tool' ? 'tool' : 'assistant'
        add(role, role === 'tool' ? '工具调用' : '模型回复', message.content ?? message, `response-choice-${index}`, capturedAt, role === 'tool' ? toolDetails(message) : null)
        if (Array.isArray(message.tool_calls)) message.tool_calls.forEach((call, callIndex) => {
          if (call && typeof call === 'object') add('tool', '工具调用', call, `response-choice-${index}-tool-${callIndex}`, capturedAt, toolDetails(call as Record<string, unknown>))
        })
      })
      if (Array.isArray(body.output)) body.output.forEach((item, index) => {
        if (item && typeof item === 'object') {
          const entry = item as Record<string, unknown>
          const role = roleOf(entry.role === 'tool' ? 'tool' : 'assistant')
          add(role, roleLabel(role), entry.content ?? entry.output_text ?? entry, `response-output-${index}`, capturedAt, role === 'tool' ? toolDetails(entry) : null)
        } else add('assistant', '模型回复', item, `response-output-${index}`)
      })
      if (messages.every((item) => item.role !== 'assistant' && item.role !== 'tool')) add('assistant', '模型回复', response, 'response-body')
    } else add('assistant', '模型回复', response, 'response-body')
  }
  return messages
}

function createRealConversationAccess(database: PlatformDatabase, record: ConversationAuditRecord, now: Date, accessRecord: { id: string; persisted: boolean; auditEventId?: string | null } | undefined) {
  const stored = database.getConversationAuditContent(record.id)
  if (!stored || (!stored.promptAvailable && !stored.responseAvailable)) return null
  const expired = new Date(record.retentionUntil).getTime() <= now.getTime() || record.state === 'expired'
  const usageLink = database.getConversationUsageLink(record.id)
  const response = stored.response
  const messages = realMessages(stored.prompt, response, record.startedAt)
  return {
    meta: { source: 'database' as const, generatedAt: now.toISOString(), notice: '已从本地 SQLite 解密读取真实请求/回复正文；系统上下文已过滤，仅展示 user_query 与模型可见轮次，不包含认证 Header 或完整 Key。' },
    record,
    access: { accessRecordId: accessRecord?.id ?? `access-${record.id}`, auditEventId: accessRecord?.auditEventId ?? null, reasonAccepted: true as const, persisted: accessRecord?.persisted ?? false, authorizedByServerRbac: true as const, copyAllowed: true, exportAllowed: true, deleteAllowed: false as const },
    // Do not return the raw captured request body. It can contain long client
    // system prompts and internal reminders; `messages` is already normalized
    // to user_query/user-visible turns by realMessages above.
    content: { synthetic: false, decrypted: true, redactionPassed: record.redaction.status === 'passed', conversationTitle: `${record.person.name} · ${record.model.label}`, messages },
    retention: { expiresAt: record.retentionUntil, cleanupState: expired ? 'expired' as const : 'scheduled' as const, deletionProofAvailable: expired, notice: expired ? '正文已按 30 天保留策略清理，页面不提供恢复。' : '正文按 30 天保留策略保存，到期后由本地清理任务删除。' },
    linkedUsage: usageLink
      ? { auditRequestId: record.requestId, usageRequestId: usageLink.usageRequestId, metadataEndpoint: `/api/usage/${usageLink.usageRequestId}`, linkVerified: true, source: usageLink.linkSource, notice: usageLink.linkSource === 'gateway_capture' ? '已关联同一 request_id 的网关用量元数据。' : '已关联历史本地用量映射。' }
      : { auditRequestId: record.requestId, usageRequestId: null, metadataEndpoint: null, linkVerified: false, source: 'unavailable' as const, notice: '当前请求尚无可关联的用量记录。' },
  }
}

export function createDemoConversationAccess(id: string, _body: ConversationAccessBody, now = new Date(), accessRecord?: { id: string; persisted: boolean }) {
  const record = getDemoConversationAuditRecord(id, now)
  if (!record || !record.contentAccess.available) return null
  return createSyntheticConversationAccess(record, now, accessRecord, 'demo')
}

export function createDatabaseConversationAccess(database: PlatformDatabase, record: ConversationAuditRecord, body: ConversationAccessBody, now = new Date(), accessRecord?: { id: string; persisted: boolean; auditEventId?: string | null }) {
  void body
  if (!record.contentAccess.available) return null
  if (record.promptAvailable || record.responseAvailable || record.externalTokenId || record.endpoint) return createRealConversationAccess(database, record, now, accessRecord)
  return createSyntheticConversationAccess(record, now, accessRecord, 'database', database.getConversationUsageLink(record.id))
}
