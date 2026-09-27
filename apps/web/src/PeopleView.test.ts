// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from 'vue'
import PeopleView from './views/PeopleView.vue'
import { fetchPeople, type PeopleResponse } from './people-api'

vi.mock('./people-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./people-api')>(), fetchPeople: vi.fn() }))

function response(): PeopleResponse {
  return {
    meta: { source: 'database', generatedAt: '2026-09-27T10:00:00.000Z', timezone: 'Asia/Shanghai', notice: '本地身份库' },
    summary: { total: 3, active: 3, disabled: 0 },
    items: [
      { id: 'person-1', name: '甲员工', initials: '甲', title: '员工', status: 'active', username: 'first@example.com', createdAt: '2026-09-01T08:00:00.000Z', lastUsedAt: '2026-09-05T08:00:00.000Z', apiKeyMasked: null, keyCount: 1, tone: 'blue' },
      { id: 'person-2', name: '乙员工', initials: '乙', title: '员工', status: 'active', username: 'second@example.com', createdAt: '2026-09-03T08:00:00.000Z', lastUsedAt: null, apiKeyMasked: null, keyCount: 1, tone: 'green' },
      { id: 'person-3', name: '丙员工', initials: '丙', title: '员工', status: 'active', username: 'third@example.com', createdAt: '2026-09-02T08:00:00.000Z', lastUsedAt: '2026-09-04T08:00:00.000Z', apiKeyMasked: null, keyCount: 1, tone: 'violet' },
    ],
    page: 1,
    pageSize: 10,
    total: 3,
  }
}

let host: HTMLDivElement
let app: App
function mount() { app = createApp(PeopleView); app.mount(host) }
function sortButton(label: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>('th button')].find((button) => button.textContent?.includes(label))
  if (!found) throw new Error(`Missing ${label} sort button`)
  return found
}
function names() { return [...host.querySelectorAll('.person-cell strong')].map((node) => node.textContent?.trim()) }

beforeEach(() => {
  vi.resetAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  vi.mocked(fetchPeople).mockResolvedValue(response())
})
afterEach(() => { app?.unmount(); host.remove() })

describe('people view', () => {
  it('removes the redundant heading description and sorts both time columns', async () => {
    mount()
    await vi.waitFor(() => expect(names()).toEqual(['甲员工', '乙员工', '丙员工']))
    expect(fetchPeople).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }), expect.any(AbortSignal))
    expect(host.querySelector('[aria-label="人员信息管理分页"]')).not.toBeNull()
    expect(host.textContent).not.toContain('员工自助注册；管理员只维护人员状态')

    const createdAt = sortButton('创建时间')
    createdAt.click()
    await vi.waitFor(() => expect(names()).toEqual(['乙员工', '丙员工', '甲员工']))
    expect(createdAt.closest('th')?.getAttribute('aria-sort')).toBe('descending')

    createdAt.click()
    await vi.waitFor(() => expect(names()).toEqual(['甲员工', '丙员工', '乙员工']))
    expect(createdAt.closest('th')?.getAttribute('aria-sort')).toBe('ascending')

    const lastUsedAt = sortButton('最后使用')
    lastUsedAt.click()
    await vi.waitFor(() => expect(names()).toEqual(['甲员工', '丙员工', '乙员工']))
    expect(createdAt.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    expect(lastUsedAt.closest('th')?.getAttribute('aria-sort')).toBe('descending')

    lastUsedAt.click()
    await vi.waitFor(() => expect(names()).toEqual(['丙员工', '甲员工', '乙员工']))
    expect(createdAt.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    expect(lastUsedAt.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
  })
})
