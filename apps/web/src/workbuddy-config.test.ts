import { describe, expect, it } from 'vitest'
import { buildWorkBuddyModelsConfig, workBuddyChatCompletionsUrl } from './workbuddy-config'

describe('WorkBuddy models.json export', () => {
  it('builds an OpenAI-compatible model entry without restricting existing models', () => {
    const config = buildWorkBuddyModelsConfig({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test-secret-value-1234567890',
      model: 'gpt-5.6-sol',
    })

    expect(config).toEqual({
      models: [{
        id: 'gpt-5.6-sol',
        name: 'AI OPS ',
        vendor: 'AI OPS',
        apiKey: 'sk-test-secret-value-1234567890',
        url: 'https://api.example.com/v1/chat/completions',
        supportsToolCall: true,
        supportsImages: false,
      }],
    })
    expect('availableModels' in config).toBe(false)
  })

  it('does not duplicate an already-complete chat completions path', () => {
    expect(workBuddyChatCompletionsUrl('http://127.0.0.1:3000/v1/chat/completions')).toBe('http://127.0.0.1:3000/v1/chat/completions')
  })

  it('does not export an image-only model as a chat model', () => {
    expect(() => buildWorkBuddyModelsConfig({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test-secret-value-1234567890',
      model: 'gpt-image-2.5',
    })).toThrow('WorkBuddy 仅支持 Chat Completions 模型')
  })

  it('refuses a masked Key even when its rendered length looks valid', () => {
    expect(() => buildWorkBuddyModelsConfig({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-MWZ••••••••••••••••••MDQT',
      model: 'gpt-5.6-sol',
    })).toThrow('未读取到完整 Key')
  })
})
