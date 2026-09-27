import { buildApp } from './app.js'
import { loadGatewayConfig } from './gateway-config.js'

const rawPort = Number(process.env.PORT ?? 4175)
if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

const host = process.env.HOST ?? '127.0.0.1'
const gatewayConfig = loadGatewayConfig()
const app = buildApp({ logger: true, gatewayConfig })

app.log.info({
  mode: gatewayConfig.mode,
  provider: gatewayConfig.provider,
  upstreamConfigured: gatewayConfig.upstreamConfigured,
}, 'AI OPS relay gateway loaded')

try {
  await app.listen({ host, port: rawPort })
} catch (error) {
  app.log.error(error)
  await app.close()
  process.exitCode = 1
}
