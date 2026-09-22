# 05｜New API 员工 Key

## 本步目标

在 AI OPS 中创建 New API Token/API Key，并满足以下不可变业务约束：

- 一个 Key 只能绑定一个人员。
- 一个 Key 只能绑定一个模型。
- 一个人员可以有多个 Key。
- 一个模型可以有多个 Key。
- 默认无限额度。
- 默认永不过期。
- 不使用分组。
- 员工拿到的只能是 New API Key，不是 CPA 凭据。

New API 是 Key 的最终来源和状态来源。AI OPS 只保存外部 ID、显示元数据和必要的审计关联。

## 前置条件

- [04｜人员同步](./04-people-sync) 已通过。
- New API 中已有一个 active 测试人员。
- [03｜New API 渠道同步](./03-new-api-channel) 已验证至少一个真实 CPA 模型可用。
- 已确认当前 New API 版本的用户 Token 创建、列表、禁用接口。
- 已确认模型限制字段、额度字段、过期字段的实际名称和单位。
- 超级管理员已登录 AI OPS。

## 1. 定义 Key 数据模型

建议 AI OPS 侧只保存以下元数据：

```typescript
type ManagedKey = {
  id: string
  externalTokenId: string
  personId: string
  model: string
  status: 'active' | 'disabled' | 'expired' | 'unknown'
  quotaMode: 'unlimited'
  expiresAt: null
  createdAt: string
  lastUsedAt: string | null
  lastSyncedAt: string
  secretRevealedAt: string | null
}
```

不要保存：

- 员工 Key 明文。
- CPA 客户端 Key。
- New API 管理 Token。
- 员工发送过来的 Prompt 或回复正文（正文由第 07 步独立存储）。
- 一个 Key 的多个模型列表。

如果 New API 返回的是 hash 或只显示末尾字符，AI OPS 只保存这些非敏感展示字段。

## 2. 创建请求

AI OPS 内部接口建议：

```text
POST /api/keys
```

请求只允许业务字段：

```json
{
  "personId": "new-api-user-id",
  "model": "实际来自 CPA 的模型 ID"
}
```

服务端必须重新校验，不信任前端下拉框：

1. 读取人员最新状态。
2. 确认人员来自 New API 且为 active。
3. 读取 CPA/同步后的真实模型列表。
4. 确认请求模型存在且属于 AI OPS 管理的 CPA 渠道。
5. 固定 quota 为 unlimited。
6. 固定 expiresAt 为 null。
7. 明确不传 group 或 group 为空。
8. 生成幂等操作 ID。
9. 调用 New API 创建 Token。
10. 重新读取 Token 详情确认最终字段。
11. 保存 externalTokenId 与人员/模型关系。
12. 只在创建成功时一次性返回明文 Key。

## 3. New API 字段映射

不同 New API 版本的 payload 名称可能不同，必须先做版本探测。需要映射的语义：

| 业务语义 | New API 字段要求 |
| --- | --- |
| 所属人员 | user_id / userId 等当前版本字段 |
| Key 名称 | 包含人员和模型的可读名称，但不要把秘密放名称中 |
| 模型限制 | 只能包含一个模型 ID |
| 渠道/分组 | 不设置分组；如果版本强制字段，使用项目定义的默认值并记录 |
| 额度 | 明确设置 unlimited 或当前版本的无限值 |
| 过期时间 | 明确设置 never/null |
| 状态 | 创建后应为 enabled/active |
| 幂等标识 | 使用 AI OPS 外部操作 ID或备注 marker |

如果当前 New API API 不支持单模型限制，必须停止本步并先扩展 New API 或增加服务端拦截；不能创建一个多模型 Key 后在页面上假装它只有一个模型。

## 4. 一次性展示规则

创建成功响应可以包含：

```json
{
  "id": "ai-ops-key-id",
  "personId": "user-id",
  "model": "model-id",
  "status": "active",
  "secret": "只返回这一次",
  "warning": "请立即复制；离开页面后不再显示完整 Key"
}
```

安全要求：

