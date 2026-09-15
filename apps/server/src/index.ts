import { buildApp } from './app.js'

const rawPort = Number(process.env.PORT ?? 4175)
if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

const app = buildApp({ logger: true })

try {
  await app.listen({ host: '127.0.0.1', port: rawPort })
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
