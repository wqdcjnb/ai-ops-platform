import { describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from './router'

describe('final product routing', () => {
  it('sends an unauthenticated visitor to email login', async () => {
    const router = createAppRouter({ history: createMemoryHistory(), authenticated: false })
    await router.push('/people')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('lands the super administrator on people information management', async () => {
    const router = createAppRouter({ history: createMemoryHistory(), role: 'super_admin' })
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('people')
    expect(router.currentRoute.value.path).toBe('/people')
  })

  it('keeps employees in their self-service portal', async () => {
    const router = createAppRouter({ history: createMemoryHistory(), role: 'employee' })
    await router.push('/people')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('employee-portal')
  })

  it('sends an obsolete route to the current administration landing page', async () => {
    const router = createAppRouter({ history: createMemoryHistory(), role: 'super_admin' })
    await router.push('/obsolete-control-plane')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('people')
  })
})
