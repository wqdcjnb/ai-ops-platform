# 07｜真实 Prompt/回复审计

## 本步目标

让超级管理员能够以 Key 为单位查看真实请求和真实回复正文，并满足：

- 记录真实 Prompt/输入正文。
- 记录真实回复正文。
- 记录流式回复的最终拼接正文和必要的分片状态。
- 能关联人员、单一模型、Key、请求 ID、时间和结果。
- 默认最多保留 30 天。
- 超级管理员可以复制和导出，但每次导出都可审计。
- 请求失败、取消或上游无正文时要明确标记，不伪造正文。

这是独立高风险步骤。第 01 到第 06 步只建立身份、渠道和 Key，不代表已经具备正文审计能力。

## 前置条件

- [06｜停用与生命周期联动](./06-lifecycle) 已通过。
- 已确认真实请求经过的边界：New API、CPA，或项目自有 server。
- 已确认是否能在该边界取得请求和回复正文，而不是只有 token 统计。
- 已为测试环境准备无敏感内容的 Prompt。
- 已确定磁盘容量、访问控制和 30 天清理策略。
- 超级管理员确认此功能的业务合规范围。

## 1. 先画出真实数据路径

在改代码前，记录一次真实调用的路径：

```text
员工客户端
  -> New API OpenAI 兼容入口
  -> New API 鉴权和模型限制
  -> CPA 渠道
  -> Codex 上游
  -> CPA/New API 返回流
  -> 员工客户端
```

必须选择一个能同时看到请求和回复正文的边界：

1. 优先使用 New API 已有的请求处理/日志扩展点。
2. 如果 New API 没有正文扩展点，再扩展 New API。
3. 如果 CPA 才能拿到真实 Codex 正文，再扩展 CPA 的处理边界。
4. 最后才考虑 AI OPS 受控审计代理；避免重复转发、重复计费和改变流式语义。

不要仅凭前端发送的内容记录 Prompt，因为那无法证明请求实际被 New API 接受，也无法覆盖直接调用 New API 的情况。

## 2. 事件数据模型

把元数据和正文分开。元数据可以保存在业务数据库，正文保存在受控的审计存储。

建议元数据：

```typescript
type AuditRecord = {
  id: string
  requestId: string
  keyId: string
  externalTokenId: string
  personId: string
  model: string
  endpoint: string
  startedAt: string
  completedAt: string | null
  status: 'streaming' | 'succeeded' | 'failed' | 'cancelled' | 'body_unavailable'
  httpStatus: number | null
  promptBodyRef: string | null
  responseBodyRef: string | null
  promptBytes: number | null
  responseBytes: number | null
  retentionUntil: string
  exportCount: number
}
```

正文内容至少要能还原：

- messages 的角色和正文。
- system/developer/user 内容。
- assistant 最终回复。
- 工具调用名称和参数（如果请求有工具）。
- 模型、温度、最大输出等必要请求参数。
- 是否流式。
- 终止原因。
- 上游错误正文（按敏感数据规则处理）。

如果正文包含图片、文件或多模态块，记录类型、大小和引用；不要把未知二进制直接当作文本。

## 3. 在请求边界采集

在 New API/CPA 请求处理处加入统一采集器：

```text
onRequestAccepted(metadata, requestBody)
onResponseChunk(requestId, chunk)
onResponseCompleted(requestId, finalBody)
onRequestFailed(requestId, error)
onRequestCancelled(requestId)
```

要求：

- 只有鉴权成功、模型限制通过的请求才创建完整审计记录。
- 记录 key_id/token_id，而不是把原始 Key 明文写进去。
- 以 request_id 贯穿 New API、CPA 和 AI OPS 日志。
- 流式响应按 request_id 追加，完成时生成最终正文。
- 客户端中断时保存已收到的部分，并标记 cancelled。
- 解析失败时保存 body_unavailable 和原因，不生成假正文。
- 采集失败不能改变上游请求的成功/失败语义；但必须有监控和告警。

如果系统需要保证“绝不漏正文”，则采集器写入失败时应按产品选择阻断请求，而不是静默放行。这个选择必须在上线前明确记录。

## 4. 正文存储和加密

正文属于高敏感业务数据。建议：

- 元数据与正文分开存储。
- 正文按 request_id/key_id 分片。
- 传输和静态存储都加密。
- 加密密钥只在 server 运行时注入。
- 数据库只保存正文引用和哈希；是否保存可搜索明文由产品决定。
- 管理员查询时按权限读取，默认分页和限长。
- 导出生成短期一次性文件或流，不写公共静态目录。

