import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { PlatformDatabase } from './platform-db.js'

function cookieHeader(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value : value ? [value] : []).map((item) => item.split(';', 1)[0]).join('; ')
}

function cookieValue(value: string | string[] | undefined, name: string) {
  return cookieHeader(value).split('; ').find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''
}

describe('conversation audit record deletion', () => {
  const apps: Array<ReturnType<typeof buildApp>> = []
  const databases: PlatformDatabase[] = []

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
    databases.splice(0).forEach((database) => database.close())
  })

  it('deletes the local audit record while retaining a deletion proof and audit event', async () => {
    const database = new PlatformDatabase({ filename: ':memory:' })
    databases.push(database)
    database.seedDepartment({ id: 'dept-conversation-audit', name: '对话审计部' })
    database.seedUser({
      id: 'person-conversation-audit',
      username: 'conversation-audit@example.com',
      displayName: '对话审计测试员',
      role: 'employee',
      roleLabel: '员工',
      password: 'test-password',
      departmentId: 'dept-conversation-audit',
    })
    database.seedApiKey({
      id: 'key-conversation-audit',
      ownerUserId: 'person-conversation-audit',
      maskedValue: 'sk-test••••delete',
      purpose: '删除测试',
      status: 'active',
      expiresAt: null,
      models: ['gpt-5.6-terra'],
    })

    const startedAt = new Date().toISOString()
    const completedAt = new Date(Date.now() + 1_000).toISOString()
    const recordId = 'conv-audit-delete-test'
    const requestId = 'req-conversation-delete-test-01'
    database.startConversationAuditCapture({
      id: recordId,
      requestId,
      keyId: 'key-conversation-audit',
      externalTokenId: null,
      personId: 'person-conversation-audit',
      keyMasked: 'sk-test••••delete',
      purpose: '删除测试',
      model: 'gpt-5.6-terra',
      endpoint: '/v1/chat/completions',
      startedAt,
      prompt: { messages: [{ role: 'user', content: '待删除正文' }] },
      streamed: false,
    })
    database.completeConversationAuditCapture(requestId, {
      status: 'succeeded',
      completedAt,
      httpStatus: 200,
      response: {
        id: 'chatcmpl-delete-test',
        object: 'chat.completion',
        model: 'gpt-5.6-terra',
        choices: [{ message: { role: 'assistant', content: '待删除回复' } }],
      },
    })

    const app = buildApp({ database })
    apps.push(app)
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@aiops.local', password: 'test-admin-password' },
    })
    expect(login.statusCode).toBe(200)
    const cookie = cookieHeader(login.headers['set-cookie'])
    const csrf = cookieValue(login.headers['set-cookie'], 'ai_ops_csrf')
    const payload = { idempotencyKey: 'conversation-delete-test-12345678', acknowledgeImpact: true }

    const deleted = await app.inject({
      method: 'POST',
      url: `/api/conversation-audits/${recordId}/delete`,
      headers: { cookie, 'x-csrf-token': csrf },
      payload,
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toMatchObject({
      record: { id: recordId, requestId, state: 'deleted' },
      operation: { idempotencyKey: payload.idempotencyKey, idempotent: false },
    })

    expect(database.getConversationAuditContent(recordId)).toBeNull()
    expect(database.getConversationAuditRecordById(recordId)).toBeNull()
    expect(database.tableCounts().conversationAuditDeletions).toBe(1)

    const list = await app.inject({
      method: 'GET',
      url: '/api/conversation-audits?period=7d',
      headers: { cookie },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().items).not.toContainEqual(expect.objectContaining({ id: recordId }))

    const access = await app.inject({
      method: 'POST',
      url: `/api/conversation-audits/${recordId}/access`,
      headers: { cookie, 'x-csrf-token': csrf },
      payload: {},
    })
    expect(access.statusCode).toBe(404)
    expect(access.json()).toMatchObject({ error: { code: 'CONVERSATION_CONTENT_UNAVAILABLE' } })

    const repeated = await app.inject({
      method: 'POST',
      url: `/api/conversation-audits/${recordId}/delete`,
      headers: { cookie, 'x-csrf-token': csrf },
      payload,
    })
    expect(repeated.statusCode).toBe(200)
    expect(repeated.json()).toMatchObject({ operation: { idempotent: true } })
    expect(database.listAuditEvents()).toContainEqual(expect.objectContaining({
      action: 'delete',
      resourceType: 'conversation',
      resourceId: recordId,
      result: 'success',
    }))
  })
})
