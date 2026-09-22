import { GatewayUpstreamError, type GatewayUpstream, type OpenAiModel } from './gateway/openai-compatible.js'
import type { GatewayConfig } from './gateway-config.js'
import { channelsResponseSchema, modelsResponseSchema, type ChannelItem, type ChannelsQuery, type ModelItem, type ModelsQuery } from './models.js'

/**
 * A small read-only catalog adapter for the CPA data plane.
 *
 * CPA is the owner of OAuth accounts and model routing. AI OPS only reads the
 * OpenAI-compatible /v1/models response and overlays its own business aliases;
 * no CPA credential or account file crosses this boundary.
 */
export class CpaCatalogError extends Error {
  constructor(readonly code: 'CPA_NOT_ACTIVE' | 'CPA_NOT_CONFIGURED' | 'CPA_AUTH_REQUIRED' | 'CPA_UNAVAILABLE' | 'CPA_INVALID_DATA') {
    super({
      CPA_NOT_ACTIVE: '当前网关连接器不是 CPA，请将 AI_OPS_GATEWAY_MODE 设置为 cpa。',
      CPA_NOT_CONFIGURED: 'CPA 网关尚未配置，请填写 CPA Base URL 和客户端 Key。',
      CPA_AUTH_REQUIRED: 'CPA 客户端 Key 无法读取模型目录，请检查 CPA 授权和客户端 Key。',
      CPA_UNAVAILABLE: 'CPA 网关暂时不可用，请确认 CPA 已启动并完成 Codex OAuth 登录。',
      CPA_INVALID_DATA: 'CPA 返回的模型目录格式无效，未展示不完整数据。',
    }[code])
  }
}

const channelId = 'channel-cpa-gateway'
const modelId = (value: string) => `cpa-model-${encodeURIComponent(value)}`

const aliasLabels: Record<string, string> = {
  'ecommerce-general': '通用运营',
  'ecommerce-copy': '商品文案',
  'ecommerce-service': '客服回复',
  'ecommerce-translate': '多语翻译',
  'ecommerce-analysis': '策略分析',
  'ecommerce-image-check': '图片检查',
}

function capabilityFor(model: string): ModelItem['capabilities'] {
  const normalized = model.toLocaleLowerCase('en-US')
  const capabilities: ModelItem['capabilities'] = ['text']
  if (/(codex|reason|thinking|\bo[1-9])/.test(normalized)) capabilities.push('reasoning')
  if (/(vision|image)/.test(normalized)) capabilities.push('vision')
  if (/translat/.test(normalized)) capabilities.push('translation')
  return capabilities
}

function mapModels(raw: OpenAiModel[], config: GatewayConfig, now: Date, latencyMs: number) {
  const seen = new Set<string>()
  if (raw.length > 2_000) throw new CpaCatalogError('CPA_INVALID_DATA')
  for (const item of raw) {
    if (item.id.length > 256 || seen.has(item.id)) throw new CpaCatalogError('CPA_INVALID_DATA')
    seen.add(item.id)
  }

  const aliasesByTarget = new Map<string, string[]>()
  for (const [alias, target] of Object.entries(config.modelAliases)) {
    const aliases = aliasesByTarget.get(target) ?? []
    aliases.push(alias)
    aliasesByTarget.set(target, aliases)
  }

  const models: ModelItem[] = raw.map((item) => {
    const aliases = aliasesByTarget.get(item.id) ?? []
    return {
      id: modelId(item.id),
      displayName: item.id,
      provider: 'CLIProxyAPI · CPA',
      actualModel: item.id,
      aliases,
      capabilities: capabilityFor(item.id),
      contextWindow: null,
      region: 'CPA OAuth',
      environment: 'production',
      status: 'available',
      pricing: null,
      purposes: aliases.map((alias) => ({ name: aliasLabels[alias] ?? alias, alias, role: 'primary' as const })),
      channelIds: [channelId],
    }
  })

  const channel: ChannelItem = {
    id: channelId,
    name: 'CPA Codex OAuth',
    provider: 'CLIProxyAPI',
    type: 'cpa_oauth',
    environment: 'production',
    status: models.length ? 'healthy' : 'unverified',
    modelIds: models.map((item) => item.id),
    latencyMs,
    successRate: null,
    balanceState: 'unknown',
    rateLimits: { rpm: null, tpm: null },
    recentError: null,
    checkedAt: now.toISOString(),
    credentialConfigured: config.upstreamConfigured,
  }
  return { models, channels: [channel], generatedAt: now.toISOString() }
}

