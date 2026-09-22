import { z } from 'zod'
import { withCsrfHeader } from './csrf'

const periodSchema = z.enum(['today', '7d', '30d'])
const captureStateSchema = z.enum(['captured', 'metadata_only', 'expired'])
const redactionStateSchema = z.enum(['passed', 'review_required', 'not_applicable'])
const groupingSchema = z.enum(['conversation', 'independent_call'])
const auditStatusSchema = z.enum(['streaming', 'succeeded', 'failed', 'cancelled', 'body_unavailable'])
const optionSchema = z.object({ id: z.string(), label: z.string() })
const roleSchema = z.enum(['super_admin', 'admin', 'department_lead', 'finance', 'employee'])

export const conversationAuditFiltersSchema = z.object({
  period: periodSchema,
  search: z.string().max(80),
  person: z.string(),
  key: z.string(),
  purpose: z.string(),
  model: z.string(),
  policy: z.string(),
  state: z.union([z.literal('all'), captureStateSchema]),
  redaction: z.union([z.literal('all'), redactionStateSchema]),
  grouping: z.union([z.literal('all'), groupingSchema]),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(5).max(50),
})

const baseRecordSchema = z.object({
  id: z.string(),
  requestId: z.string().regex(/^req-[a-z0-9-]+$/),
  capturedAt: z.string().datetime(),
  person: z.object({ id: z.string(), name: z.string(), department: z.string() }),
  key: z.object({ id: z.string(), masked: z.string() }),
  purpose: optionSchema,
  model: z.object({ id: z.string(), label: z.string() }),
  policy: z.object({ id: z.string(), label: z.string(), scope: z.string(), expiresAt: z.string().datetime() }),
  state: captureStateSchema,
  redaction: z.object({ status: redactionStateSchema, findings: z.number().int().nonnegative(), rawContentAvailable: z.boolean() }),
  grouping: z.object({ type: groupingSchema, reliable: z.boolean(), label: z.string() }),
  metrics: z.object({ turns: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative() }),
  contentAccess: z.object({ available: z.boolean(), requiresReason: z.boolean(), requiredRole: z.literal('super_admin') }),
})

const extendedRecordFields = {
  externalTokenId: z.string().nullable().optional().default(null),
  endpoint: z.string().nullable().optional().default(null),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().nullable().optional().default(null),
  status: auditStatusSchema.nullable().optional().default(null),
  httpStatus: z.number().int().nullable().optional().default(null),
  promptBodyRef: z.string().nullable().optional().default(null),
  responseBodyRef: z.string().nullable().optional().default(null),
  promptBytes: z.number().int().nonnegative().nullable().optional().default(null),
  responseBytes: z.number().int().nonnegative().nullable().optional().default(null),
  retentionUntil: z.string().datetime().optional(),
  exportCount: z.number().int().nonnegative().optional().default(0),
  streamed: z.boolean().optional().default(false),
  chunkCount: z.number().int().nonnegative().optional().default(0),
  terminationReason: z.string().nullable().optional().default(null),
  promptAvailable: z.boolean().optional().default(false),
  responseAvailable: z.boolean().optional().default(false),
  bodyUnavailableReason: z.string().nullable().optional().default(null),
}

// Compatibility defaults keep old metadata-only rows readable. A row claiming
// to contain body data must carry the new encrypted references.
export const conversationRecordSchema = baseRecordSchema.extend(extendedRecordFields).superRefine((value, ctx) => {
  if (value.redaction.rawContentAvailable && !value.promptBodyRef && !value.responseBodyRef) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['redaction', 'rawContentAvailable'], message: '正文可用记录必须带加密正文引用' })
  }
  if (!value.startedAt && (value.promptBodyRef || value.responseBodyRef)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startedAt'], message: '真实采集记录必须带开始时间' })
  }
})

