# 04｜人员同步

## 本步目标

把 New API 中的普通用户自动映射为 AI OPS 的人员数据，使超级管理员可以在 AI OPS 选择员工。两端按 `externalUserId` 保持对应；管理员账号不进入人员目录。AI OPS 不再维护一套与 New API 脱节的演示人员。

当前人员管理页面建议至少展示：

- id（必填）
- 姓名（必填）
- 部门（必填）
- 状态（可为空）
- 创建时间（可为空）
- 最后使用时间（可为空）
- 管理

页面首次打开时，状态筛选默认选择 `active`（在职）；管理员仍可切换到全部、已停用、未知和外部已找不到。尚未完成首次同步时显示明确的“尚未同步 New API 用户”空状态，不展示本地演示人员。页面不提供手动同步按钮，读取人员列表时自动刷新两端对应关系。

本步不创建员工 Key，不修改人员额度，不创建分组。

## 前置条件

- [03｜New API 渠道同步](./03-new-api-channel) 已通过。
- New API 管理 Token 已在 server 侧配置。
- 已确认当前 New API 版本的用户列表、用户详情、启用/禁用接口。
- 已确认 New API 的用户字段和分页规则。
- 已有一个测试用户，或允许在测试环境创建一个测试用户。

## 1. 定义人员映射

在 AI OPS 内部定义最小稳定模型：

```typescript
type Person = {
  id: string
  name: string
  department: {
    id: string
    name: string
  }
  username: string | null
  status: 'active' | 'disabled' | 'unknown' | null
  createdAt: string | null
  lastUsedAt: string | null
  source: 'new-api'
  externalUserId: string
  syncedAt: string
}
```

业务人员信息只有三项必填：`id`、`name`（姓名）和 `department`（部门）。`username`、`status`、`createdAt`、`lastUsedAt` 等其它业务字段允许为空；为空时分别按未知或空值展示，不得用猜测值补齐。`source`、`externalUserId`、`syncedAt` 是同步产生的内部追踪字段，不要求管理员手工填写。

New API 与 AI OPS 使用两个独立的 SQLite 文件，不能把 New API 的 `users` 表直接挂载给 AI OPS：两边的 `role`、密码、额度和 Key 字段定义不同，直接共用文件会破坏其中一方的迁移和安全边界。本项目采用“一个主表 + 一个镜像”的数据契约：New API `users` 是人员主数据，AI OPS `person_sync_records` 按 `external_user_id` 保存对应字段和本地扩展；页面只读镜像，不能再产生只存在于 AI OPS 的人员。

字段规则：

| AI OPS 字段 | New API 来源 | 规则 |
| --- | --- | --- |
| id | New API user id 或已有稳定人员 ID | 必填，作为人员稳定身份；不得用每次随机生成的 ID 覆盖已有 ID |
| name | New API `username`；缺失时使用 `display_name` | 必填；按当前 New API 用户管理页的字段契约显示 |
| department | New API `department`/`department_name`；当前版本缺失时使用 `display_name`，再回退到 group | 必填；必须能解析为部门 ID 和名称，不能留空 |
| username | username | 可为空；不作为姓名的替代存储 |
| status | enabled/disabled 等 | 可为空；缺失或无法识别时默认 active（在职），明确停用值统一为 disabled |
| createdAt | 创建时间字段 | 可为空，无值显示未知 |
| lastUsedAt | 最后请求/登录时间 | 可为空，无值显示未知，不用同步时间代替 |
| 管理 | AI OPS 操作 | 只显示当前实现支持的动作 |

不要用本地随机演示 ID 覆盖 New API user id。

### CSV 模板与导入

- CSV 模板保持“姓名、部门”两列；旧模板仍兼容，显式登录名会作为 New API `username` 使用。
- 有 New API 管理凭据时，CSV 导入逐条调用 New API 创建普通用户：姓名写入 `username`，部门写入 `display_name`，角色固定为普通用户，状态默认在职；随后自动刷新 AI OPS 镜像。
- 未提供初始密码时由 server 生成一次随机值并只提交给 New API，不保存到 AI OPS 数据库、日志或前端响应；本阶段不把员工登录 AI OPS 作为前置条件。
- 没有配置 New API 管理凭据时，才保留本地兼容导入模式；生产环境应配置凭据，避免产生无法互通的本地人员。

## 2. 读取 New API 用户

在 NewApiManagementClient 增加用户读取和状态回写方法：

```text
listUsers(page, pageSize)
getUser(id)
updateUserStatus(id, status)
```

要求：

- 处理分页、排序和空列表。
- 对响应做 schema 校验。
- 只把必要字段返回 AI OPS。
- 不在日志中记录密码、密码哈希、Token 或完整用户对象。
- New API 查询失败时保留已有缓存并标记 stale，不能把所有人误判为 disabled。
- 自动同步只纳入普通用户；New API 管理员、Root 用户等管理账号必须排除。
- 首次没有同步数据时显示“尚未同步”，不显示空数据等同于没有人员。

建议内部记录外部版本或最后同步时间，便于发现 New API 数据变化。

## 3. 自动对齐与导入确认

页面读取 `/api/people` 时自动执行一次受节流保护的双端对齐；同步结果按快照幂等保存，不需要管理员点击同步按钮。人员在 AI OPS 中新增或批量导入时，先写入 New API 再写入镜像；人员状态在 AI OPS 中被停用或启用时，也先回写 New API，再更新本地人员和关联 Key。

