import { createHash, randomUUID } from 'node:crypto'
import type { ApiRouteContext } from './http/context.js'
import { hashPlatformApiKey } from './platform-db.js'
import { PUBLIC_MODEL_ID, PUBLIC_MODEL_NAME } from './public-model.js'
import {
  createPlatformApiKeySecret, errorPayload, ManagedKeyError, maskPlatformApiKey,
  publicGatewayBaseUrlForCodex
} from './http/support.js'

const personActionError = (error: unknown, requestId: string, reply: any) => {
  if(error instanceof ManagedKeyError) return reply.status(error.statusCode).send(errorPayload(error.code, error.message, requestId))
  if(error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REUSED') {
    return reply.status(409).send(errorPayload('IDEMPOTENCY_KEY_REUSED', '该幂等编号已用于其他人员或操作。', requestId))
  }
  throw error
}

export function createPlatformKeyService(ctx: ApiRouteContext) {
  const { database } = ctx

    const currentPlatformKey = async (ownerUserId: string) => (await database.listApiKeysForOwner(ownerUserId))
      .find((key) => key.status !== 'revoked') ?? null

    const employeePortalKeyResponse = async (ownerUserId: string, requestId: string) => {
      const key = (await currentPlatformKey(ownerUserId))
      return {
        key: key ? {
          id: key.id,
          masked: key.maskedValue,
          status: key.status as 'active' | 'expiring',
          createdAt: key.createdAt,
          lastUsedAt: key.lastUsedAt,
        } : null,
        // This route is protected by employee-only session authentication. The
        // encrypted copy exists specifically so the owner can configure another
        // device or copy the same Key after a later login. Admin routes never
        // call this helper or receive this field.
        secret: key ? (await database.readApiKeySecret(key.id)) : null,
        model: { id: PUBLIC_MODEL_ID, name: PUBLIC_MODEL_NAME },
        gateway: { baseUrl: publicGatewayBaseUrlForCodex() },
        requestId,
      }
    }

    const issuePlatformKey = async (ownerUserId: string, actorUserId: string | null, requestId: string, idempotencyKey: string, action: 'create' | 'reset') => {
      return database.db.transaction(async () => {
      await database.db.lock('person:' + ownerUserId)
      const person = (await database.findPerson(ownerUserId))
      if(!person || person.status !== 'active') {
        throw new ManagedKeyError('EMPLOYEE_NOT_ACTIVE', '员工账号不存在或已停用，不能创建 API Key。')
      }
      const auditEventId = 'audit-' + idempotencyKey
      const existingOperation = (await database.findApiKeyOperation(idempotencyKey))
      if(existingOperation) {
        if(existingOperation.personId !== ownerUserId) {
          throw new ManagedKeyError('IDEMPOTENCY_KEY_REUSED', '幂等编号已用于其他员工。')
        }
        const key = (await database.listApiKeysForOwner(ownerUserId)).find((item) => item.id === existingOperation.keyId)
        const secret = key ? (await database.readApiKeySecret(key.id)) : null
        if(!key || !secret) throw new ManagedKeyError('KEY_OPERATION_UNAVAILABLE', '已保存的 Key 操作无法读取，请重新发起重置。', 503)
        return { key, secret, auditEventId, idempotent: true }
      }

      const secret = createPlatformApiKeySecret()
      const maskedValue = maskPlatformApiKey(secret)
      const existing = (await currentPlatformKey(ownerUserId))
      if(existing) {
        if (action === 'create') throw new ManagedKeyError('KEY_ALREADY_CREATED', '你已经创建过平台 Key；如需更换，请使用“重置 Key”。', 409)
        const result = (await database.resetApiKey(existing.id, {
          maskedValue,
          secretHash: hashPlatformApiKey(secret),
          secretValue: secret,
        }, {
          id: auditEventId,
          actorUserId,
          action: 'reset',
          resourceType: 'key',
          resourceId: existing.id,
          result: 'success',
          requestId,
          summary: {
            code: 'PLATFORM_KEY_RESET',
            message: 'AI OPS 平台 Key 已重置；旧 Key 立即失效。',
            resourceName: person.displayName,
            idempotencyFingerprint: createHash('sha256').update(ownerUserId + ':' + action).digest('hex'),
          },
        }))
        if(!result || !result.secret) throw new ManagedKeyError('KEY_RESET_FAILED', 'AI OPS 平台 Key 重置未完成，请稍后重试。')
        return { key: result.key, secret: result.secret, auditEventId, idempotent: result.idempotent }
      }

      const keyId = 'key-aiops-' + randomUUID().replaceAll('-', '').slice(0, 16)
      const created = (await database.createApiKey({
        id: keyId,
        ownerUserId,
        maskedValue,
        secretHash: hashPlatformApiKey(secret),
        secretValue: secret,
        purpose: 'AI OPS 统一访问',
        status: 'active',
        secretRevealedAt: new Date().toISOString(),
        idempotencyKey,
      }, {
        id: auditEventId,
        actorUserId,
        action: 'create',
        resourceType: 'key',
        resourceId: keyId,
        result: 'success',
        requestId,
        summary: {
          code: 'PLATFORM_KEY_CREATED',
          message: '已创建 AI OPS 平台 Key；员工本人可在登录后查看和复制。',
          resourceName: person.displayName,
          idempotencyFingerprint: createHash('sha256').update(ownerUserId + ':' + action).digest('hex'),
        },
      }))
      if(!created) throw new ManagedKeyError('KEY_CREATE_FAILED', 'AI OPS 平台 Key 创建未完成，请稍后重试。')
      return { key: created, secret, auditEventId, idempotent: false }
      })
    }

  return { currentPlatformKey, employeePortalKeyResponse, issuePlatformKey, personActionError }
}

export type PlatformKeyService = ReturnType<typeof createPlatformKeyService>
