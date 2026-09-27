import { describe, expect, it } from 'vitest'
import { compactChatRequest, compactResponsesRequest } from './context-optimizer.js'

const policy = { enabled: true, maxInputChars: 4_000, maxMessages: 3 }

describe('context optimizer', () => {
  it('forwards only the user query embedded by a system reminder', () => {
    const result = compactChatRequest({
      model: 'gpt-5.6-sol',
      messages: [{
        role: 'user',
        content: '<system-reminder>very long injected instructions that must not reach the upstream</system-reminder><user_query>只保留这句员工输入</user_query>',
      }],
    }, policy)

    expect(result.request.messages[0]?.content).toBe('只保留这句员工输入')
    expect(result.metrics.strippedChars).toBeGreaterThan(0)
  })

  it('keeps the current turn while bounding replayed history', () => {
    const result = compactChatRequest({
      model: 'gpt-5.6-sol',
      messages: [
        { role: 'system', content: '真实系统规则' },
        { role: 'user', content: 'old-1' },
        { role: 'assistant', content: 'old-2' },
        { role: 'user', content: 'latest employee question' },
      ],
    }, { ...policy, maxMessages: 2 })

    expect(result.request.messages).toHaveLength(2)
    expect(result.request.messages.at(-1)?.content).toBe('latest employee question')
    expect(result.metrics.droppedMessages).toBe(2)
  })

  it('removes injected blocks from native Responses text parts', () => {
    const result = compactResponsesRequest({
      model: 'gpt-5.6-sol',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<memory>old work memory</memory><user_query>需要处理的事项</user_query>' }] }],
    }, policy)

    const item = result.request.input as Array<Record<string, unknown>>
    expect((item[0]?.content as Array<Record<string, unknown>>)[0]?.text).toBe('需要处理的事项')
    expect(result.metrics.strippedChars).toBeGreaterThan(0)
  })
})
