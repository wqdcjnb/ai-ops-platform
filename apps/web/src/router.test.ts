import { describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from './router'

describe('application routing', () => {
  it('opens the unified entry page at the root route', async () => {
    const router = createAppRouter({ history: createMemoryHistory(), role: 'super_admin' })
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('home')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('keeps employees out of administrator routes', async () => {
    const router = createAppRouter({ history: createMemoryHistory(), role: 'employee' })
    await router.push('/overview')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('employee-home')
  })

  it('keeps administrators out of the employee-only layout', async () => {
    const router = createAppRouter({ history: createMemoryHistory(), role: 'admin' })
    await router.push('/me')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('allows department leads to open people but keeps finance out', async () => {
    const leadRouter = createAppRouter({ history: createMemoryHistory(), role: 'department_lead' })
    await leadRouter.push('/people')
    await leadRouter.isReady()
    expect(leadRouter.currentRoute.value.name).toBe('people')

    const financeRouter = createAppRouter({ history: createMemoryHistory(), role: 'finance' })
    await financeRouter.push('/people')
    await financeRouter.isReady()
    expect(financeRouter.currentRoute.value.name).toBe('home')
  })

  it('applies the people role boundary to person details', async () => {
    const adminRouter = createAppRouter({ history: createMemoryHistory(), role: 'admin' })
    await adminRouter.push('/people/person-lin')
    await adminRouter.isReady()
    expect(adminRouter.currentRoute.value.name).toBe('person-detail')

    const employeeRouter = createAppRouter({ history: createMemoryHistory(), role: 'employee' })
    await employeeRouter.push('/people/person-lin')
    await employeeRouter.isReady()
    expect(employeeRouter.currentRoute.value.name).toBe('employee-home')
  })

  it('allows department leads to inspect masked Keys but keeps finance out', async () => {
    const leadRouter = createAppRouter({ history: createMemoryHistory(), role: 'department_lead' })
    await leadRouter.push('/keys')
    await leadRouter.isReady()
    expect(leadRouter.currentRoute.value.name).toBe('keys')

    const financeRouter = createAppRouter({ history: createMemoryHistory(), role: 'finance' })
    await financeRouter.push('/keys')
    await financeRouter.isReady()
    expect(financeRouter.currentRoute.value.name).toBe('home')
  })

  it('allows finance to inspect limits but keeps employees out', async () => {
    const financeRouter = createAppRouter({ history: createMemoryHistory(), role: 'finance' })
    await financeRouter.push('/limits')
    await financeRouter.isReady()
    expect(financeRouter.currentRoute.value.name).toBe('limits')

    const employeeRouter = createAppRouter({ history: createMemoryHistory(), role: 'employee' })
    await employeeRouter.push('/limits')
    await employeeRouter.isReady()
    expect(employeeRouter.currentRoute.value.name).toBe('employee-home')
  })

  it('limits purpose routes to super administrators and administrators', async () => {
    const adminRouter = createAppRouter({ history: createMemoryHistory(), role: 'admin' })
    await adminRouter.push('/routes')
    await adminRouter.isReady()
    expect(adminRouter.currentRoute.value.name).toBe('routes')

    const leadRouter = createAppRouter({ history: createMemoryHistory(), role: 'department_lead' })
    await leadRouter.push('/routes')
    await leadRouter.isReady()
    expect(leadRouter.currentRoute.value.name).toBe('home')
  })

  it('allows department leads to inspect models but keeps finance out', async () => {
    const leadRouter = createAppRouter({ history: createMemoryHistory(), role: 'department_lead' })
    await leadRouter.push('/models')
    await leadRouter.isReady()
    expect(leadRouter.currentRoute.value.name).toBe('models')

    const financeRouter = createAppRouter({ history: createMemoryHistory(), role: 'finance' })
    await financeRouter.push('/models')
    await financeRouter.isReady()
    expect(financeRouter.currentRoute.value.name).toBe('home')
  })

  it('limits upstream accounts to super administrators and administrators', async () => {
    const adminRouter = createAppRouter({ history: createMemoryHistory(), role: 'admin' })
    await adminRouter.push('/upstreams')
    await adminRouter.isReady()
    expect(adminRouter.currentRoute.value.name).toBe('upstreams')

    const leadRouter = createAppRouter({ history: createMemoryHistory(), role: 'department_lead' })
    await leadRouter.push('/upstreams')
    await leadRouter.isReady()
    expect(leadRouter.currentRoute.value.name).toBe('home')
  })

  it('allows finance and department leads to inspect usage metadata', async () => {
    const financeRouter = createAppRouter({ history: createMemoryHistory(), role: 'finance' })
    await financeRouter.push('/usage')
    await financeRouter.isReady()
    expect(financeRouter.currentRoute.value.name).toBe('usage')

    const leadRouter = createAppRouter({ history: createMemoryHistory(), role: 'department_lead' })
    await leadRouter.push('/usage')
    await leadRouter.isReady()
    expect(leadRouter.currentRoute.value.name).toBe('usage')
  })

  it('allows operations roles to inspect alerts but keeps employees out', async () => {
    const financeRouter = createAppRouter({ history: createMemoryHistory(), role: 'finance' })
    await financeRouter.push('/alerts')
    await financeRouter.isReady()
    expect(financeRouter.currentRoute.value.name).toBe('alerts')

    const employeeRouter = createAppRouter({ history: createMemoryHistory(), role: 'employee' })
    await employeeRouter.push('/alerts')
    await employeeRouter.isReady()
    expect(employeeRouter.currentRoute.value.name).toBe('employee-home')
  })

  it('limits audit logs to super administrators and administrators', async () => {
    const adminRouter = createAppRouter({ history: createMemoryHistory(), role: 'admin' })
    await adminRouter.push('/audit')
    await adminRouter.isReady()
    expect(adminRouter.currentRoute.value.name).toBe('audit')

    const financeRouter = createAppRouter({ history: createMemoryHistory(), role: 'finance' })
    await financeRouter.push('/audit')
    await financeRouter.isReady()
    expect(financeRouter.currentRoute.value.name).toBe('home')
  })

  it('limits conversation content audit to super administrators', async () => {
    const superRouter = createAppRouter({ history: createMemoryHistory(), role: 'super_admin' })
    await superRouter.push('/conversation-audit')
    await superRouter.isReady()
    expect(superRouter.currentRoute.value.name).toBe('conversation-audit')

    const adminRouter = createAppRouter({ history: createMemoryHistory(), role: 'admin' })
    await adminRouter.push('/conversation-audit')
    await adminRouter.isReady()
    expect(adminRouter.currentRoute.value.name).toBe('home')
  })

  it('allows administrators to inspect settings but keeps finance out', async () => {
    const adminRouter = createAppRouter({ history: createMemoryHistory(), role: 'admin' })
    await adminRouter.push('/settings')
    await adminRouter.isReady()
    expect(adminRouter.currentRoute.value.name).toBe('settings')

    const financeRouter = createAppRouter({ history: createMemoryHistory(), role: 'finance' })
    await financeRouter.push('/settings')
    await financeRouter.isReady()
    expect(financeRouter.currentRoute.value.name).toBe('home')
  })
})
