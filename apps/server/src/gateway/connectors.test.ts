import { describe, expect, it } from 'vitest'
import { loadGatewayConfig } from '../gateway-config.js'
import { createGatewayConnector, describeGatewayConnector } from './connectors.js'
import { GatewayUpstreamError } from './openai-compatible.js'

describe('managed relay connector boundary', () => {
  it('describes only the managed relay gateway', () => {
    expect(describeGatewayConnector(loadGatewayConfig({}))).toEqual({
      id: 'relay',
      label: '中转站统一模型网关',
      environment: 'production',
      configured: false,
    })
  })

  it('does not provide a process-wide upstream fallback', async () => {
    const connector = createGatewayConnector(loadGatewayConfig({}))
    await expect(connector.listModels()).rejects.toMatchObject({ code: 'GATEWAY_UPSTREAM_NOT_CONFIGURED' } satisfies Partial<GatewayUpstreamError>)
  })
})
