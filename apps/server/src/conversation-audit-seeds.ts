export interface ConversationAuditMetadataSeed {
  id: string
  requestId: string
  capturedAt: string
  personId: string
  key: { id: string; masked: string }
  purpose: { id: string; label: string }
  model: { id: string; label: string }
  policy: { id: string; label: string; scope: string; expiresAt: string }
  state: 'captured' | 'metadata_only' | 'expired'
  redaction: { status: 'passed' | 'review_required' | 'not_applicable'; findings: number }
  grouping: { type: 'conversation' | 'independent_call'; reliable: boolean; label: string }
  metrics: { turns: number; toolCalls: number; totalTokens: number }
  contentAccessAvailable: boolean
}

export interface ConversationUsageLinkSeed {
  recordId: string
  usageRequestId: string
  linkSource: 'synthetic_seed'
}

const ago = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()
const after = (now: Date, minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString()

export function createConversationAuditMetadataSeeds(now: Date): ConversationAuditMetadataSeed[] {
  return [
    { id: 'conv-audit-copy-01', requestId: 'req-260915-8f31', capturedAt: ago(now, 18), personId: 'person-lin', key: { id: 'key-lin-1', masked: 'sk-ops••••••7F2A' }, purpose: { id: 'purpose-copy', label: '商品文案' }, model: { id: 'gpt-5.5', label: 'GPT-5.5' }, policy: { id: 'policy-key-lin', label: '林筱雨测试 Key', scope: '指定 Key', expiresAt: after(now, 2_820) }, state: 'captured', redaction: { status: 'passed', findings: 2 }, grouping: { type: 'conversation', reliable: true, label: '会话 conv-demo-copy-01' }, metrics: { turns: 3, toolCalls: 1, totalTokens: 2_430 }, contentAccessAvailable: true },
    { id: 'conv-audit-support-02', requestId: 'req-260915-a217', capturedAt: ago(now, 72), personId: 'person-xu', key: { id: 'key-xu-2', masked: 'sk-ops••••••A921' }, purpose: { id: 'purpose-support', label: '客服回复' }, model: { id: 'gpt-5.5', label: 'GPT-5.5' }, policy: { id: 'policy-purpose-support', label: '客服质检试点', scope: '指定用途', expiresAt: after(now, 1_380) }, state: 'captured', redaction: { status: 'review_required', findings: 4 }, grouping: { type: 'conversation', reliable: true, label: '会话 conv-demo-support-02' }, metrics: { turns: 5, toolCalls: 0, totalTokens: 3_980 }, contentAccessAvailable: true },
    { id: 'conv-audit-independent-03', requestId: 'req-260915-b903', capturedAt: ago(now, 155), personId: 'person-zhou', key: { id: 'key-zhou-1', masked: 'sk-ops••••••8B14' }, purpose: { id: 'purpose-analysis', label: '策略分析' }, model: { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }, policy: { id: 'policy-person-zhou', label: '周明远排障窗口', scope: '指定人员', expiresAt: after(now, 540) }, state: 'captured', redaction: { status: 'passed', findings: 1 }, grouping: { type: 'independent_call', reliable: false, label: '独立调用' }, metrics: { turns: 1, toolCalls: 2, totalTokens: 1_860 }, contentAccessAvailable: true },
    { id: 'conv-audit-metadata-04', requestId: 'req-260915-c114', capturedAt: ago(now, 230), personId: 'person-chen', key: { id: 'key-chen-1', masked: 'sk-ops••••••3C91' }, purpose: { id: 'purpose-copy', label: '商品文案' }, model: { id: 'gpt-5.5', label: 'GPT-5.5' }, policy: { id: 'policy-disabled', label: '默认关闭', scope: '未命中策略', expiresAt: after(now, 43_200) }, state: 'metadata_only', redaction: { status: 'not_applicable', findings: 0 }, grouping: { type: 'independent_call', reliable: false, label: '独立调用' }, metrics: { turns: 0, toolCalls: 0, totalTokens: 820 }, contentAccessAvailable: false },
    { id: 'conv-audit-expired-05', requestId: 'req-260914-d702', capturedAt: ago(now, 1_460), personId: 'person-lin', key: { id: 'key-lin-1', masked: 'sk-ops••••••7F2A' }, purpose: { id: 'purpose-copy', label: '商品文案' }, model: { id: 'gpt-5.5', label: 'GPT-5.5' }, policy: { id: 'policy-key-lin-old', label: '历史测试窗口', scope: '指定 Key', expiresAt: after(now, -20) }, state: 'expired', redaction: { status: 'passed', findings: 1 }, grouping: { type: 'conversation', reliable: true, label: '会话 conv-demo-expired-05' }, metrics: { turns: 4, toolCalls: 1, totalTokens: 2_910 }, contentAccessAvailable: false },
    { id: 'conv-audit-research-06', requestId: 'req-260913-e420', capturedAt: ago(now, 2_780), personId: 'person-lin', key: { id: 'key-lin-3', masked: 'sk-ops••••••D410' }, purpose: { id: 'purpose-research', label: '资料整理' }, model: { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' }, policy: { id: 'policy-person-lin', label: '内容团队试点', scope: '指定人员', expiresAt: after(now, 5_760) }, state: 'captured', redaction: { status: 'passed', findings: 3 }, grouping: { type: 'conversation', reliable: true, label: '会话 conv-demo-research-06' }, metrics: { turns: 7, toolCalls: 3, totalTokens: 8_240 }, contentAccessAvailable: true },
    { id: 'conv-audit-metadata-07', requestId: 'req-260912-f815', capturedAt: ago(now, 4_310), personId: 'person-xu', key: { id: 'key-xu-3', masked: 'sk-ops••••••F055' }, purpose: { id: 'purpose-summary', label: '会议纪要' }, model: { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }, policy: { id: 'policy-disabled', label: '默认关闭', scope: '未命中策略', expiresAt: after(now, 43_200) }, state: 'metadata_only', redaction: { status: 'not_applicable', findings: 0 }, grouping: { type: 'independent_call', reliable: false, label: '独立调用' }, metrics: { turns: 0, toolCalls: 0, totalTokens: 1_120 }, contentAccessAvailable: false },
  ]
}

export function createConversationUsageLinkSeeds(): ConversationUsageLinkSeed[] {
  return [
    { recordId: 'conv-audit-copy-01', usageRequestId: 'req-demo-001', linkSource: 'synthetic_seed' },
    { recordId: 'conv-audit-support-02', usageRequestId: 'req-demo-003', linkSource: 'synthetic_seed' },
    { recordId: 'conv-audit-independent-03', usageRequestId: 'req-demo-002', linkSource: 'synthetic_seed' },
    { recordId: 'conv-audit-metadata-04', usageRequestId: 'req-demo-010', linkSource: 'synthetic_seed' },
    { recordId: 'conv-audit-expired-05', usageRequestId: 'req-demo-009', linkSource: 'synthetic_seed' },
    { recordId: 'conv-audit-research-06', usageRequestId: 'req-demo-005', linkSource: 'synthetic_seed' },
    { recordId: 'conv-audit-metadata-07', usageRequestId: 'req-demo-007', linkSource: 'synthetic_seed' },
  ]
}