function filterModels(items: ModelItem[], query: ModelsQuery) {
  const search = query.search.toLocaleLowerCase('zh-CN')
  return items.filter((item) => {
    const matchesSearch = !search || [item.displayName, item.provider, item.actualModel, ...item.aliases, ...item.purposes.map((purpose) => purpose.name)].some((value) => value.toLocaleLowerCase('zh-CN').includes(search))
    return matchesSearch && (query.capability === 'all' || item.capabilities.includes(query.capability)) && (query.environment === 'all' || item.environment === query.environment) && (query.status === 'all' || item.status === query.status)
  })
}

export function createCpaCatalog(upstream: GatewayUpstream, config: GatewayConfig, now: () => Date = () => new Date()) {
  let cached: { snapshot: ReturnType<typeof mapModels>; expires: number } | undefined
  let pending: Promise<ReturnType<typeof mapModels>> | undefined

  async function load() {
    if (config.mode !== 'cpa') throw new CpaCatalogError('CPA_NOT_ACTIVE')
    if (!config.upstreamConfigured) throw new CpaCatalogError('CPA_NOT_CONFIGURED')
    if (cached && cached.expires > now().getTime()) return cached.snapshot
    if (!pending) {
      pending = (async () => {
        const startedAt = Date.now()
        try {
          const raw = await upstream.listModels()
          return mapModels(raw, config, now(), Date.now() - startedAt)
        } catch (error) {
          if (error instanceof CpaCatalogError) throw error
          if (error instanceof GatewayUpstreamError) {
            if (error.code === 'GATEWAY_UPSTREAM_AUTH_FAILED') throw new CpaCatalogError('CPA_AUTH_REQUIRED')
            if (error.code === 'GATEWAY_UPSTREAM_INVALID_RESPONSE') throw new CpaCatalogError('CPA_INVALID_DATA')
          }
          throw new CpaCatalogError('CPA_UNAVAILABLE')
        }
      })().then((snapshot) => {
        cached = { snapshot, expires: now().getTime() + 30_000 }
        return snapshot
      }).catch((error: unknown) => {
        cached = undefined
        throw error instanceof CpaCatalogError ? error : new CpaCatalogError('CPA_UNAVAILABLE')
      }).finally(() => { pending = undefined })
    }
    return pending
  }

  return {
    async models(query: ModelsQuery) {
      const snapshot = await load()
      const items = filterModels(snapshot.models, query)
      return modelsResponseSchema.parse({
        meta: { source: 'cpa' as const, generatedAt: snapshot.generatedAt, notice: 'CPA Codex OAuth /v1/models 实时目录；能力、上下文和价格以 CPA 未提供为准。' },
        summary: { total: snapshot.models.length, available: snapshot.models.filter((item) => item.status === 'available').length, degraded: 0, production: snapshot.models.length, experiment: 0 },
        options: { capabilities: [{ id: 'text', label: '文本' }, { id: 'reasoning', label: '推理' }, { id: 'translation', label: '翻译' }, { id: 'vision', label: '视觉' }, { id: 'batch', label: '批处理' }] },
        items,
        total: items.length,
      })
    },
    async channels(query: ChannelsQuery) {
      const snapshot = await load()
      const items = snapshot.channels.filter((item) => (query.environment === 'all' || item.environment === query.environment) && (query.status === 'all' || item.status === query.status))
      return channelsResponseSchema.parse({
        meta: { source: 'cpa' as const, generatedAt: snapshot.generatedAt, notice: 'CPA Codex OAuth 实时渠道摘要；不会返回 OAuth Token、账号文件或上游响应。', healthCacheSeconds: 30 },
        summary: { total: snapshot.channels.length, healthy: snapshot.channels.filter((item) => item.status === 'healthy').length, degraded: 0, offline: snapshot.channels.filter((item) => item.status === 'offline').length },
        items,
        total: items.length,
      })
    },
  }
}