export const conversationAuditResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), period: periodSchema, notice: z.string() }),
  accessControl: z.object({ currentRole: roleSchema, serverRbacVerified: z.literal(true), contentRequiresReason: z.boolean(), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), captured: z.number().int().nonnegative(), metadataOnly: z.number().int().nonnegative(), expiringSoon: z.number().int().nonnegative(), independentCalls: z.number().int().nonnegative(), reviewRequired: z.number().int().nonnegative() }),
  scope: z.object({
    defaultCaptureEnabled: z.boolean(),
    activePolicies: z.number().int().nonnegative(),
    nearestExpiryAt: z.string().datetime(),
    storageEncryptedVerified: z.boolean(),
    accessAuditPersisted: z.boolean(),
    retention: z.object({ mode: z.enum(['metadata_only', 'encrypted_sqlite']), proofRecords: z.number().int().nonnegative(), lastRunAt: z.string().datetime().nullable(), notice: z.string() }),
    notice: z.string(),
  }).superRefine((value, ctx) => {
    if (value.defaultCaptureEnabled && (!value.storageEncryptedVerified || value.retention.mode !== 'encrypted_sqlite')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['retention', 'mode'], message: '真实采集必须使用已验证的加密 SQLite 存储' })
    }
  }),
  options: z.object({ people: z.array(optionSchema), keys: z.array(optionSchema), purposes: z.array(optionSchema), models: z.array(optionSchema), policies: z.array(optionSchema) }),
  items: z.array(conversationRecordSchema),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
})

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  label: z.string(),
  occurredAt: z.string().datetime(),
  text: z.string(),
  redacted: z.boolean(),
  redactionLabels: z.array(z.string()),
  tool: z.object({ name: z.string(), summary: z.string(), argumentsAvailable: z.boolean(), outputAvailable: z.boolean(), arguments: z.unknown().optional(), output: z.unknown().optional() }).nullable(),
})

export const conversationAccessResponseSchema = z.object({
  meta: z.object({ source: z.enum(['demo', 'database']), generatedAt: z.string().datetime(), notice: z.string() }),
  record: conversationRecordSchema,
  access: z.object({ accessRecordId: z.string(), auditEventId: z.string().regex(/^audit-[a-z0-9-]+$/).nullable(), reasonAccepted: z.literal(true), persisted: z.boolean(), authorizedByServerRbac: z.literal(true), copyAllowed: z.boolean(), exportAllowed: z.boolean(), deleteAllowed: z.literal(false) }).superRefine((value, ctx) => {
    if (!value.copyAllowed && value.exportAllowed) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['exportAllowed'], message: '导出不能绕过复制权限' })
  }),
  content: z.object({
    synthetic: z.boolean(),
    decrypted: z.boolean(),
    redactionPassed: z.boolean(),
    conversationTitle: z.string(),
    messages: z.array(messageSchema),
    prompt: z.unknown().optional(),
    response: z.unknown().optional(),
    chunks: z.array(z.unknown()).optional(),
  }).superRefine((value, ctx) => {
    if (value.synthetic && value.decrypted) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['decrypted'], message: '合成内容不能标记为已解密' })
    if (!value.synthetic && !value.decrypted) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['decrypted'], message: '真实正文必须标记为已解密' })
  }),
  retention: z.object({ expiresAt: z.string().datetime(), cleanupState: z.enum(['scheduled', 'expired', 'not_applicable']), deletionProofAvailable: z.boolean(), notice: z.string() }),
  linkedUsage: z.object({ auditRequestId: z.string(), usageRequestId: z.string().nullable(), metadataEndpoint: z.string().nullable(), linkVerified: z.boolean(), source: z.enum(['synthetic_seed', 'gateway_capture', 'unavailable']), notice: z.string() }),
}).superRefine((value, ctx) => {
  if (value.content.synthetic && (value.access.copyAllowed || value.access.exportAllowed)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['access', 'copyAllowed'], message: '合成内容不能开放复制或导出' })
  }
})

