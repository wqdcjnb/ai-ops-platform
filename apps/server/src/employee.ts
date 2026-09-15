import { z } from 'zod'

export const employeeUsageQuerySchema = z.object({ period: z.enum(['7d', '30d']).default('7d') })

const employeeMetaSchema = z.object({ source: z.literal('demo'), generatedAt: z.string().datetime(), notice: z.string() })
const selfScopeSchema = z.object({ mode: z.literal('self_demo'), currentUserVerified: z.literal(false), serverRbacVerified: z.literal(false), otherPeopleAvailable: z.literal(false), notice: z.string() })

export const employeeProfileResponseSchema = z.object({
  meta: employeeMetaSchema, scope: selfScopeSchema,
  person: z.object({ id: z.literal('person-lin'), name: z.string(), initials: z.string(), employeeCode: z.string(), department: z.string(), role: z.literal('employee'), status: z.literal('active'), manager: z.string(), joinedAt: z.string().date() }),
  support: z.object({ contact: z.string(), serviceHours: z.string(), temporaryQuotaRequestAvailable: z.literal(false), notice: z.string() }),
  commonErrors: z.array(z.object({ code: z.enum(['AUTH_INVALID', 'MODEL_NOT_ALLOWED', 'SOFT_TARGET_REACHED', 'UPSTREAM_UNAVAILABLE']), title: z.string(), explanation: z.string(), action: z.string(), internalDetailAvailable: z.literal(false) })),
})

const employeeKeySchema = z.object({ id: z.string(), masked: z.string(), purpose: z.string(), alias: z.string(), allowedModels: z.array(z.string()), status: z.enum(['active', 'expiring']), createdAt: z.string().datetime(), expiresAt: z.string().datetime(), lastUsedAt: z.string().datetime().nullable(), secretAvailable: z.literal(false), rotateAvailable: z.literal(false) })
export const employeeKeysResponseSchema = z.object({
  meta: employeeMetaSchema, scope: selfScopeSchema, items: z.array(employeeKeySchema),
  connection: z.object({ baseUrl: z.string().url(), credentialDelivery: z.string(), upstreamDetailsAvailable: z.literal(false), guides: z.array(z.object({ id: z.enum(['codex', 'workbuddy']), name: z.string(), description: z.string(), steps: z.array(z.string()) })) }),
})

export const employeeUsageResponseSchema = z.object({
  meta: employeeMetaSchema.extend({ period: z.enum(['7d', '30d']) }), scope: selfScopeSchema,
  summary: z.object({ pointsUsed: z.number().int().nonnegative(), pointsTarget: z.number().int().positive(), pointsRemaining: z.number().int().nonnegative(), usagePercent: z.number().min(0), requests: z.number().int().nonnegative(), tokens: z.number().int().nonnegative(), successRate: z.number().min(0).max(100), softTarget: z.literal(true), requestBlockingEnabled: z.literal(false) }),
  trend: z.array(z.object({ date: z.string().date(), points: z.number().int().nonnegative(), requests: z.number().int().nonnegative() })),
  purposes: z.array(z.object({ id: z.string(), name: z.string(), points: z.number().int().nonnegative(), percent: z.number().min(0).max(100) })),
})

export const employeeModelsResponseSchema = z.object({
  meta: employeeMetaSchema, scope: selfScopeSchema,
  items: z.array(z.object({ id: z.string(), alias: z.string(), name: z.string(), purpose: z.string(), description: z.string(), capabilityTags: z.array(z.string()), contextLabel: z.string(), status: z.enum(['available', 'limited']), useAdvice: z.string(), providerAvailable: z.literal(false), actualModelAvailable: z.literal(false), channelAvailable: z.literal(false) })),
})

const selfScope = { mode: 'self_demo' as const, currentUserVerified: false as const, serverRbacVerified: false as const, otherPeopleAvailable: false as const, notice: '当前为固定演示身份；真实登录会话和服务端“仅本人”数据范围尚未接入。' }
const meta = (now: Date, notice: string) => ({ source: 'demo' as const, generatedAt: now.toISOString(), notice })

export function createDemoEmployeeProfile(now = new Date()) {
  return {
    meta: meta(now, '员工档案与帮助内容为演示数据，不代表真实账号已登录。'), scope: selfScope,
    person: { id: 'person-lin' as const, name: '林梓雨', initials: '林', employeeCode: 'OPS-017', department: '内容运营', role: 'employee' as const, status: 'active' as const, manager: '内容运营负责人', joinedAt: '2025-03-17' },
    support: { contact: '联系部门负责人或平台管理员', serviceHours: '工作日 09:30–18:30', temporaryQuotaRequestAvailable: false as const, notice: '临时额度申请为二期功能；当前达到软目标后仍允许调用。' },
    commonErrors: [
      { code: 'AUTH_INVALID' as const, title: '鉴权失败', explanation: '个人 Key 无效、已过期或客户端未正确读取。', action: '核对 Base URL 与 Key 配置；不要在聊天或截图中发送完整 Key。', internalDetailAvailable: false as const },
      { code: 'MODEL_NOT_ALLOWED' as const, title: '模型无权限', explanation: '当前 Key 未授权请求的业务模型别名。', action: '从“可用模型”选择别名，或联系负责人确认业务用途。', internalDetailAvailable: false as const },
      { code: 'SOFT_TARGET_REACHED' as const, title: '达到软目标', explanation: '本月点数已达到个人软目标，但一期不会自动阻断请求。', action: '优先使用匹配用途的模型；确需增加目标时联系部门负责人。', internalDetailAvailable: false as const },
      { code: 'UPSTREAM_UNAVAILABLE' as const, title: '上游暂时不可用', explanation: '平台已隐藏内部渠道与原始错误，只返回稳定错误码。', action: '稍后重试；持续失败时提供请求 ID 给管理员排查。', internalDetailAvailable: false as const },
    ],
  }
}

