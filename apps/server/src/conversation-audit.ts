import { z } from 'zod'

const periodSchema = z.enum(['today', '7d', '30d'])
const captureStateSchema = z.enum(['captured', 'metadata_only', 'expired'])
const redactionStateSchema = z.enum(['passed', 'review_required', 'not_applicable'])
const groupingSchema = z.enum(['conversation', 'independent_call'])

export const conversationAuditQuerySchema = z.object({
  period: periodSchema.default('7d'),
  search: z.string().trim().max(80).default(''),
  person: z.string().trim().max(40).default('all'),
  key: z.string().trim().max(40).default('all'),
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
  reason: z.string().trim().min(8).max(200),
  acknowledgeSensitiveScope: z.literal(true),
})

const optionSchema = z.object({ id: z.string(), label: z.string() })
const policySchema = z.object({ id: z.string(), label: z.string(), scope: z.string(), expiresAt: z.string().datetime() })
const recordSchema = z.object({
  id: z.string(), requestId: z.string().regex(/^req-[a-z0-9-]+$/), capturedAt: z.string().datetime(),
  person: z.object({ id: z.string(), name: z.string(), department: z.string() }),
  key: z.object({ id: z.string(), masked: z.string() }), purpose: optionSchema,
  model: z.object({ id: z.string(), label: z.string() }), policy: policySchema,
  state: captureStateSchema,
  redaction: z.object({ status: redactionStateSchema, findings: z.number().int().nonnegative(), rawContentAvailable: z.literal(false) }),
  grouping: z.object({ type: groupingSchema, reliable: z.boolean(), label: z.string() }),
  metrics: z.object({ turns: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative() }),
  contentAccess: z.object({ available: z.boolean(), requiresReason: z.literal(true), requiredRole: z.literal('super_admin') }),
})

const metaSchema = z.object({ source: z.literal('demo'), generatedAt: z.string().datetime(), period: periodSchema, notice: z.string() })
export const conversationAuditResponseSchema = z.object({
  meta: metaSchema,
  accessControl: z.object({ currentRole: z.literal('super_admin'), serverRbacVerified: z.literal(false), contentRequiresReason: z.literal(true), notice: z.string() }),
  summary: z.object({ total: z.number().int().nonnegative(), captured: z.number().int().nonnegative(), metadataOnly: z.number().int().nonnegative(), expiringSoon: z.number().int().nonnegative(), independentCalls: z.number().int().nonnegative(), reviewRequired: z.number().int().nonnegative() }),
  scope: z.object({ defaultCaptureEnabled: z.literal(false), activePolicies: z.number().int().nonnegative(), nearestExpiryAt: z.string().datetime(), storageEncryptedVerified: z.literal(false), accessAuditPersisted: z.literal(false), notice: z.string() }),
  options: z.object({ people: z.array(optionSchema), keys: z.array(optionSchema), purposes: z.array(optionSchema), models: z.array(optionSchema), policies: z.array(optionSchema) }),
  items: z.array(recordSchema),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
})

const messageSchema = z.object({
  id: z.string(), role: z.enum(['user', 'assistant', 'tool']), label: z.string(), occurredAt: z.string().datetime(),
  text: z.string(), redacted: z.boolean(), redactionLabels: z.array(z.string()),
  tool: z.object({ name: z.string(), summary: z.string(), argumentsAvailable: z.literal(false), outputAvailable: z.literal(false) }).nullable(),
})

export const conversationAccessResponseSchema = z.object({
  meta: z.object({ source: z.literal('demo'), generatedAt: z.string().datetime(), notice: z.string() }),
  record: recordSchema,
  access: z.object({ accessRecordId: z.string().regex(/^access-demo-[a-z0-9-]+$/), reasonAccepted: z.literal(true), persisted: z.literal(false), authorizedByServerRbac: z.literal(false), copyAllowed: z.literal(false), exportAllowed: z.literal(false), deleteAllowed: z.literal(false) }),
  content: z.object({ synthetic: z.literal(true), decrypted: z.literal(false), redactionPassed: z.boolean(), conversationTitle: z.string(), messages: z.array(messageSchema) }),
  retention: z.object({ expiresAt: z.string().datetime(), cleanupState: z.enum(['scheduled', 'expired', 'not_applicable']), deletionProofAvailable: z.literal(false), notice: z.string() }),
  linkedUsage: z.object({ requestId: z.string(), metadataEndpoint: z.string(), requestIdVerified: z.literal(false) }),
})

export type ConversationAuditQuery = z.infer<typeof conversationAuditQuerySchema>
export type ConversationAuditRecord = z.infer<typeof recordSchema>
export type ConversationAccessBody = z.infer<typeof conversationAccessBodySchema>

const ago = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()
const after = (now: Date, minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString()

interface Seed extends Omit<ConversationAuditRecord, 'capturedAt' | 'policy'> { minutes: number; policy: Omit<ConversationAuditRecord['policy'], 'expiresAt'> & { expiresInMinutes: number } }

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
  return seeds.map(({ minutes, policy, ...item }) => ({ ...item, capturedAt: ago(now, minutes), policy: { id: policy.id, label: policy.label, scope: policy.scope, expiresAt: after(now, policy.expiresInMinutes) } }))
}
function periodMinutes(period: ConversationAuditQuery['period']) { return period === 'today' ? 1_440 : period === '7d' ? 10_080 : 43_200 }

