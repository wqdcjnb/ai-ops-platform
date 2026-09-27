import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExternalProviderRegistry, inferExternalProviderModelModalities } from './external-providers.js'

const temporaryDirectories: string[] = []

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('external provider model selection and testing', () => {
  it('classifies Grok Imagine edit models as image models instead of text models', () => {
    expect(inferExternalProviderModelModalities('grok-imagine-edit')).toEqual(['image'])
  })

  it('persists only selected discovered models and reports useful per-model test states', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ops-external-provider-'))
    temporaryDirectories.push(directory)
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/models')) {
        return response({ data: [
          { id: 'text-model', object: 'model', created: 0, owned_by: 'test' },
          { id: 'image-model', object: 'model', created: 0, owned_by: 'test' },
        ] })
      }
      if (url.endsWith('/chat/completions')) {
        const payload = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
        if (payload.model === 'text-model') return response({ id: 'chat-test', object: 'chat.completion', created: 0, model: 'text-model', choices: [] })
        return response({ error: { message: 'text probe unsupported' } }, 400)
      }
      return response({ error: { message: 'not found' } }, 404)
    }))

    const registry = createExternalProviderRegistry({
      filePath: join(directory, 'external-providers.json'),
      allowedHosts: ['relay.example.test'],
    })

    const provider = await registry.createVerified({
      name: '测试账号',
      baseUrl: 'https://relay.example.test/v1',
      apiKey: 'test-secret',
      modelIds: ['text-model', 'image-model'],
      enabled: true,
    })

    expect(provider.id).toMatch(/^relay-/)
    expect(provider.models.map((model) => model.upstreamId)).toEqual(['text-model', 'image-model'])
    expect(registry.listPlatformRoutes('text').map((route) => route.upstreamModelId)).toEqual(['text-model'])
    expect(registry.listPlatformRoutes('image').map((route) => route.upstreamModelId)).toEqual(['image-model'])

    const report = await registry.testModels({
      baseUrl: 'https://relay.example.test/v1',
      apiKey: 'test-secret',
      modelIds: ['text-model', 'image-model', 'missing-model'],
    })

    expect(report.catalogLatencyMs).toBeGreaterThanOrEqual(1)
    expect(report.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'text-model', status: 'available' }),
      expect.objectContaining({ id: 'image-model', status: 'catalog_confirmed', message: expect.stringContaining('图片模型') }),
      expect.objectContaining({ id: 'missing-model', status: 'unavailable' }),
    ]))
  })

  it('falls back to the Responses contract when Chat Completions is unavailable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ops-external-provider-responses-'))
    temporaryDirectories.push(directory)
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/models')) return response({ data: [{ id: 'responses-only-model' }] })
      if (url.endsWith('/chat/completions')) return response({ error: { message: 'not found' } }, 404)
      if (url.endsWith('/responses')) return response({ id: 'resp-test', object: 'response', model: 'responses-only-model', output: [] })
      return response({ error: { message: 'not found' } }, 404)
    }))
    const registry = createExternalProviderRegistry({
      filePath: join(directory, 'registry.json'),
      allowedHosts: ['relay.example.test'],
    })

    const report = await registry.testModels({
      baseUrl: 'https://relay.example.test/v1',
      apiKey: 'test-secret',
      modelIds: ['responses-only-model'],
    })

    expect(report.results).toEqual([
      expect.objectContaining({ id: 'responses-only-model', status: 'available', message: expect.stringContaining('Responses') }),
    ])
  })

  it('reports exhausted account credit without attempting a second text protocol', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ops-external-provider-credit-'))
    temporaryDirectories.push(directory)
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/models')) return response({ data: [{ id: 'text-model' }] })
      if (url.endsWith('/chat/completions')) return response({ code: 30001, message: 'balance insufficient' }, 402)
      if (url.endsWith('/responses')) throw new Error('Responses should not be tried after a credit error')
      return response({ error: { message: 'not found' } }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    const registry = createExternalProviderRegistry({
      filePath: join(directory, 'registry.json'),
      allowedHosts: ['relay.example.test'],
    })

    const report = await registry.testModels({
      baseUrl: 'https://relay.example.test/v1',
      apiKey: 'test-secret',
      modelIds: ['text-model'],
    })

    expect(report.results).toEqual([
      expect.objectContaining({ id: 'text-model', status: 'unavailable', message: expect.stringContaining('余额或调用配额不足') }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('accepts public custom hosts by default, while preserving optional host restrictions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ops-external-provider-host-policy-'))
    temporaryDirectories.push(directory)
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: [{ id: 'model-a', object: 'model', created: 0, owned_by: 'test' }] })))

    const unrestricted = createExternalProviderRegistry({
      filePath: join(directory, 'unrestricted.json'),
      env: {},
    })
    await expect(unrestricted.discover({
      baseUrl: 'https://custom-provider.example.test/v1',
      apiKey: 'test-secret',
    })).resolves.toMatchObject({ models: ['model-a'] })

    const restricted = createExternalProviderRegistry({
      filePath: join(directory, 'restricted.json'),
      allowedHosts: ['approved-provider.example.test'],
    })
    await expect(restricted.discover({
      baseUrl: 'https://custom-provider.example.test/v1',
      apiKey: 'test-secret',
    })).rejects.toMatchObject({ code: 'EXTERNAL_PROVIDER_HOST_NOT_ALLOWED' })

    await expect(unrestricted.discover({
      baseUrl: 'https://127.0.0.1/v1',
      apiKey: 'test-secret',
    })).rejects.toMatchObject({ code: 'EXTERNAL_PROVIDER_HOST_NOT_ALLOWED' })
  })

  it('explains when the SiliconFlow console URL is entered instead of its API root', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ops-external-provider-siliconflow-'))
    temporaryDirectories.push(directory)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const registry = createExternalProviderRegistry({ filePath: join(directory, 'registry.json'), env: {} })

    await expect(registry.discover({
      baseUrl: 'https://cloud.siliconflow.cn/',
      apiKey: 'test-secret',
    })).rejects.toMatchObject({
      code: 'EXTERNAL_PROVIDER_URL_INVALID',
      message: expect.stringContaining('https://api.siliconflow.cn/v1'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reclassifies obvious legacy media model IDs after an upgrade', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ops-external-provider-migration-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'registry.json')
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: [{ id: 'Wan-AI/Wan2.2-T2V-A14B' }] })))
    const registry = createExternalProviderRegistry({ filePath, env: {} })
    await registry.createVerified({
      name: '旧媒体账号',
      baseUrl: 'https://legacy-media.example.test/v1',
      apiKey: 'test-secret',
      modelIds: ['Wan-AI/Wan2.2-T2V-A14B'],
      enabled: true,
    })
    const persisted = JSON.parse(readFileSync(filePath, 'utf8')) as { providers: Array<{ models: Array<Record<string, unknown>> }> }
    delete persisted.providers[0]!.models[0]!.modalities
    writeFileSync(filePath, JSON.stringify(persisted), 'utf8')

    const reloaded = createExternalProviderRegistry({ filePath, env: {} })
    expect(reloaded.listPlatformRoutes('video').map((route) => route.upstreamModelId)).toEqual(['Wan-AI/Wan2.2-T2V-A14B'])
    expect(reloaded.listPlatformRoutes('text')).toHaveLength(0)
  })

  it('returns an actionable message when the supplied Base URL does not expose a model catalog', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ops-external-provider-catalog-error-'))
    temporaryDirectories.push(directory)
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: { message: 'not found' } }, 404)))
    const registry = createExternalProviderRegistry({
      filePath: join(directory, 'registry.json'),
      env: {},
    })

    await expect(registry.discover({
      baseUrl: 'https://catalog-missing.example.test/v1',
      apiKey: 'test-secret',
    })).rejects.toMatchObject({
      code: 'EXTERNAL_PROVIDER_UNAVAILABLE',
      message: expect.stringContaining('Base URL'),
    })
  })

  it('discovers common API roots and persists the working root for later model calls', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ops-external-provider-root-detection-'))
    temporaryDirectories.push(directory)
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://root-provider.example.test/models') return response({ error: { message: 'not found' } }, 404)
      if (url === 'https://root-provider.example.test/v1/models') return response({ data: { models: [{ model: 'model-from-v1' }] } })
      return response({ error: { message: 'unexpected URL' } }, 404)
    }))
    const registry = createExternalProviderRegistry({
      filePath: join(directory, 'registry.json'),
      env: {},
    })

    const provider = await registry.createVerified({
      name: '根路径自动识别',
      baseUrl: 'https://root-provider.example.test',
      apiKey: 'test-secret',
      modelIds: ['model-from-v1'],
      enabled: true,
    })

    expect(provider.baseUrl).toBe('https://root-provider.example.test/v1')
    expect(provider.models.map((model) => model.upstreamId)).toEqual(['model-from-v1'])
  })
})
