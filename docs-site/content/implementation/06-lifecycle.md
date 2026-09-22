# 06｜停用与生命周期联动

## 本步目标

建立人员、Key、渠道和审计记录之间的生命周期规则，确保人员停用后，其全部关联 New API Key 都失效。

核心规则：

- 人员状态由 New API 作为最终来源。
- 人员从 active 变为 disabled 后，不能创建新 Key。
- 该人员拥有的所有 New API Token 都必须被禁用。
- 禁用是幂等的，重复执行不会产生错误副作用。
- 审计历史保留，但后续不能继续产生成功调用。
- 不自动删除人员、Key 或正文记录。

## 前置条件

- [05｜New API 员工 Key](./05-new-api-key) 已通过。
- 至少存在一个测试人员和两个测试 Key，两个 Key 可以绑定同一人员的不同模型。
- 已确认 New API 用户停用、Token 列表、Token 禁用接口。
- AI OPS 已保存人员与 externalUserId、Key 与 externalTokenId 的映射。
- 已完成第 00 步备份。

## 1. 定义状态机

建议使用以下规范化状态：

```text
Person:
  active
  disabled
  external_missing
  unknown

Key:
  active
  disabled
  expired
  revoked
  unknown
```

状态转换：

| 当前 | 事件 | 目标 |
| --- | --- | --- |
| Person active | New API 停用 | disabled |
| Person active | 查询失败 | unknown，不自动停用 |
| Person disabled | 管理员重新启用并同步成功 | active |
| Person disabled | 创建 Key | 拒绝 |
| Key active | 人员停用 | disabled |
| Key active | New API 过期/撤销 | 以 New API 状态为准 |
| Key disabled | 人员重新启用 | 仍 disabled，不自动恢复 |
| 任意 | 找不到外部对象 | unknown 或 external_missing，保留历史 |

不要把“人员重新启用”解释为“自动恢复以前的 Key”。如需恢复，必须由超级管理员单独确认，并重新调用 New API。

## 2. 设计停用操作

AI OPS 内部接口建议：

```text
POST /api/people/:personId/disable
```

服务端流程：

1. 读取人员最新状态。
2. 如果 New API 已经 disabled，继续做 Key 对账，不重复执行无意义写入。
3. 调用 New API 停用用户（如果产品允许 AI OPS 管理此动作）。
4. 查询该用户的全部 Token，使用分页。
5. 对每个 active Token 调用禁用接口。
6. 重新读取用户和所有 Token。
7. 只有确认全部 Token 已 disabled，才把 AI OPS 操作标记为 succeeded。
8. 返回成功、已是停用、失败和未知数量。

如果业务决定只允许管理员在 New API 外部系统停用，则 AI OPS 的按钮应改为“刷新状态并执行 Key 联动”，不能假装自己完成了用户停用。

## 3. 防止部分成功

停用是可能部分成功的。例如 5 个 Key 中 4 个成功、1 个超时。必须保存操作记录：

```typescript
type LifecycleOperation = {
  operationId: string
  personId: string
  action: 'disable' | 'reconcile'
  targetTokenIds: string[]
  succeededTokenIds: string[]
  failedTokenIds: string[]
  startedAt: string
  finishedAt: string | null
  status: 'running' | 'succeeded' | 'partial' | 'failed'
}
```

重试规则：

- 只重试未成功或状态未知的 Token。
- 重新读取状态后，已经 disabled 的 Token 记为成功。
- 不重新创建 Token。
- 不把未知状态直接改成 active。
- 重复发送相同 operationId 必须返回原操作结果或继续未完成部分。

页面应明确显示“部分完成”，并提供“重试停用”按钮。

## 4. 人员列表和 Key 列表联动

人员详情页显示：

- 当前 New API 状态。
- 关联 Key 数量。
- active/disabled/unknown 数量。
- 最近一次联动操作。
- 失败 Token 的 request_id。

Key 列表按 Key 展示：

- Key ID 或末尾标识。
- 人员。
- 单一模型。
- New API 状态。
- 创建时间。
- 最后使用时间。
- 管理动作。

不要把一个人的多个 Key 合并成一个“总 Key”，也不要用人员状态覆盖 New API 返回的单 Key 状态。

## 5. 启用、撤销和轮换

建议分别定义：

### 启用人员

```text
POST /api/people/:personId/enable
```

只调用 New API 启用用户并重新同步。不会自动启用旧 Key。

### 撤销 Key

```text
POST /api/keys/:keyId/revoke
```

调用 New API 禁用或撤销指定 Token。撤销后不能恢复，具体以 New API 能力为准。

### 轮换 Key

轮换不是更新旧明文，而是：

1. 创建一个新 Key。
2. 验证新 Key 只能访问目标模型。
3. 把旧 Key 标记为待撤销。
4. 超级管理员确认后禁用旧 Key。
5. 将审计关联分别保留在旧、新 Key 上。

如果 New API 不支持原子切换，要在 UI 中清楚显示短暂并存窗口。

## 6. 失联和删除规则

当 New API 暂时不可达：

- 不执行批量停用。
- 不把现有 active Key 自动改为 disabled。
- 页面显示数据 stale/unknown。
- 恢复后先重新读取，再执行对账。

当外部人员被删除或找不到：

- 标记 external_missing。
- 阻止创建新 Key。
- 对已有 Key 按产品策略停用；建议默认停用，必须记录原因。
- 保留历史审计和关联，不物理删除。

## 7. 最小真实验证

准备同一人员的两个 Key：

1. 确认两个 Key 都 active。
2. 在 AI OPS 或 New API 发起人员停用。
3. 确认人员状态 disabled。
4. 确认两个 Key 都 disabled。
5. 尝试创建第三个 Key，必须被拒绝。
6. 使用两个旧 Key 调用 API，必须失败。
7. 查看历史审计，仍然可以按 Key 查询。
8. 重复点击停用，结果保持一致。
9. 恢复网络后执行一次对账，不能把 Key 自动恢复 active。
10. 重新启用人员，确认旧 Key 仍 disabled。

再模拟一个 Token 禁用失败，验证 partial 和重试流程。

## 8. 本步验收

- [ ] 人员停用会联动全部关联 Key。
- [ ] 一个 Key 失败不会让系统声称全部成功。
- [ ] 重试只处理未完成对象。
- [ ] 查询失败不会批量误停用。
- [ ] 停用人员不能创建新 Key。
- [ ] 重新启用人员不会自动恢复旧 Key。
- [ ] Key 级状态和人员级状态分别展示。
- [ ] 审计历史不因停用被删除。
- [ ] 操作具备 operationId、request_id 和可追踪结果。
- [ ] 重复执行是幂等的。

## 9. 回滚

生命周期联动出错时：

- 不自动重新启用已经成功禁用的 Key。
- 停止批量操作入口，保留已完成结果。
- 修复接口或权限后，只重试失败项。
- 若测试环境必须恢复，逐个由超级管理员明确启用，而不是批量回滚脚本。

通过后进入 [07｜真实 Prompt/回复审计](./07-audit)。