export function createDemoConversationAudits(query: ConversationAuditQuery, now = new Date()) {
  const all = records(now)
  const cutoff = now.getTime() - periodMinutes(query.period) * 60_000
  const needle = query.search.toLocaleLowerCase('zh-CN')
  const filtered = all.filter((item) => {
    const matchesSearch = !needle || [item.id, item.requestId, item.person.name, item.key.masked, item.purpose.label, item.model.label, item.policy.label].some((value) => value.toLocaleLowerCase('zh-CN').includes(needle))
    return new Date(item.capturedAt).getTime() >= cutoff && matchesSearch && (query.person === 'all' || item.person.id === query.person) && (query.key === 'all' || item.key.id === query.key) && (query.purpose === 'all' || item.purpose.id === query.purpose) && (query.model === 'all' || item.model.id === query.model) && (query.policy === 'all' || item.policy.id === query.policy) && (query.state === 'all' || item.state === query.state) && (query.redaction === 'all' || item.redaction.status === query.redaction) && (query.grouping === 'all' || item.grouping.type === query.grouping)
  })
  const start = (query.page - 1) * query.pageSize
  const unique = <T extends { id: string; label: string }>(values: T[]) => [...new Map(values.map((item) => [item.id, item])).values()]
  const expiry = all.filter((item) => item.state === 'captured').map((item) => item.policy.expiresAt).sort()[0] ?? now.toISOString()
  return {
    meta: { source: 'demo' as const, generatedAt: now.toISOString(), period: query.period, notice: '独立审计存储尚未接入；列表为不含真实正文的安全演示数据' },
    accessControl: { currentRole: 'super_admin' as const, serverRbacVerified: false as const, contentRequiresReason: true as const, notice: '前端路由仅允许超级管理员；真实登录会话与服务端 RBAC 仍待接入。' },
    summary: { total: filtered.length, captured: filtered.filter((item) => item.state === 'captured').length, metadataOnly: filtered.filter((item) => item.state === 'metadata_only').length, expiringSoon: filtered.filter((item) => item.state === 'captured' && new Date(item.policy.expiresAt).getTime() - now.getTime() <= 1_440 * 60_000).length, independentCalls: filtered.filter((item) => item.grouping.type === 'independent_call').length, reviewRequired: filtered.filter((item) => item.redaction.status === 'review_required').length },
    scope: { defaultCaptureEnabled: false as const, activePolicies: 3, nearestExpiryAt: expiry, storageEncryptedVerified: false as const, accessAuditPersisted: false as const, notice: '默认关闭采集；演示页面不代表正文加密、访问审计或到期清理已经验收。' },
    options: { people: unique(all.map((item) => ({ id: item.person.id, label: item.person.name }))), keys: unique(all.map((item) => ({ id: item.key.id, label: item.key.masked }))), purposes: unique(all.map((item) => item.purpose)), models: unique(all.map((item) => ({ id: item.model.id, label: item.model.label }))), policies: unique(all.map((item) => ({ id: item.policy.id, label: item.policy.label }))) },
    items: filtered.slice(start, start + query.pageSize), pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / query.pageSize) },
  }
}

export function createDemoConversationAccess(id: string, _body: ConversationAccessBody, now = new Date()) {
  const record = records(now).find((item) => item.id === id)
  if (!record || !record.contentAccess.available) return null
  const baseTime = new Date(record.capturedAt).getTime()
  const at = (seconds: number) => new Date(baseTime + seconds * 1_000).toISOString()
  return {
    meta: { source: 'demo' as const, generatedAt: now.toISOString(), notice: '以下为合成且预先脱敏的演示轮次；未读取、解密或返回任何真实对话正文。' }, record,
    access: { accessRecordId: `access-demo-${id.replace('conv-audit-', '')}`, reasonAccepted: true as const, persisted: false as const, authorizedByServerRbac: false as const, copyAllowed: false as const, exportAllowed: false as const, deleteAllowed: false as const },
    content: { synthetic: true as const, decrypted: false as const, redactionPassed: record.redaction.status === 'passed', conversationTitle: record.grouping.type === 'independent_call' ? '独立调用 · 演示内容' : `${record.purpose.label} · 演示会话`, messages: [
      { id: 'msg-user-1', role: 'user' as const, label: '用户输入', occurredAt: at(0), text: '请根据订单 [ORDER_ID] 的公开商品信息，整理一版不超过 120 字的回复。客户联系方式已替换为 [PHONE_REDACTED]。', redacted: true, redactionLabels: ['订单编号', '手机号'], tool: null },
      { id: 'msg-tool-1', role: 'tool' as const, label: '工具调用摘要', occurredAt: at(2), text: '读取公开商品目录，返回 3 条匹配记录。参数和原始输出未保留。', redacted: false, redactionLabels: [], tool: { name: 'catalog_search', summary: '按脱敏商品编号查询公开目录', argumentsAvailable: false as const, outputAvailable: false as const } },
      { id: 'msg-assistant-1', role: 'assistant' as const, label: '模型回答', occurredAt: at(5), text: '您好，已为您核对该商品信息。当前订单状态正常，预计将在承诺时段内完成处理；如状态变化，我们会通过原渠道通知您。', redacted: false, redactionLabels: [], tool: null },
    ] },
    retention: { expiresAt: record.policy.expiresAt, cleanupState: 'scheduled' as const, deletionProofAvailable: false as const, notice: '到期清理与无正文删除证明尚未接入；本页面不提供删除操作。' },
    linkedUsage: { requestId: record.requestId, metadataEndpoint: `/api/usage/${record.requestId}`, requestIdVerified: false as const },
  }
}
