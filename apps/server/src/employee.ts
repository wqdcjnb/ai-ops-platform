import { z } from 'zod'
import type { PlatformDatabase } from './platform-db.js'

export const employeeUsageQuerySchema = z.object({ period: z.enum(['7d', '30d']).default('7d') })

const databaseMetaSchema = z.object({ source: z.literal('database'), generatedAt: z.string().datetime(), notice: z.string() })
const demoMetaSchema = z.object({ source: z.literal('demo'), generatedAt: z.string().datetime(), notice: z.string() })
const selfScopeSchema = z.object({ mode: z.literal('self_database'), currentUserVerified: z.literal(true), serverRbacVerified: z.literal(true), otherPeopleAvailable: z.literal(false), notice: z.string() })

export const employeeProfileResponseSchema = z.object({
  meta: databaseMetaSchema, scope: selfScopeSchema,
  person: z.object({ id: z.string(), name: z.string(), initials: z.string(), employeeCode: z.string(), department: z.string(), role: z.literal('employee'), status: z.literal('active'), manager: z.string(), joinedAt: z.string().date() }),
  support: z.object({ contact: z.string(), serviceHours: z.string(), temporaryQuotaRequestAvailable: z.literal(true), notice: z.string() }),
  commonErrors: z.array(z.object({ code: z.enum(['AUTH_INVALID', 'MODEL_NOT_ALLOWED', 'SOFT_TARGET_REACHED', 'UPSTREAM_UNAVAILABLE']), title: z.string(), explanation: z.string(), action: z.string(), internalDetailAvailable: z.literal(false) })),
})

const employeeKeySchema = z.object({ id: z.string(), masked: z.string(), purpose: z.string(), alias: z.string(), allowedModels: z.array(z.string()), status: z.enum(['active', 'expiring']), createdAt: z.string().datetime(), expiresAt: z.string().datetime(), lastUsedAt: z.string().datetime().nullable(), secretAvailable: z.literal(false), rotateAvailable: z.literal(false) })
export const employeeKeysResponseSchema = z.object({
  meta: databaseMetaSchema, scope: selfScopeSchema, items: z.array(employeeKeySchema),
  connection: z.object({ baseUrl: z.string().url(), credentialDelivery: z.string(), upstreamDetailsAvailable: z.literal(false), guides: z.array(z.object({ id: z.enum(['codex', 'workbuddy']), name: z.string(), description: z.string(), steps: z.array(z.string()) })) }),
})

export const employeeUsageResponseSchema = z.object({
  meta: databaseMetaSchema.extend({ period: z.enum(['7d', '30d']) }), scope: selfScopeSchema,
  summary: z.object({ pointsUsed: z.number().int().nonnegative(), pointsTarget: z.number().int().positive(), pointsRemaining: z.number().int().nonnegative(), usagePercent: z.number().min(0), requests: z.number().int().nonnegative(), tokens: z.number().int().nonnegative(), successRate: z.number().min(0).max(100), softTarget: z.literal(true), requestBlockingEnabled: z.literal(false) }),
  trend: z.array(z.object({ date: z.string().date(), points: z.number().int().nonnegative(), requests: z.number().int().nonnegative() })),
  purposes: z.array(z.object({ id: z.string(), name: z.string(), points: z.number().int().nonnegative(), percent: z.number().min(0).max(100) })),
})

export const employeeModelsResponseSchema = z.object({
  meta: demoMetaSchema, scope: selfScopeSchema,
  items: z.array(z.object({ id: z.string(), alias: z.string(), name: z.string(), purpose: z.string(), description: z.string(), capabilityTags: z.array(z.string()), contextLabel: z.string(), status: z.enum(['available', 'limited']), useAdvice: z.string(), providerAvailable: z.literal(false), actualModelAvailable: z.literal(false), channelAvailable: z.literal(false) })),
})

const selfScope = {
  mode: 'self_database' as const,
  currentUserVerified: true as const,
  serverRbacVerified: true as const,
  otherPeopleAvailable: false as const,
  notice: '当前会话已通过服务端认证与员工角色校验；资料、Key 掩码和调用元数据只从 SQLite 读取当前登录员工的数据。',
}

const databaseMeta = (now: Date, notice: string) => ({ source: 'database' as const, generatedAt: now.toISOString(), notice })
const demoMeta = (now: Date, notice: string) => ({ source: 'demo' as const, generatedAt: now.toISOString(), notice })

const support = {
  contact: '联系部门负责人或平台管理员',
  serviceHours: '工作日 09:30–18:30',
  temporaryQuotaRequestAvailable: true as const,
  notice: '可提交临时额度申请；审批、到期和审计均只写入本地 SQLite，不会阻断请求。',
}

