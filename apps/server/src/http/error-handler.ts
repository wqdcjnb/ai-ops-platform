import { z } from 'zod'
import { errorPayload } from './support.js'
import type { AppInstance } from './context.js'

export function registerErrorHandler(app: AppInstance) {
    app.setErrorHandler((error, request, reply) => {
      if(error instanceof z.ZodError) {
        return reply.status(400).send(errorPayload('VALIDATION_ERROR', '请求参数不符合接口约定。', request.id))
      }
      const status = (error as { statusCode?: number }).statusCode
      if (status === 400) return reply.status(400).send(errorPayload('VALIDATION_ERROR', '请求参数不符合接口约定。', request.id))
      if(status === 429) return reply.status(429).send(errorPayload('RATE_LIMITED', '请求过于频繁，请稍后重试。', request.id))
      // PostgreSQL errors may contain values from unique/FK constraints. Never
      // serialize the original error, query parameters or connection strings.
      app.log.error({ code: (error as { code?: string }).code, requestId: request.id }, 'Unhandled API error')
      return reply.status(500).send(errorPayload('INTERNAL_ERROR', '服务暂时不可用，请稍后重试。', request.id))
    })
}