export const conversationAccessHistoryResponseSchema = z.object({
  meta: z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), notice: z.string() }),
  record: z.object({ id: z.string(), requestId: z.string().regex(/^req-[a-z0-9-]+$/) }),
  items: z.array(z.object({ id: z.string(), actorName: z.string(), requestId: z.string().regex(/^req-[a-z0-9-]+$/), action: z.enum(['view_synthetic', 'view', 'copy', 'export']), reasonProvided: z.boolean(), reasonLength: z.number().int().min(0).max(200), acknowledgedSensitiveScope: z.boolean(), occurredAt: z.string().datetime() })).max(50),
})

const operationResponseSchema = z.object({ status: z.literal('ok'), operationId: z.string(), auditEventId: z.string(), requestId: z.string() })

export type ConversationAuditFilters = z.infer<typeof conversationAuditFiltersSchema>
export type ConversationAuditRecord = z.infer<typeof conversationRecordSchema>
export type ConversationAuditResponse = z.infer<typeof conversationAuditResponseSchema>
export type ConversationAccessResponse = z.infer<typeof conversationAccessResponseSchema>
export type ConversationAccessHistoryResponse = z.infer<typeof conversationAccessHistoryResponseSchema>

export class ConversationAuditApiError extends Error {
  constructor(message: string, readonly requestId?: string) { super(message) }
}

async function parseResponse<T>(response: Response, schema: z.ZodType<T>, fallback: string, missing = '该记录没有可访问的对话内容') {
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw new ConversationAuditApiError(response.status === 404 ? missing : fallback, requestId)
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success) throw new ConversationAuditApiError('对话审计数据格式不符合接口约定', requestId)
  return parsed.data
}

function queryString(filters: ConversationAuditFilters) {
  const value = conversationAuditFiltersSchema.parse(filters)
  return new URLSearchParams(Object.entries(value).map(([key, item]) => [key, String(item)]))
}

async function parseBlobResponse(response: Response, fallback: string) {
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) throw new ConversationAuditApiError(response.status === 404 ? '该记录没有可导出的正文' : fallback, requestId)
  return response.blob()
}

export async function fetchConversationAudits(filters: ConversationAuditFilters, signal?: AbortSignal) {
  return parseResponse(await fetch(`/api/conversation-audits?${queryString(filters)}`, { headers: { accept: 'application/json' }, signal }), conversationAuditResponseSchema, '对话审计暂时无法加载')
}

export async function fetchConversationAuditsByKey(keyId: string, filters: ConversationAuditFilters, signal?: AbortSignal) {
  return parseResponse(await fetch(`/api/keys/${encodeURIComponent(keyId)}/audits?${queryString({ ...filters, key: keyId })}`, { headers: { accept: 'application/json' }, signal }), conversationAuditResponseSchema, '该 Key 的对话审计暂时无法加载')
}

export async function requestConversationAccess(id: string, signal?: AbortSignal) {
  return parseResponse(await fetch(`/api/conversation-audits/${encodeURIComponent(id)}/access`, { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify({}), signal }), conversationAccessResponseSchema, '无法打开真实对话正文')
}

export async function fetchConversationAccessHistory(id: string, signal?: AbortSignal) {
  return parseResponse(await fetch(`/api/conversation-audits/${encodeURIComponent(id)}/access-events`, { headers: { accept: 'application/json' }, signal }), conversationAccessHistoryResponseSchema, '查看访问记录暂时无法加载', '未找到对话审计记录')
}

export async function copyConversationAudit(id: string, signal?: AbortSignal) {
  return parseResponse(await fetch(`/api/audits/${encodeURIComponent(id)}/copy`, { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify({}), signal }), operationResponseSchema, '复制正文失败')
}

export async function exportConversationAudit(id: string, signal?: AbortSignal) {
  return parseBlobResponse(await fetch(`/api/audits/${encodeURIComponent(id)}/export`, { method: 'POST', headers: withCsrfHeader({ accept: 'application/json', 'content-type': 'application/json' }), body: JSON.stringify({}), signal }), '导出正文失败')
}
