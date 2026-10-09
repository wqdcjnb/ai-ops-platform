import { z } from 'zod'
import { externalProviderIdSchema, externalProviderInputSchema, externalProviderModelIdSchema, listExternalProviderPresets, ExternalProviderError } from '../external-providers.js'

import { randomUUID } from 'node:crypto'
import type { ApiRouteContext } from '../http/context.js'
import { errorPayload, parseInput } from '../http/support.js'

export const externalProviderParamsSchema = z.object({ id: externalProviderIdSchema })

export const externalProviderCreateInputSchema = externalProviderInputSchema.extend({ id: externalProviderIdSchema.optional() })

export const externalProviderDiscoveryInputSchema = z.object({
  baseUrl: z.string().trim().url().max(512),
  apiKey: z.string().trim().min(1).max(2048),
})

export const externalProviderModelTestInputSchema = externalProviderDiscoveryInputSchema.extend({
  modelIds: z.array(externalProviderModelIdSchema).min(1).max(10_000),
})

export const externalProviderEnabledInputSchema = z.object({ enabled: z.boolean() })

export function registerExternalProviderRoutes(ctx: ApiRouteContext) {
  const {
    app, database,     externalProviderRegistry,
  } = ctx

    const sendExternalProviderError = (error: unknown, requestId: string, reply: any) => {
      if(error instanceof ExternalProviderError) {
        return reply.status(error.statusCode).send(errorPayload(error.code, error.message, requestId))
      }
      return reply.status(502).send(errorPayload('EXTERNAL_PROVIDER_UNAVAILABLE', '第三方账号暂时不可用；本次配置未保存。', requestId))
    }

    const recordExternalProviderAudit = async (
      action: 'create' | 'update' | 'sync' | 'verify' | 'delete',
      provider: { id: string; name: string; models: unknown[] },
      requestId: string,
      actorUserId: string | null,
    ) => {
      const codes = {
        create: 'RELAY_ACCOUNT_CREATED',
        update: 'RELAY_ACCOUNT_UPDATED',
        sync: 'RELAY_ACCOUNT_SYNCED',
        verify: 'RELAY_ACCOUNT_HEALTH_CHECKED',
        delete: 'RELAY_ACCOUNT_DELETED',
      }
      await database.appendAuditEvent({
        id: 'audit-external-provider-' + action + '-' + randomUUID(),
        actorUserId,
        action,
        resourceType: 'upstream',
        resourceId: 'external-provider-' + provider.id,
        result: 'success',
        requestId,
        summary: {
          code: codes[action],
          resourceName: provider.name,
          modelCount: provider.models.length,
          message: action === 'verify'
            ? '已执行轻量模型目录健康检查；未发送任何生成请求。'
            : action === 'delete'
              ? '已删除第三方账号；审计不保存中转站地址或凭据。'
              : '已维护第三方账号并同步所选可用模型；审计不保存中转站地址或凭据。',
        },
      })
    }

    app.get('/api/external-providers/presets', async (request) => ({
      meta: {
        source: 'built_in' as const,
        generatedAt: new Date().toISOString(),
        notice: '预设只提供服务地址；保存时会验证管理员选择的模型。',
      },
      items: listExternalProviderPresets(),
      requestId: request.id,
    }))

    app.get('/api/external-providers', async (request) => ({
      meta: {
        source: 'runtime' as const,
        generatedAt: new Date().toISOString(),
        notice: '中转站凭据经服务端加密保存，员工、WorkBuddy 与 Codex 只接收平台 Key。',
      },
      items: externalProviderRegistry.list(),
      requestId: request.id,
    }))

    app.post('/api/external-providers/discover', async (request, reply) => {
      const body = parseInput(externalProviderDiscoveryInputSchema, request.body, request.id, reply)
      if(!body) return
      try {
        const discovered = await externalProviderRegistry.discover(body)
        return { ...discovered, requestId: request.id }
      } catch(error) {
        return sendExternalProviderError(error, request.id, reply)
      }
    })

    app.post('/api/external-providers/test', async (request, reply) => {
      const body = parseInput(externalProviderModelTestInputSchema, request.body, request.id, reply)
      if(!body) return
      try {
        const report = await externalProviderRegistry.testModels(body)
        const availableCount = report.results.filter((item) => item.status === 'available').length
        await database.appendAuditEvent({
          id: 'audit-external-provider-model-test-' + randomUUID(),
          actorUserId: request.authUser?.id ?? null,
          action: 'verify',
          resourceType: 'upstream',
          resourceId: 'external-provider-preview',
          result: availableCount > 0 ? 'success' : 'failed',
          requestId: request.id,
          summary: {
            code: 'RELAY_ACCOUNT_MODEL_TESTED',
            message: '已完成管理员发起的第三方模型调用探测；审计不保存服务地址、凭据或测试内容。',
            modelCount: report.results.length,
            availableCount,
          },
        })
        return { ...report, requestId: request.id }
      } catch(error) {
        return sendExternalProviderError(error, request.id, reply)
      }
    })

    app.post('/api/external-providers', async (request, reply) => {
      const body = parseInput(externalProviderCreateInputSchema, request.body, request.id, reply)
      if(!body) return
      try {
        const input = {
          name: body.name,
          baseUrl: body.baseUrl,
          apiKey: body.apiKey,
          modelIds: body.modelIds,
          enabled: body.enabled,
        }
        const existing = body.id ? externalProviderRegistry.get(body.id) : null
        const provider = body.id
          ? await externalProviderRegistry.upsertVerified(body.id, input)
          : await externalProviderRegistry.createVerified(input)
        await recordExternalProviderAudit(existing ? 'update' : 'create', provider, request.id, request.authUser?.id ?? null)
        return { provider, requestId: request.id }
      } catch(error) {
        return sendExternalProviderError(error, request.id, reply)
      }
    })

    app.patch('/api/external-providers/:id', async (request, reply) => {
      const params = parseInput(externalProviderParamsSchema, request.params, request.id, reply)
      const body = parseInput(externalProviderInputSchema, request.body, request.id, reply)
      if(!params || !body) return
      try {
        const provider = await externalProviderRegistry.upsertVerified(params.id, body)
        await recordExternalProviderAudit('update', provider, request.id, request.authUser?.id ?? null)
        return { provider, requestId: request.id }
      } catch(error) {
        return sendExternalProviderError(error, request.id, reply)
      }
    })

    app.patch('/api/external-providers/:id/enabled', async (request, reply) => {
      const params = parseInput(externalProviderParamsSchema, request.params, request.id, reply)
      const body = parseInput(externalProviderEnabledInputSchema, request.body, request.id, reply)
      if(!params || !body) return
      try {
        const provider = await externalProviderRegistry.setEnabled(params.id, body.enabled)
        await recordExternalProviderAudit('update', provider, request.id, request.authUser?.id ?? null)
        return { provider, requestId: request.id }
      } catch(error) {
        return sendExternalProviderError(error, request.id, reply)
      }
    })

    app.post('/api/external-providers/:id/sync', async (request, reply) => {
      const params = parseInput(externalProviderParamsSchema, request.params, request.id, reply)
      if(!params) return
      try {
        const provider = await externalProviderRegistry.syncModels(params.id)
        await recordExternalProviderAudit('sync', provider, request.id, request.authUser?.id ?? null)
        return { provider, requestId: request.id }
      } catch(error) {
        return sendExternalProviderError(error, request.id, reply)
      }
    })

    app.post('/api/external-providers/:id/health', async (request, reply) => {
      const params = parseInput(externalProviderParamsSchema, request.params, request.id, reply)
      if(!params) return
      try {
        const provider = await externalProviderRegistry.checkHealth(params.id)
        await recordExternalProviderAudit('verify', provider, request.id, request.authUser?.id ?? null)
        return { provider, requestId: request.id }
      } catch(error) {
        return sendExternalProviderError(error, request.id, reply)
      }
    })

    app.delete('/api/external-providers/:id', async (request, reply) => {
      const params = parseInput(externalProviderParamsSchema, request.params, request.id, reply)
      if(!params) return
      try {
        const provider = await externalProviderRegistry.remove(params.id)
        await recordExternalProviderAudit('delete', provider, request.id, request.authUser?.id ?? null)
        return { status: 'ok' as const, requestId: request.id }
      } catch(error) {
        return sendExternalProviderError(error, request.id, reply)
      }
    })
}
