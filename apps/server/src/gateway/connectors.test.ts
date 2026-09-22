import { describe, expect, it } from 'vitest'
import { loadGatewayConfig } from '../gateway-config.js'
import { createGatewayConnector, describeGatewayConnector } from './connectors.js'
import { GatewayUpstreamError } from './openai-compatible.js'

describe('gateway connector boundaries', () => {
  it('describes each connector with an explicit environment', () => {
    expect(describeGatewayConnector(loadGatewayConfig({}))).toMatchObject({ id: 'cpa', label: 'CPA Codex OAuth', environment: 'production', configured: false })
    expect(describeGatewayConnector(loadGatewayConfig({ AI_OPS_GATEWAY_MODE: 'new_api' }))).toMatchObject({ id: 'new_api', label: 'New API 连接器', environment: 'production' })
    expect(describeGatewayConnector(loadGatewayConfig({ AI_OPS_GATEWAY_MODE: 'cpa' }))).toMatchObject({ id: 'cpa', label: 'CPA Codex OAuth', environment: 'production' })
  })

  it('keeps an unconfigured connector unavailable instead of falling through to another mode', async () => {
    const connector = createGatewayConnector(loadGatewayConfig({ AI_OPS_GATEWAY_MODE: 'new_api' }))
    await expect(connector.listModels()).rejects.toMatchObject({ code: 'GATEWAY_UPSTREAM_NOT_CONFIGURED' } satisfies Partial<GatewayUpstreamError>)
  })
})
