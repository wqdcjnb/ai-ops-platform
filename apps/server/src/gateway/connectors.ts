import type { GatewayConfig } from '../gateway-config.js'
import { OpenAiCompatibleAdapter, type GatewayUpstream } from './openai-compatible.js'

export interface GatewayConnectorDescriptor {
  id: 'relay'
  label: string
  environment: 'production'
  configured: boolean
}

/** The only connector exposed by this product is the managed relay gateway. */
export function describeGatewayConnector(config: GatewayConfig): GatewayConnectorDescriptor {
  return {
    id: 'relay',
    label: '中转站统一模型网关',
    environment: 'production',
    configured: config.upstreamConfigured,
  }
}

/**
 * Used only when a caller supplies a short-lived relay-specific config. The
 * application normally wraps it with ExternalProviderGatewayUpstream, which
 * obtains the URL and credential from the encrypted registry.
 */
export function createGatewayConnector(config: GatewayConfig): GatewayUpstream {
  return new OpenAiCompatibleAdapter(config)
}
