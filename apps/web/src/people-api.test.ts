import { describe, expect, it } from 'vitest'
import { peopleResponseSchema } from './people-api'

describe('people API contract', () => {
  it('accepts the final employee and platform-Key payload without retired fields', () => {
    const response = peopleResponseSchema.parse({
      meta: {
        source: 'database',
        generatedAt: '2026-09-27T11:00:00.000Z',
        timezone: 'Asia/Shanghai',
        notice: '员工通过姓名、邮箱和密码自助注册；管理员仅维护状态、密码和唯一平台 Key。',
      },
      summary: { total: 1, active: 1, disabled: 0 },
      items: [{
        id: 'person-test',
        name: '测试员工',
        initials: '测试',
        title: '员工',
        status: 'active',
        username: 'employee@example.com',
        createdAt: '2026-09-27T10:00:00.000Z',
        lastUsedAt: null,
        apiKeyMasked: 'sk-aiops••••••TEST01',
        keyCount: 1,
        tone: 'blue',
      }],
      page: 1,
      pageSize: 50,
      total: 1,
    })

    expect(response.items[0]).toMatchObject({
      title: '员工',
      status: 'active',
      apiKeyMasked: 'sk-aiops••••••TEST01',
    })
  })
})