禁止：

- 将 Prompt/回复写入普通 application log。
- 将正文发送到第三方分析服务。
- 将正文写入浏览器 localStorage。
- 将完整正文放进错误追踪事件。
- 用 Token 明文作为目录名、文件名或查询参数。

## 5. 30 天保留与清理

默认 retentionUntil 为请求完成时间加 30 天。清理任务必须：

1. 只删除 retentionUntil 已过期的正文和对应元数据。
2. 先记录删除批次、数量和范围。
3. 失败可重试，不能重复删除未到期数据。
4. 删除后无法在 UI 查到正文，并显示已过期。
5. 对备份、对象存储和数据库副本同时制定保留策略。
6. 清理任务本身不记录正文。

建议提供只读统计：

```text
GET /api/audit/retention/status
```

返回数量、最早保留时间、上次清理时间、失败数，不返回正文。

## 6. 按 Key 查看

AI OPS 审计页面的主入口应是 Key，而不是人员或全局日志：

```text
GET /api/keys/:keyId/audits
GET /api/audits/:auditId
POST /api/audits/:auditId/export
```

列表字段：

- request_id
- Key 标识和末尾展示
- 人员
- 单一模型
- 开始/完成时间
- 状态
- Prompt 是否可用
- 回复是否可用
- 保留到期时间

详情页：

- 默认先显示元数据。
- 超级管理员明确点击后加载 Prompt。
- 明确点击后加载回复正文。
- 流式未完成时显示已收集部分。
- 已过期、未采集或采集失败时显示准确原因。
- 复制正文时生成 audit event。

不能通过人员详情一次性加载所有 Key 的全部正文，避免权限和性能失控。

## 7. 复制和导出审计

复制和导出都属于敏感操作：

- 只允许超级管理员。
- 每次记录 operator、audit_id/key_id、时间、字段类型和结果。
- 复制不记录正文内容本身。
- 导出默认包含元数据和正文，必须二次确认。
- 导出文件设置短期有效、不可预测名称。
- 下载完成或过期后删除临时文件。
- 导出失败不能把正文写入错误日志。
- 如要支持批量导出，先限制数量和时间范围。

## 8. 最小真实验证

使用一个测试 Key，发送以下几类请求：

1. 普通非流式请求。
2. 流式请求。
3. 多轮 messages 请求。
4. 带工具调用的请求（如果模型支持）。
5. 上游报错请求。
6. 客户端中断请求。
7. 使用错误模型的拒绝请求。
8. Key 被停用后的请求。

逐项检查：

- Prompt 正文是否与实际请求一致。
- 回复正文是否与客户端最终看到的一致。
- 流式分片是否被正确拼接。
- request_id 是否贯穿 New API、CPA 和 AI OPS。
- 拒绝请求是否没有伪造成功回复。
- 失败请求是否记录正确状态。
- 按 Key 筛选不会显示其他 Key 的正文。
- 复制和导出都有审计事件。
- 手工把 retentionUntil 调到过去后，清理任务能删除正文。

测试完成后立即删除测试正文或等待清理，不要使用真实员工数据。

## 9. 本步验收

- [ ] 能按 Key 查看请求列表。
- [ ] 能查看真实 Prompt 正文。
- [ ] 能查看真实回复正文。
- [ ] 非流式、流式、失败和中断状态都有明确结果。
- [ ] 每条记录能关联人员、单一模型、Key 和 request_id。
- [ ] 不记录任何 Key 明文或上游管理凭据。
- [ ] 正文不出现在普通日志、前端缓存和错误追踪中。
- [ ] 默认保留不超过 30 天。
- [ ] 过期清理有结果记录且不会误删未到期数据。
- [ ] 超级管理员可以复制/导出，且操作可追踪。
- [ ] 不同 Key 之间严格隔离。
- [ ] New API/CPA 版本升级后有契约测试防止正文丢失。

## 10. 失败处理与回滚

如果正文采集造成请求失败、延迟或流式异常：

1. 关闭正文采集开关，但保留元数据和错误监控。
2. 不删除已经保存的审计正文。
3. 恢复上一版请求处理代码。
4. 重新执行非流式和流式测试。
5. 在确认边界和存储修复前，不宣称“支持完整审计”。

如果发现正文落入普通日志，立即停止日志采集并清理受影响日志/备份，记录范围；不要把泄露内容复制到新的诊断记录中。

通过后进入 [08｜清理与发布](./08-cleanup-release)。
