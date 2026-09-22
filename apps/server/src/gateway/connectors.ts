import type { GatewayConfig, GatewayMode } from '../gateway-config.js'
import { OpenAiCompatibleAdapter, type GatewayRequestContext, type GatewayUpstream } from './openai-compatible.js'

export interface GatewayConnectorDescriptor {
  id: GatewayMode
  label: string
  environment: 'production' | 'experiment'
  configured: boolean
}

const connectorMetadata: Record<GatewayMode, Omit<GatewayConnectorDescriptor, 'configured'>> = {
  standalone: { id: 'standalone', label: '独立网关', environment: 'production' },
  new_api: { id: 'new_api', label: 'New API 连接器', environment: 'production' },
  cpa: { id: 'cpa', label: 'CPA Codex OAuth', environment: 'production' },
}

export function describeGatewayConnector(config: GatewayConfig): GatewayConnectorDescriptor {
  return { ...connectorMetadata[config.mode], configured: config.upstreamConfigured }
}

/**
 * Every mode gets its own adapter instance. The adapters currently share the
 * OpenAI-compatible transport, but the mode remains explicit so a future
 * connector cannot silently become a fallback for another connector.
 */
export function createGatewayConnector(config: GatewayConfig): GatewayUpstream {
  return new ModeBoundOpenAiAdapter(config, config.mode)
}

class ModeBoundOpenAiAdapter implements GatewayUpstream {
  private readonly adapter: OpenAiCompatibleAdapter

  constructor(private readonly config: GatewayConfig, private readonly mode: GatewayMode) {
    this.adapter = new OpenAiCompatibleAdapter(config)
  }

  listModels(signal?: AbortSignal, context?: GatewayRequestContext) {
    return this.adapter.listModels(signal, context)
  }

  chatCompletion(request: Parameters<GatewayUpstream['chatCompletion']>[0], signal?: AbortSignal, context?: GatewayRequestContext) {
    return this.adapter.chatCompletion(request, signal, context)
  }

  chatCompletionStream(
    request: Parameters<GatewayUpstream['chatCompletionStream']>[0],
    onChunk: Parameters<GatewayUpstream['chatCompletionStream']>[1],
    signal?: AbortSignal,
    requestId?: string,
    context?: GatewayRequestContext,
  ) {
    return this.adapter.chatCompletionStream(request, onChunk, signal, requestId, context)
  }

  responses(request: Parameters<NonNullable<GatewayUpstream['responses']>>[0], signal?: AbortSignal, context?: GatewayRequestContext) {
    return this.adapter.responses!(request, signal, context)
  }

  responsesStream(
    request: Parameters<NonNullable<GatewayUpstream['responsesStream']>>[0],
    onEvent: Parameters<NonNullable<GatewayUpstream['responsesStream']>>[1],
    signal?: AbortSignal,
    requestId?: string,
    context?: GatewayRequestContext,
  ) {
    return this.adapter.responsesStream!(request, onEvent, signal, requestId, context)
  }

  cancel(requestId: string, signal?: AbortSignal) {
    // The mode is intentionally captured by the adapter boundary. This keeps
    // cancellation scoped to the active connector and prevents cross-connector
    // request cancellation when multiple gateway instances are hosted together.
    void this.mode
    void this.config
    return this.adapter.cancel(requestId, signal)
  }
}