- 明文只在 TLS/本地受保护的 AI OPS 会话中短暂返回。
- 不写 server 日志、数据库、浏览器 localStorage、分析事件或错误追踪。
- 页面提供复制按钮，但复制动作不记录秘密。
- 刷新页面后不再显示明文。
- 如果 New API 无法再次显示明文，管理员只能禁用旧 Key 并创建新 Key。
- 导出文件如未来支持，必须由超级管理员明确触发，并默认不落盘。

## 5. 创建后的真实验证

使用一个测试人员和一个测试模型：

1. 在 AI OPS 选择人员。
2. 选择一个 CPA 实际返回的模型。
3. 确认页面显示无限额度、永不过期、无分组。
4. 点击创建。
5. 复制一次性 Key。
6. 使用该 Key 调用 New API 的兼容接口，发送一条无敏感内容的测试请求。
7. 确认请求实际路由到 CPA。
8. 使用同一个 Key 请求另一个模型，确认被 New API 拒绝。
9. 在 AI OPS 按 Key 查看人员、模型、状态和最后使用时间。
10. 刷新页面，确认明文不再出现。
11. 重复发送相同幂等操作，确认不会产生第二个 Token。

测试请求不要使用真实员工数据、真实 Prompt 或需要长期保存的内容。

## 6. 不能绕过的校验

服务端在每次创建和更新前都应检查：

- personId 是否属于当前 New API 用户。
- 人员是否 active。
- model 是否来自 CPA/渠道同步结果。
- model 是否是单值。
- quota 是否 unlimited。
- expiresAt 是否为空。
- group 是否为空。
- externalTokenId 是否已存在。
- 操作 ID 是否已成功执行。

任何校验失败都返回稳定错误码，例如：

```text
PERSON_NOT_ACTIVE
MODEL_NOT_AVAILABLE
MODEL_LIMIT_NOT_SUPPORTED
TOKEN_CREATE_FAILED
TOKEN_ALREADY_CREATED
NEW_API_UNAVAILABLE
```

不要用 200 状态加 error 字符串伪装成功。

## 7. 与现有本地 Key 代码的迁移

重点检查：

```text
apps/server/src/keys.ts
apps/server/src/app.ts
apps/web/src/views/KeysView.vue
apps/web/src/api/keys-api.ts
```

迁移顺序：

1. 增加 New API Token 只读查询。
2. 增加创建接口和响应校验。
3. 将本地记录改为外部 token_id 映射。
4. 加入人员和模型唯一约束。
5. 在测试环境验证后，再禁用本地演示创建。
6. 最后删除不再使用的本地秘密字段。

不要直接删除旧表；先让旧路由返回明确的“已迁移到 New API”错误或只读历史。

## 8. 本步验收

- [ ] 创建出的 Key 来自 New API。
- [ ] Key 绑定且只绑定一个人员。
- [ ] Key 绑定且只绑定一个模型。
- [ ] 同一人员可以创建多个不同 Key。
- [ ] 同一模型可以有多个 Key。
- [ ] Key 是无限额度、永不过期、无分组。
- [ ] 停用人员前创建被阻止。
- [ ] Key 明文只显示一次且未写入日志/数据库。
- [ ] 使用 Key 请求目标模型成功。
- [ ] 使用同一 Key 请求其他模型被拒绝。
- [ ] 重复提交具备幂等性。
- [ ] AI OPS 不要求管理员打开 New API 网站。

## 9. 回滚

创建失败或验证失败时：

- 如果 New API 已创建 Token 但本地保存失败，先用返回的 externalTokenId 查询并禁用它，再重试；不要盲目再次创建。
- 如果模型限制错误，禁用测试 Key，修复字段映射后重新创建。
- 不删除人员和 CPA 渠道。
- 不把明文 Key 写入临时日志以便“找回”。

回滚动作应是禁用测试 Token：

```text
通过 New API 管理接口将 externalTokenId 状态设置为 disabled
```

通过后进入 [06｜停用与生命周期联动](./06-lifecycle)。