const commonErrors = [
  { code: 'AUTH_INVALID' as const, title: '鉴权失败', explanation: '个人 Key 无效、已过期或客户端未正确读取。', action: '核对 Base URL 与 Key 配置；不要在聊天或截图中发送完整 Key。', internalDetailAvailable: false as const },
  { code: 'MODEL_NOT_ALLOWED' as const, title: '模型无权限', explanation: '当前 Key 未授权请求的业务模型别名。', action: '从“可用模型”选择别名，或联系负责人确认业务用途。', internalDetailAvailable: false as const },
  { code: 'SOFT_TARGET_REACHED' as const, title: '达到软目标', explanation: '本月点数已达到个人软目标，但一期不会自动阻断请求。', action: '优先使用匹配用途的模型；确需增加目标时联系部门负责人。', internalDetailAvailable: false as const },
  { code: 'UPSTREAM_UNAVAILABLE' as const, title: '上游暂时不可用', explanation: '平台已隐藏内部渠道与原始错误，只返回稳定错误码。', action: '稍后重试；持续失败时提供请求 ID 给管理员排查。', internalDetailAvailable: false as const },
]

const connection = {
  // Employee clients must use the AI OPS gateway so conversation capture is
  // on the request path; the gateway forwards to New API internally.
  baseUrl: process.env.AI_OPS_PUBLIC_GATEWAY_BASE_URL?.trim() || 'http://127.0.0.1:4175/v1',
  credentialDelivery: '完整个人 Key 仅在创建时通过受控渠道交付；页面不支持再次显示或复制。',
  upstreamDetailsAvailable: false as const,
  guides: [
    { id: 'codex' as const, name: 'Codex Desktop', description: '使用 OpenAI 兼容接口连接个人授权模型。', steps: ['在客户端打开模型提供商设置', '将 Base URL 设置为 AI OPS 网关统一地址', '粘贴受控渠道收到的个人 Key', '模型填写“可用模型”中的业务别名'] },
    { id: 'workbuddy' as const, name: 'WorkBuddy', description: '按用途配置个人 Key 与业务模型别名。', steps: ['新建 OpenAI 兼容连接', '填写 AI OPS 网关统一 Base URL', '粘贴个人 Key 并保存', '发送测试消息并记录失败请求 ID'] },
  ],
}