人员同步应分成两个阶段。

### 预览

AI OPS 请求：

```text
GET /api/people/sync/preview
```

服务端读取 New API 用户并计算：

- 新增人数。
- 姓名/部门/状态变化人数。
- 已删除或找不到的外部用户。
- 将被标记为未知的记录。
- 不会触碰的字段。

页面向超级管理员展示差异，不展示敏感认证信息。

### 执行

超级管理员确认后调用：

```text
POST /api/people/sync
```

请求带上幂等操作 ID。服务端：

1. 重新读取 New API，不能直接相信旧预览。
2. 按 externalUserId upsert。
3. 按稳定 id 关联记录，更新 name、department，以及可用的 username、status、createdAt、lastUsedAt。
4. 保留 AI OPS 自己的审计关联和创建记录。
5. 写入同步结果和 request_id。
6. 返回新增、更新、跳过、失败统计。

重复执行相同快照不能产生重复人员。

## 4. 处理人员创建

用户要求是把员工导入 AI OPS，但如果未来需要从 AI OPS 创建 New API 用户，必须单独实现：

```text
POST /api/people
```

创建流程：

1. AI OPS 收集 `id`、姓名和部门三个必填字段；其它人员信息允许为空。
2. server 调用 New API 创建用户。
3. New API 返回 externalUserId。
4. server 保存映射。
5. 再读一次 New API，确认最终字段。

密码或初始凭据如果 New API 强制要求：

- 只在 server 侧生成一次随机初始值。
- 只按照 New API 支持的安全方式交付或重置。
- 不写入 AI OPS 普通数据库、日志或前端响应。
- 如果员工没有 AI OPS 登录需求，优先不要为员工创建新的登录凭据。

当前阶段建议先只做“从 New API 导入”，避免同时引入员工登录体系。

## 5. 人员状态规则

New API 是状态最终来源：

- New API active：AI OPS 显示启用。
- New API disabled：AI OPS 显示停用，并阻止创建新 Key。
- New API 查询失败：显示未知/同步失败，不自动停用人员。
- 找不到原用户：先标记 external_missing，保留关联 Key 历史；由第 06 步决定停用策略。
- AI OPS 页面不能通过本地字段绕过 New API 的停用状态。

如果允许在 AI OPS 点击“停用”，按钮应调用 New API 的停用接口，再重新同步；不能只改本地 SQLite。

## 6. 修改现有人员代码

重点检查并逐步替换：

```text
apps/server/src/people.ts
apps/server/src/keys.ts
apps/server/src/app.ts
apps/web/src/views/PeopleView.vue
apps/web/src/people-api.ts
```

处理原则：

- 先增加 New API 只读适配和映射，再删除本地演示数据。
- 旧本地字段没有外部来源的，明确标记为 AI OPS 元数据或删除。
- 不把分组字段重新带回需求；本项目不使用分组。
- 不让人员列表从 seed/demo 数据返回。
- 删除旧代码前先由第 00 步备份并由测试覆盖。

## 7. 最小真实验证

使用一个测试用户：

1. 在 New API 侧确认普通用户存在和状态。
2. 刷新 AI OPS 人员页，确认自动读取并按“用户名 / 显示名称”映射为“姓名 / 部门”。
3. 从 AI OPS 新增或 CSV 导入一名人员，确认 New API `users` 出现对应记录。
4. 刷新 AI OPS 页面，确认只出现一条对应镜像记录。
5. 在 New API 改变该用户状态，刷新 AI OPS，确认状态变化。
6. 在 AI OPS 停用或启用该用户，确认 New API 状态同步变化。
7. 重复导入相同用户名，确认不会产生第二条 New API 用户。

## 8. 本步验收

- [ ] 人员列表来源是 New API，而不是本地演示数据。
- [ ] 页面显示 id、姓名、部门、状态、创建时间、最后使用时间、管理。
- [ ] 人员记录的必填字段只有 id、姓名、部门；其它人员信息允许为空。
- [ ] CSV 导入在有管理凭据时写入 New API 后再写入 AI OPS 镜像，不产生本地孤儿人员。
- [ ] 字段缺失时显示未知，不伪造时间。
- [ ] New API 查询失败不会把所有人误停用。
- [ ] 同步具备预览、确认和幂等能力。
- [ ] 已停用的人员不能创建新 Key。
- [ ] 本步没有创建 Key、渠道或分组。
- [ ] 不需要员工登录 AI OPS。
- [ ] 用户密码、哈希和现有 Token 未进入普通日志。
- [ ] 构建、类型检查和接口测试通过。

## 9. 失败处理与回滚

| 失败 | 处理 |
| --- | --- |
| New API 用户接口未知 | 先用实际版本探测只读接口，暂停写入 |
| 分页不完整 | 保存 page/pageSize 和总数，修复后重跑预览 |
| 用户重复 | 以 New API externalUserId 去重，不按姓名合并 |
| 查询暂时失败 | 保留上次快照并标 stale，不执行批量停用 |
| 旧本地人员与 New API 不一致 | 先建立映射报告，禁止静默覆盖 |

回滚可以暂时关闭同步按钮并恢复只读列表；不要删除 New API 用户。通过后进入 [05｜New API 员工 Key](./05-new-api-key)。
