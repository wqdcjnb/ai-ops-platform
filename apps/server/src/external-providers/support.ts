import { existsSync, readFileSync } from 'node:fs'
import { GatewayUpstreamError } from '../gateway/openai-compatible.js'
import type { ExternalProviderModelTestResult, PersistedExternalProviders } from './schemas.js'
import { persistedStateSchema } from './schemas.js'
export function readProviderFile(filePath: string): PersistedExternalProviders | null {
  if(!existsSync(filePath)) return null
  try {
    const parsed = persistedStateSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf8')))
    if(!parsed.success) throw new Error('Invalid legacy provider configuration')
    return parsed.data
  } catch {
    throw new Error('第三方账号配置无法读取，已停止迁移；原文件未修改。')
  }
}

export async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async () => {
    while(true) {
      const index = cursor++
      if(index >= items.length) return
      results[index] = await mapper(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker))
  return results
}

/** Authentication, transport and quota failures are definitive for the
 * current account, so retrying a different text endpoint adds delay without
 * improving the diagnosis. Endpoint/shape errors intentionally return null:
 * the caller then tries the alternate OpenAI text contract. */
export function directTextProbeFailure(id: string, error: unknown, startedAt: number): ExternalProviderModelTestResult | null {
  if(!(error instanceof GatewayUpstreamError)) return null
  const latencyMs = Math.max(1, Date.now() - startedAt)
  if(error.code === 'GATEWAY_UPSTREAM_AUTH_FAILED') {
    return { id, status: 'unavailable', latencyMs, message: '第三方账号拒绝了认证，请检查 API Key。' }
  }
  if(error.code === 'GATEWAY_UPSTREAM_TIMEOUT') {
    return { id, status: 'unavailable', latencyMs, message: '模型调用测试超时。' }
  }
  if(error.code === 'GATEWAY_UPSTREAM_RATE_LIMITED') {
    return { id, status: 'unavailable', latencyMs, message: '第三方服务暂时限流。' }
  }
  if(error.code === 'GATEWAY_UPSTREAM_CREDIT_EXHAUSTED') {
    return { id, status: 'unavailable', latencyMs, message: '第三方账号余额或调用配额不足，无法完成模型调用测试。' }
  }
  if(error.code === 'GATEWAY_UPSTREAM_UNAVAILABLE') {
    return { id, status: 'unavailable', latencyMs, message: '第三方服务暂时不可达。' }
  }
  return null
}
