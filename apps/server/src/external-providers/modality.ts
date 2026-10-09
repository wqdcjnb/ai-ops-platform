import type { ExternalProviderModality } from './schemas.js'
export const modalityOrder: readonly ExternalProviderModality[] = ['text', 'image', 'video', 'audio']

export function modalityLabel(modality: ExternalProviderModality) {
  return ({ text: '文本', image: '图片', video: '视频', audio: '语音' })[modality]
}

export function modalityFromHint(hint: string): ExternalProviderModality | null {
  const normalized = hint.toLowerCase().replace(/[\s_-]+/g, '')
  if(/(?:image|photo|picture|flux|diffusion|t2i|i2i|imagen|imagine)/.test(normalized)) return 'image'
  if(/(?:video|movie|kling|seedance|veo|sora|t2v|i2v|v2v)/.test(normalized)) return 'video'
  if(/(?:audio|speech|voice|tts|asr|stt|music|transcri)/.test(normalized)) return 'audio'
  if(/(?:text|chat|completion|reasoning|language|code|llm)/.test(normalized)) return 'text'
  return null
}

/**
 * `/models` is not a capability contract across relay implementations. Use
 * metadata when an upstream gives it, otherwise apply deliberately narrow
 * naming hints for well-known media families. Unknown models remain text
 * candidates so ordinary Chat/Responses models keep working. The value is
 * only used internally for endpoint routing and never rendered as a claimed
 * employee-facing capability.
 */
export function inferExternalProviderModelModalities(modelId: string, capabilityHints: readonly string[] = []): ExternalProviderModality[] {
  const inferred = new Set<ExternalProviderModality>()
  for(const hint of capabilityHints) {
    const modality = modalityFromHint(hint)
    if(modality) inferred.add(modality)
  }

  const normalizedId = modelId.toLowerCase()
  if(/(?:^|[-_/.])(?:image|flux|sdxl|stable[-_]?diffusion|imagen|imagine|wanx|hunyuanimage|kolors|cogview|seedream|t2i|i2i)(?:$|[-_/.])|(?:image|flux|sdxl|stable[-_]?diffusion|imagen|imagine|wanx|hunyuanimage|kolors|cogview|seedream|t2i|i2i)/.test(normalizedId)) inferred.add('image')
  if(/(?:video|kling|seedance|wan[-_]?2|veo|hunyuanvideo|sora|cogvideo|t2v|i2v|v2v)/.test(normalizedId)) inferred.add('video')
  if(/(?:tts|speech|whisper|asr|stt|audio|music|voice|bark|cosyvoice|fishaudio)/.test(normalizedId)) inferred.add('audio')

  // A catalog that only labels a model as media should not be sent to the
  // Chat/Responses endpoint. Otherwise retain text as the safe default.
  if(!inferred.size) inferred.add('text')
  return modalityOrder.filter((modality) => inferred.has(modality))
}
