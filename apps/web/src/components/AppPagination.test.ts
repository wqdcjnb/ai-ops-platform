// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from 'vue'
import AppPagination from './AppPagination.vue'

let host: HTMLDivElement
let app: App

afterEach(() => {
  app?.unmount()
  host?.remove()
})

describe('AppPagination', () => {
  it('shows a compact single-page state with disabled navigation', () => {
    host = document.createElement('div')
    document.body.append(host)
    app = createApp(AppPagination, { page: 1, totalPages: 1, total: 3 })
    app.mount(host)

    expect(host.textContent).toContain('3 条记录')
    expect(host.textContent).toContain('1 / 1')
    expect(host.querySelector<HTMLButtonElement>('[aria-label="上一页"]')?.disabled).toBe(true)
    expect(host.querySelector<HTMLButtonElement>('[aria-label="下一页"]')?.disabled).toBe(true)
  })

  it('uses arrows to move through pages without rendering page buttons', () => {
    const onChange = vi.fn()
    host = document.createElement('div')
    document.body.append(host)
    app = createApp(AppPagination, { page: 5, totalPages: 10, onChange })
    app.mount(host)

    expect(host.textContent).toContain('5 / 10')
    expect(host.querySelector('[aria-current="page"]')).toBeNull()
    host.querySelector<HTMLButtonElement>('[aria-label="下一页"]')?.click()
    expect(onChange).toHaveBeenCalledWith(6)
  })
})
