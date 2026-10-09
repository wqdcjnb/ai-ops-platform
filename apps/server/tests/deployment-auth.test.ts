import assert from 'node:assert/strict'
import { test } from 'node:test'
import Fastify from 'fastify'
import { createAuthService } from '../src/auth.js'

// These tests exercise login/logout cookies without connecting to live storage.
async function withEnvironment(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  try {
    for(const [key, value] of Object.entries(values)) {
      if(value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await run()
  } finally {
    for(const [key, value] of Object.entries(previous)) {
      if(value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const testAccount = {
  AUTH_ADMIN_USERNAME: 'admin@example.test',
  AUTH_ADMIN_PASSWORD: 'deployment-test-only-password',
  AUTH_ADMIN_DISPLAY_NAME: '部署管理员',
}

for(const scenario of [
  { name: 'HTTP LAN explicitly disables Secure in production mode', environment: 'production', configured: 'false', secure: false },
  { name: 'HTTPS explicitly enables Secure', environment: 'test', configured: 'true', secure: true },
  { name: 'production keeps Secure when no override is configured', environment: 'production', configured: undefined, secure: true },
  { name: 'invalid override cannot disable production Secure', environment: 'production', configured: 'invalid', secure: true },
]) {
  test(scenario.name, async () => withEnvironment({ ...testAccount, NODE_ENV: scenario.environment, AI_OPS_COOKIE_SECURE: scenario.configured }, async () => {
    const auth = createAuthService()
    const app = Fastify()
    app.post('/login', async (_request, reply) => {
      const session = await auth.login(testAccount.AUTH_ADMIN_USERNAME, testAccount.AUTH_ADMIN_PASSWORD)
      assert.ok(session)
      auth.setSessionCookie(reply, session.token, session.csrfToken, session.expiresAt)
      return { displayName: session.user.displayName }
    })
    app.post('/logout', async (_request, reply) => {
      auth.clearSessionCookie(reply)
      return { ok: true }
    })
    try {
      const login = await app.inject({ method: 'POST', url: '/login' })
      assert.equal(login.statusCode, 200)
      assert.equal(login.json().displayName, testAccount.AUTH_ADMIN_DISPLAY_NAME)
      const logout = await app.inject({ method: 'POST', url: '/logout' })
      assert.equal(logout.statusCode, 200)
      for(const response of [login, logout]) {
        assert.equal(response.cookies.length, 2)
        for(const cookie of response.cookies) {
          assert.equal(Boolean(cookie.secure), scenario.secure)
          assert.equal(cookie.sameSite, 'Strict')
          assert.equal(Boolean(cookie.httpOnly), cookie.name === 'ai_ops_session')
          if(response === logout) assert.equal(cookie.maxAge, 0)
        }
      }
    } finally {
      await app.close()
    }
  }))
}

test('bootstrap display name preserves custom names and bounds corrupt values', async () => {
  for(const [configured, expected] of [
    ['  部署管理员  ', '部署管理员'],
    ['', '超级管理员'],
    ['乱码'.repeat(100), '超级管理员'],
    [undefined, '超级管理员'],
  ]) {
    await withEnvironment({ ...testAccount, AUTH_ADMIN_DISPLAY_NAME: configured }, async () => {
      const auth = createAuthService()
      const session = await auth.login(testAccount.AUTH_ADMIN_USERNAME, testAccount.AUTH_ADMIN_PASSWORD)
      assert.ok(session)
      assert.equal(session.user.displayName, expected)
    })
  }
})
