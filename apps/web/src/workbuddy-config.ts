export type WorkBuddyModelConfigInput = {
  baseUrl: string
  apiKey: string
  model: string
}

type WorkBuddyModel = {
  id: string
  name: string
  vendor: string
  apiKey: string
  url: string
  supportsToolCall: boolean
  supportsImages: boolean
}

export type WorkBuddyModelsConfig = {
  models: WorkBuddyModel[]
}

export const workBuddyConfigFileName = 'models.json'

function isImageOnlyModel(model: string) {
  return /(?:^|[-_/])(gpt-)?image(?:[-_/]|$)|(?:^|[-_/])dall-e(?:[-_/]|$)/i.test(model)
}

function isMaskedApiKey(apiKey: string) {
  // Do not export a superficially long mask such as sk-abc••••••xyz. The
  // configuration file must contain a real, directly usable credential.
  return /[*＊•●○◦▪▫…]/u.test(apiKey) || apiKey.includes('...')
}

export function workBuddyChatCompletionsUrl(baseUrl: string) {
  const url = new URL(baseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('WorkBuddy 配置需要 HTTP(S) 服务地址')
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/chat/completions') ? path : `${path || ''}/chat/completions`
  return url.toString()
}

export function buildWorkBuddyModelsConfig(input: WorkBuddyModelConfigInput): WorkBuddyModelsConfig {
  const model = input.model.trim()
  const apiKey = input.apiKey.trim()
  if (!model) throw new Error('该 Key 未绑定可导入的模型')
  if (isImageOnlyModel(model)) throw new Error('该 Key 绑定的是图像模型，WorkBuddy 仅支持 Chat Completions 模型')
  if (isMaskedApiKey(apiKey)) throw new Error('未读取到完整 Key，无法生成 WorkBuddy 配置')
  if (apiKey.length < 20) throw new Error('完整 Key 不可用，无法生成 WorkBuddy 配置')

  return {
    // Deliberately omit availableModels. WorkBuddy then retains the user's
    // existing model picker instead of hiding it behind this one export.
    models: [{
      id: model,
      name: 'AI OPS ',
      vendor: 'AI OPS',
      apiKey,
      url: workBuddyChatCompletionsUrl(input.baseUrl),
      supportsToolCall: true,
      supportsImages: false,
    }],
  }
}
