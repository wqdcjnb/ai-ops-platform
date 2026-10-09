import { type ExternalProviderPreset } from './schemas.js'
export const builtInExternalProviderPresets: readonly ExternalProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    host: 'api.deepseek.com',
    description: '官方 OpenAI Responses / Chat Completions 接口；填写你的 DeepSeek API Key 后读取实际可用模型。',
  },
]

export function listExternalProviderPresets(): ExternalProviderPreset[] {
  return builtInExternalProviderPresets.map((preset) => ({ ...preset }))
}