export function createDemoEmployeeKeys(now = new Date()) {
  const before = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()
  const after = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString()
  return {
    meta: meta(now, '仅返回当前演示员工的 Key 掩码与授权摘要；完整 Key 不可再次查看。'), scope: selfScope,
    items: [
      { id: 'key-lin-1', masked: 'sk-ops••••••7F2A', purpose: '商品文案', alias: 'ecommerce-copy', allowedModels: ['商品文案模型', '通用文本模型'], status: 'active' as const, createdAt: before(73), expiresAt: after(107), lastUsedAt: before(0.08), secretAvailable: false as const, rotateAvailable: false as const },
      { id: 'key-lin-3', masked: 'sk-ops••••••D410', purpose: '资料整理', alias: 'research-summary', allowedModels: ['资料整理模型'], status: 'expiring' as const, createdAt: before(164), expiresAt: after(16), lastUsedAt: before(1.2), secretAvailable: false as const, rotateAvailable: false as const },
    ],
    connection: { baseUrl: 'http://127.0.0.1:3000/v1', credentialDelivery: '完整个人 Key 仅在创建时通过受控渠道交付；页面不支持再次显示或复制。', upstreamDetailsAvailable: false as const, guides: [
      { id: 'codex' as const, name: 'Codex Desktop', description: '使用 OpenAI 兼容接口连接个人授权模型。', steps: ['在客户端打开模型提供商设置', '将 Base URL 设置为平台统一地址', '粘贴受控渠道收到的个人 Key', '模型填写“可用模型”中的业务别名'] },
      { id: 'workbuddy' as const, name: 'WorkBuddy', description: '按用途配置个人 Key 与业务模型别名。', steps: ['新建 OpenAI 兼容连接', '填写平台统一 Base URL', '粘贴个人 Key 并保存', '发送测试消息并记录失败请求 ID'] },
    ] },
  }
}

function dateKey(now: Date, offset: number) { const value = new Date(now); value.setUTCDate(value.getUTCDate() - offset); return value.toISOString().slice(0, 10) }
export function createDemoEmployeeUsage(period: '7d' | '30d', now = new Date()) {
  const days = period === '7d' ? 7 : 30
  const trend = Array.from({ length: days }, (_, index) => { const distance = days - index - 1; return { date: dateKey(now, distance), points: 82 + ((index * 37 + 41) % 155), requests: 9 + ((index * 11 + 5) % 24) } })
  const factor = period === '7d' ? 1 : 3.7
  const pointsUsed = 4_280
  return {
    meta: { ...meta(now, '用量为本人范围的演示数据；点数口径尚未与真实网关账本核对。'), period }, scope: selfScope,
    summary: { pointsUsed, pointsTarget: 8_000, pointsRemaining: 3_720, usagePercent: 53.5, requests: Math.round(184 * factor), tokens: Math.round(386_420 * factor), successRate: 98.7, softTarget: true as const, requestBlockingEnabled: false as const },
    trend, purposes: [{ id: 'copy', name: '商品文案', points: 2_825, percent: 66 }, { id: 'research', name: '资料整理', points: 1_027, percent: 24 }, { id: 'general', name: '通用问答', points: 428, percent: 10 }],
  }
}

export function createDemoEmployeeModels(now = new Date()) {
  return {
    meta: meta(now, '只展示员工可使用的业务别名与建议；供应商、实际模型和上游渠道均隐藏。'), scope: selfScope,
    items: [
      { id: 'employee-model-copy', alias: 'ecommerce-copy', name: '商品文案模型', purpose: '商品标题、卖点和详情页草稿', description: '适合中文电商文案与结构化改写。', capabilityTags: ['中文文案', '结构化输出', '图片理解'], contextLabel: '长文本', status: 'available' as const, useAdvice: '优先提供商品事实与目标平台，避免上传客户隐私。', providerAvailable: false as const, actualModelAvailable: false as const, channelAvailable: false as const },
      { id: 'employee-model-research', alias: 'research-summary', name: '资料整理模型', purpose: '资料归纳、表格提取和会议总结', description: '适合多文档归纳与要点提取。', capabilityTags: ['长文总结', '表格提取', '引用整理'], contextLabel: '超长文本', status: 'available' as const, useAdvice: '上传前移除账号、密钥和不必要的个人信息。', providerAvailable: false as const, actualModelAvailable: false as const, channelAvailable: false as const },
      { id: 'employee-model-general', alias: 'general-text', name: '通用文本模型', purpose: '内部草稿、翻译和日常问答', description: '适合低风险的通用文本任务。', capabilityTags: ['翻译', '改写', '问答'], contextLabel: '标准文本', status: 'limited' as const, useAdvice: '不用于法律、财务或对外承诺的最终结论。', providerAvailable: false as const, actualModelAvailable: false as const, channelAvailable: false as const },
    ],
  }
}
