// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from 'vue'
import ModelsView from './views/ModelsView.vue'
import { fetchModels, type ModelItem, type ModelsResponse } from './models-api'

vi.mock('./models-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./models-api')>(), fetchModels: vi.fn() }))

function model(index: number): ModelItem {
  return {
    id: `model-${index}`,
    displayName: `模型 ${index}`,
    provider: 'relay',
    actualModel: `model-${index}`,
    aliases: [],
    capabilities: [],
    contextWindow: null,
    region: 'local',
    environment: 'production',
    status: 'available',
    pricing: null,
    purposes: [],
    channelIds: [],
    channels: [],
  }
}

function response(): ModelsResponse {
  const items = Array.from({ length: 11 }, (_, index) => model(index + 1))
  return {
    meta: { source: 'owned', generatedAt: '2026-09-27T10:00:00.000Z', notice: '本地模型目录' },
    summary: { total: items.length, available: items.length, degraded: 0, production: items.length, experiment: 0 },
    options: { capabilities: [] },
    items,
    total: items.length,
  }
}

let host: HTMLDivElement
let app: App

beforeEach(() => {
  vi.resetAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  vi.mocked(fetchModels).mockResolvedValue(response())
})

afterEach(() => { app?.unmount(); host.remove() })

describe('models view', () => {
  it('shows no more than ten models at a time and uses the shared pager', async () => {
    app = createApp(ModelsView)
    app.mount(host)

    await vi.waitFor(() => expect(host.querySelectorAll('.models-table tbody tr')).toHaveLength(10))
    expect(host.querySelector('[aria-label="模型目录分页"]')).not.toBeNull()
    expect(host.textContent).not.toContain('模型 11')

    host.querySelector<HTMLButtonElement>('[aria-label="下一页"]')?.click()
    await vi.waitFor(() => expect(host.textContent).toContain('模型 11'))
    expect(host.querySelectorAll('.models-table tbody tr')).toHaveLength(1)
  })
})
