import { z } from 'zod'
import type { NewApiChannel, NewApiChannelWriteInput, NewApiManagementClient, NewApiManagementResult } from './new-api-management.js'

export const CPA_CHANNEL_MARKER = 'ai-ops:cpa:codex'
export const CPA_CHANNEL_NAME = 'AI OPS · CPA Codex'
const CPA_CHANNEL_TYPE = 1

export type CpaChannelSourceState = 'ready' | 'auth_required' | 'unavailable' | 'invalid_response' | 'not_configured'
export type NewApiChannelSyncAction = 'create' | 'update' | 'enable' | 'blocked' | 'unchanged'

export interface CpaChannelSourceSnapshot {
  state: CpaChannelSourceState
  baseUrl: string
  modelIds: string[]
  credentialConfigured: boolean
  checkedAt: string
}

export interface ManagedChannelMapping {
  marker: string
  externalChannelId: string
  modelSnapshot: string[]
  updatedAt: string
  lastRequestId: string | null
}

export interface NewApiChannelSyncTarget {
  marker: string
  externalChannelId: string | null
  action: NewApiChannelSyncAction
}

export interface NewApiChannelSyncPreview {
  cpa: CpaChannelSourceSnapshot
  target: NewApiChannelSyncTarget
  changes: string[]
  canApply: boolean
  requestId: string
}

export interface ChannelSyncMappingStore {
  getManagedChannelMapping(marker: string): ManagedChannelMapping | undefined
}

export class NewApiChannelSyncError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: 409 | 502 | 503 = 502) {
    super(message)
    this.name = 'NewApiChannelSyncError'
  }
}

const channelSyncStateSchema = z.enum(['ready', 'auth_required', 'unavailable', 'invalid_response', 'not_configured'])
const channelSyncActionSchema = z.enum(['create', 'update', 'enable', 'blocked', 'unchanged'])
export const channelSyncPreviewSchema = z.object({
  cpa: z.object({
    state: channelSyncStateSchema,
    baseUrl: z.string(),
    modelIds: z.array(z.string()),
    credentialConfigured: z.boolean(),
    checkedAt: z.string().datetime(),
  }),
  target: z.object({ marker: z.literal(CPA_CHANNEL_MARKER), externalChannelId: z.string().nullable(), action: channelSyncActionSchema }),
  changes: z.array(z.string()),
  canApply: z.boolean(),
  requestId: z.string(),
})