function initials(name: string) { return name.trim().slice(0, 1) || '我' }
function dateKey(now: Date, offset: number) { const value = new Date(now); value.setUTCDate(value.getUTCDate() - offset); return value.toISOString().slice(0, 10) }
function dateStart(value: Date) { return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`).getTime() }
function roundPoints(value: number) { return Math.max(0, Math.round(value)) }

export function createDatabaseEmployeeProfile(database: PlatformDatabase, userId: string, now = new Date()) {
  const person = database.getEmployeeProfile(userId)
  if (!person) throw new Error('Authenticated employee profile is unavailable')
  return {
    meta: databaseMeta(now, '员工档案来自当前登录员工的 SQLite 记录；请求已通过登录会话和服务端员工 RBAC 校验。'),
    scope: selfScope,
    person: { id: person.id, name: person.displayName, initials: initials(person.displayName), employeeCode: person.employeeCode, department: person.departmentName, role: 'employee' as const, status: 'active' as const, manager: person.managerName, joinedAt: person.joinedAt },
    support,
    commonErrors,
  }
}

export function createDatabaseEmployeeKeys(database: PlatformDatabase, userId: string, now = new Date()) {
  return {
    meta: databaseMeta(now, '仅从 SQLite 返回当前登录员工的 Key 掩码与授权摘要；完整 Key、其他人员数据和上游配置不会返回。'),
    scope: selfScope,
    items: database.listApiKeysForOwner(userId).filter((item): item is typeof item & { status: 'active' | 'expiring' } => item.status !== 'revoked').map((item) => ({
      id: item.id,
      masked: item.maskedValue,
      purpose: item.purpose,
      alias: item.model,
      allowedModels: [item.model],
      status: item.status,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt ?? item.createdAt,
      lastUsedAt: item.lastUsedAt,
      secretAvailable: false as const,
      rotateAvailable: false as const,
    })),
    connection,
  }
}

export function createDatabaseEmployeeUsage(database: PlatformDatabase, userId: string, period: '7d' | '30d', now = new Date()) {
  const records = database.listUsageRequests(userId)
  const days = period === '7d' ? 7 : 30
  const periodStart = dateStart(new Date(now.getTime() - (days - 1) * 86_400_000))
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const periodRecords = records.filter((item) => new Date(item.occurredAt).getTime() >= periodStart)
  const monthRecords = records.filter((item) => new Date(item.occurredAt).getTime() >= monthStart)
  const trendMap = new Map<string, { points: number; requests: number }>()
  for (const item of periodRecords) {
    const key = item.occurredAt.slice(0, 10)
    const current = trendMap.get(key) ?? { points: 0, requests: 0 }
    current.points += item.points
    current.requests += 1
    trendMap.set(key, current)
  }
  const trend = Array.from({ length: days }, (_, index) => {
    const date = dateKey(now, days - index - 1)
    const item = trendMap.get(date) ?? { points: 0, requests: 0 }
    return { date, points: roundPoints(item.points), requests: item.requests }
  })
  const monthlyPoints = monthRecords.reduce((total, item) => total + item.points, 0)
  const baseTarget = database.listQuotaPolicies().find((item) => item.level === 'person' && item.subjectId === userId && item.period === 'month')?.targetPoints ?? 1
  const temporaryTarget = database.listActiveTemporaryQuotaGrants(now).filter((item) => item.requesterUserId === userId).reduce((total, item) => total + (item.approvedPoints ?? 0), 0)
  const target = baseTarget + temporaryTarget
  const usagePercent = Math.round((monthlyPoints / target) * 1_000) / 10
  const tokens = periodRecords.reduce((total, item) => total + item.inputTokens + item.outputTokens, 0)
  const succeeded = periodRecords.filter((item) => item.status === 'succeeded').length
  const purposeMap = new Map<string, { name: string; points: number }>()
  for (const item of periodRecords) {
    const current = purposeMap.get(item.purposeId) ?? { name: item.purposeName, points: 0 }
    current.points += item.points
    purposeMap.set(item.purposeId, current)
  }
  const periodPoints = periodRecords.reduce((total, item) => total + item.points, 0)
  const purposes = [...purposeMap.entries()].map(([id, item]) => ({ id, name: item.name, points: roundPoints(item.points), percent: periodPoints ? Math.round((item.points / periodPoints) * 100) : 0 }))
  return {
    meta: { ...databaseMeta(now, '用量来自 SQLite 中当前登录员工的可重复模拟调用元数据，不是已与真实网关账本核对的计费数据。'), period },
    scope: selfScope,
    summary: {
      pointsUsed: roundPoints(monthlyPoints),
      pointsTarget: Math.max(1, target),
      pointsRemaining: Math.max(0, target - roundPoints(monthlyPoints)),
      usagePercent,
      requests: periodRecords.length,
      tokens,
      successRate: periodRecords.length ? Math.round((succeeded / periodRecords.length) * 1_000) / 10 : 100,
      softTarget: true as const,
      requestBlockingEnabled: false as const,
    },
    trend,
    purposes,
  }
}

export function createDemoEmployeeModels(now = new Date()) {
  return {
    meta: demoMeta(now, '模型目录仍为演示数据，只展示员工可使用的业务别名与建议；供应商、实际模型和上游渠道均隐藏。'),
    scope: selfScope,
    items: [
      { id: 'employee-model-copy', alias: 'ecommerce-copy', name: '商品文案模型', purpose: '商品标题、卖点和详情页草稿', description: '适合中文电商文案与结构化改写。', capabilityTags: ['中文文案', '结构化输出', '图片理解'], contextLabel: '长文本', status: 'available' as const, useAdvice: '优先提供商品事实与目标平台，避免上传客户隐私。', providerAvailable: false as const, actualModelAvailable: false as const, channelAvailable: false as const },
      { id: 'employee-model-research', alias: 'research-summary', name: '资料整理模型', purpose: '资料归纳、表格提取和会议总结', description: '适合多文档归纳与要点提取。', capabilityTags: ['长文总结', '表格提取', '引用整理'], contextLabel: '超长文本', status: 'available' as const, useAdvice: '上传前移除账号、密钥和不必要的个人信息。', providerAvailable: false as const, actualModelAvailable: false as const, channelAvailable: false as const },
      { id: 'employee-model-general', alias: 'general-text', name: '通用文本模型', purpose: '内部草稿、翻译和日常问答', description: '适合低风险的通用文本任务。', capabilityTags: ['翻译', '改写', '问答'], contextLabel: '标准文本', status: 'limited' as const, useAdvice: '不用于法律、财务或对外承诺的最终结论。', providerAvailable: false as const, actualModelAvailable: false as const, channelAvailable: false as const },
    ],
  }
}