export function normalizeChannelBaseUrl(value: string) {
  try {
    return new URL(value.trim()).toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

// New API's OpenAI-compatible channel appends `/v1` when it builds the
// upstream endpoint. Store the service root in the channel even when CPA's
// client/catalog URL already includes that path.
export function normalizeNewApiChannelBaseUrl(value: string) {
  return normalizeChannelBaseUrl(value).replace(/\/v1$/i, '')
}

function uniqueModels(values: readonly string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function sameModels(left: readonly string[], right: readonly string[]) {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameType(value: string | number | boolean | null, expected: number) {
  return value === expected || value === String(expected)
}

function sourceBlockReason(source: CpaChannelSourceSnapshot) {
  if (source.state === 'not_configured') return 'CPA 尚未配置客户端地址或客户 Key，已阻止写入'
  if (source.state === 'auth_required') return 'CPA 客户凭据未通过验证，已阻止写入'
  if (source.state === 'invalid_response') return 'CPA 模型目录响应无效，已阻止写入'
  if (source.state === 'unavailable') return 'CPA 当前不可用，已阻止写入'
  if (!source.credentialConfigured) return 'CPA 客户 Key 未配置，已阻止写入'
  if (!source.baseUrl) return 'CPA Base URL 为空，已阻止写入'
  if (!source.modelIds.length) return 'CPA 当前没有可用模型，已阻止写入'
  return null
}

function resolveTarget(channels: readonly NewApiChannel[], mapping: ManagedChannelMapping | undefined) {
  const mapped = mapping ? channels.find((channel) => channel.id === mapping.externalChannelId) : undefined
  const markerMatches = channels.filter((channel) => channel.marker === CPA_CHANNEL_MARKER)
  if (mapped) {
    if (mapped.marker && mapped.marker !== CPA_CHANNEL_MARKER && mapped.name !== CPA_CHANNEL_NAME) {
      throw new NewApiChannelSyncError('NEW_API_CHANNEL_MAPPING_CONFLICT', '已保存的 New API 渠道映射指向了不属于 AI OPS 的对象', 409)
    }
    if (markerMatches.some((channel) => channel.id !== mapped.id)) {
      throw new NewApiChannelSyncError('NEW_API_CHANNEL_MARKER_CONFLICT', 'New API 中存在多个 AI OPS CPA 渠道候选，已停止写入', 409)
    }
    return mapped
  }
  if (markerMatches.length > 1) throw new NewApiChannelSyncError('NEW_API_CHANNEL_MARKER_CONFLICT', 'New API 中存在多个 AI OPS CPA 渠道候选，已停止写入', 409)
  if (markerMatches.length === 1) return markerMatches[0]
  const nameMatches = channels.filter((channel) => channel.name === CPA_CHANNEL_NAME)
  if (nameMatches.length > 1) throw new NewApiChannelSyncError('NEW_API_CHANNEL_NAME_CONFLICT', 'New API 中存在多个同名 AI OPS CPA 渠道，已停止写入', 409)
  return nameMatches[0] ?? null
}

export function buildChannelSyncPayload(source: CpaChannelSourceSnapshot, cpaApiKey: string): NewApiChannelWriteInput {
  const baseUrl = normalizeNewApiChannelBaseUrl(source.baseUrl)
  const modelIds = uniqueModels(source.modelIds)
  if (source.state !== 'ready' || !source.credentialConfigured || !baseUrl || !modelIds.length || !cpaApiKey.trim()) {
    throw new NewApiChannelSyncError('CPA_CHANNEL_SOURCE_NOT_READY', 'CPA 尚未达到可写入状态', 503)
  }
  return {
    name: CPA_CHANNEL_NAME,
    type: CPA_CHANNEL_TYPE,
    key: cpaApiKey.trim(),
    baseUrl,
    models: modelIds,
    group: 'default',
    priority: 10,
    weight: 100,
    status: 1,
    tag: CPA_CHANNEL_MARKER,
  }
}

export function buildChannelSyncPreview(input: {
  source: CpaChannelSourceSnapshot
  channels: readonly NewApiChannel[]
  mapping?: ManagedChannelMapping
  requestId: string
}): NewApiChannelSyncPreview {
  const targetChannel = resolveTarget(input.channels, input.mapping)
  const blocked = sourceBlockReason(input.source)
  const target: NewApiChannelSyncTarget = {
    marker: CPA_CHANNEL_MARKER,
    externalChannelId: targetChannel?.id ?? null,
    action: 'unchanged',
  }
  const changes: string[] = []
  if (blocked) {
    target.action = 'blocked'
    changes.push(blocked)
    return { cpa: { ...input.source, modelIds: uniqueModels(input.source.modelIds), baseUrl: normalizeChannelBaseUrl(input.source.baseUrl) }, target, changes, canApply: false, requestId: input.requestId }
  }

  const sourceBaseUrl = normalizeChannelBaseUrl(input.source.baseUrl)
  const expectedBaseUrl = normalizeNewApiChannelBaseUrl(input.source.baseUrl)
  const expectedModels = uniqueModels(input.source.modelIds)
  if (!targetChannel) {
    target.action = 'create'
    changes.push(`创建 ${CPA_CHANNEL_NAME}`, `写入 ${expectedModels.length} 个 CPA 实际模型`, '同步 CPA Base URL、客户 Key 和 AI OPS marker')
  } else {
    if (targetChannel.name !== CPA_CHANNEL_NAME) changes.push('修正 AI OPS CPA 渠道名称')
    if (!sameType(targetChannel.type, CPA_CHANNEL_TYPE)) changes.push('修正渠道类型为当前 New API OpenAI 兼容类型')
    if (targetChannel.baseUrl !== expectedBaseUrl) changes.push('更新 CPA Base URL')
    if (!sameModels(targetChannel.models, expectedModels)) changes.push(`更新渠道模型列表（${expectedModels.length} 个 CPA 实际模型）`)
    if (targetChannel.marker !== CPA_CHANNEL_MARKER) changes.push('写入 AI OPS marker')
    if (targetChannel.enabled !== true) changes.push('启用渠道')
    const configurationChanged = changes.some((change) => change !== '启用渠道')
    if (configurationChanged) target.action = 'update'
    else if (targetChannel.enabled !== true) target.action = 'enable'
    else target.action = 'unchanged'
  }
  return {
    cpa: { ...input.source, modelIds: expectedModels, baseUrl: sourceBaseUrl },
    target,
    changes,
    canApply: true,
    requestId: input.requestId,
  }
}

export async function listAllNewApiChannels(client: Pick<NewApiManagementClient, 'listChannels'>) {
  const channels: NewApiChannel[] = []
  for (let page = 1; page <= 100; page += 1) {
    const result = await client.listChannels(page, 100)
    if (result.state !== 'ready' || !result.data) throw managementResultError(result)
    channels.push(...result.data.items)
    if (!result.data.items.length || result.data.items.length < result.data.pageSize || channels.length >= result.data.total) break
  }
  const ids = new Set<string>()
  for (const channel of channels) {
    if (ids.has(channel.id)) throw new NewApiChannelSyncError('NEW_API_INVALID_RESPONSE', 'New API 渠道列表包含重复 ID，已停止写入', 502)
    ids.add(channel.id)
  }
  return channels
}

export function managementResultError(result: Pick<NewApiManagementResult<unknown>, 'state' | 'statusCode'>) {
  if (result.state === 'auth_required') return new NewApiChannelSyncError('NEW_API_AUTH_REQUIRED', 'New API 管理凭据未通过验证，已停止渠道写入', 503)
  if (result.statusCode === 200) return new NewApiChannelSyncError('NEW_API_INVALID_RESPONSE', 'New API 渠道接口返回了不兼容的数据，已停止渠道写入', 502)
  return new NewApiChannelSyncError('NEW_API_UNAVAILABLE', 'New API 渠道管理接口当前不可用，已停止渠道写入', 502)
}

export function channelSyncSnapshotHash(preview: NewApiChannelSyncPreview) {
  return JSON.stringify({
    source: preview.cpa,
    target: preview.target,
    changes: preview.changes,
  })
}

export function channelSyncMappingFor(preview: NewApiChannelSyncPreview, channel: NewApiChannel, now: Date): ManagedChannelMapping {
  return {
    marker: CPA_CHANNEL_MARKER,
    externalChannelId: channel.id,
    modelSnapshot: [...channel.models],
    updatedAt: now.toISOString(),
    lastRequestId: preview.requestId,
  }
}

export function channelSyncTarget(channels: readonly NewApiChannel[], mapping: ManagedChannelMapping | undefined) {
  return resolveTarget(channels, mapping)
}
