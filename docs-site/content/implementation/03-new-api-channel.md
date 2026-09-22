# 03｜将 CPA 写入 New API 渠道

## 本步目标

在 CPA 已经完成 Codex OAuth、能够返回真实模型之后，把 CPA 配置成 New API 的一个受控渠道：

```text
员工客户端
  -> New API OpenAI 兼容入口
  -> AI OPS 管理的 CPA 渠道
  -> CPA /v1
  -> Codex OAuth 账号
```

AI OPS 是管理入口。管理员不需要打开 New API 管理网站，也不需要把 CPA 管理密钥、CPA 客户端 Key 或 New API 管理 Token 交给员工。

本步只完成“CPA 作为 New API 渠道”的读取、预览、创建/更新、启停和验证，不导入人员，不创建员工 Key，不创建分组，不删除未知渠道。

> 当前实现状态：New API 管理适配器已覆盖渠道分页读取、创建、更新和启停；AI OPS 已提供脱敏预览、明确确认、最终复读校验、marker 映射和幂等重放。真实 CPA 模型目录未 ready 时，服务端会阻止写入。

## 前置条件

- [02｜CPA Codex OAuth 登录](./02-cpa-oauth) 已通过。
- AI OPS 能从 CPA 读取 `ready` 状态和真实模型 ID。
- `new-api`、`cpa`、`server` 在同一个 Compose 网络中，服务名可互相解析。
- New API 的镜像版本、数据库备份和实际管理接口已经确认。
- New API 管理 Token 已配置在 server 侧；可选的 `NEW_API_USER_ID` 也只在 server 侧使用。
- 已确认 CPA 客户端 Key 的来源和 New API 渠道所需的渠道类型。
- 已准备一个 CPA 实际返回的测试模型，且测试环境可以安全地创建或更新一个渠道。

## 1. 明确两条链路和四类凭据

管理链路和请求链路不能混在一起：

```text
管理员浏览器
  -> AI OPS server
      -> CPA management API       （登录、状态、认证文件）
      -> New API management API   （读取和写入渠道）

员工客户端
  -> New API /v1
      -> New API 渠道
          -> CPA /v1
```

凭据必须按用途区分：

| 凭据 | 用途 | 来源 | 是否返回浏览器 | 是否交给员工 |
| --- | --- | --- | --- | --- |
| CPA management key | 调用 CPA 管理接口 | server 环境或 `deploy/cpa/config.yaml` | 否 | 否 |
| CPA 客户端 Key | 作为 New API 渠道的上游密钥 | CPA `api-keys` 配置 | 否 | 否 |
| New API 管理 Token | 查询、创建、更新渠道 | server 环境/本地部署配置 | 否 | 否 |
| 员工 New API Token | 调用 New API `/v1` | 后续第 05 步创建 | 只允许一次性返回 | 是 |

特别注意：CPA management key 不能填入 New API 渠道的 Key 字段；New API 管理 Token 也不能当成渠道 Key。渠道 Key 必须是 CPA 对外 `/v1` 请求实际需要的客户端 Key。

## 2. 以当前代码为起点

先阅读现有适配器，不要再复制一套旁路客户端：

```text
apps/server/src/new-api-status.ts
apps/server/src/new-api-management.ts
apps/server/src/new-api-status.test.ts
apps/server/src/new-api-management.test.ts
apps/server/src/app.ts
apps/server/src/gateway-runtime.ts
docker-compose.yml
```

当前只读能力和服务端配置如下：

| 能力 | 当前实现 | 作用 |
| --- | --- | --- |
| New API 存活探针 | `GET /api/status` | 判断服务是否可达 |
| 管理认证探针 | `GET /api/user/self` | 验证 `NEW_API_ACCESS_TOKEN`，可带 `New-Api-User` |
| 模型目录 | `GET /api/models/` | 读取 New API 侧模型元数据 |
| 渠道列表 | `GET /api/channel/?p=1&page_size=100&id_sort=false&tag_mode=false&status=all` | 读取渠道并处理分页 |
| 渠道模型目录 | `GET /api/channel/models` | 读取当前版本支持的渠道模型信息 |

`new-api-management.ts` 目前要求管理接口返回成功 envelope，并且只向上层返回规范化状态；它不会把管理 Token 或原始响应交给前端。新增写能力必须沿用这个边界。

Compose 内部地址应保持明确：

```text
New API 管理基址：http://new-api:3000
New API 请求基址：http://new-api:3000/v1
CPA 请求基址：  http://cpa:8317/v1
```

不要把浏览器访问地址、宿主机 `localhost` 或 `127.0.0.1` 写入容器之间的渠道配置。New API 容器里的 `localhost` 指向 New API 自己，不是 CPA。

## 3. 读取并确认 CPA 真实来源

渠道同步开始前，server 必须重新读取 CPA 状态，不能只相信页面上一次缓存的模型列表。

至少记录以下非敏感快照：

```typescript
type CpaChannelSourceSnapshot = {
  state: 'ready' | 'auth_required' | 'unavailable' | 'invalid_response' | 'not_configured'
  baseUrl: string
  modelIds: string[]
  credentialConfigured: boolean
  checkedAt: string
}
```

执行规则：

1. 调用已有的 CPA 状态适配器和模型接口。
2. 只接受 CPA 实际返回的模型 ID；不使用前端输入、默认假模型或旧缓存补齐。
3. CPA 不是 `ready`，或者模型列表为空/结构无效时，预览可以显示原因，但写入必须停止。
4. `baseUrl` 使用 New API 容器可以访问的 CPA 地址，例如 `http://cpa:8317/v1`。
5. CPA 客户端 Key 从部署配置读取，不能从浏览器请求体读取，也不能写入普通日志。
6. 日志只允许记录状态、模型数量、耗时、request_id 和错误码，不记录 Key、OAuth 文件或上游完整响应。

CPA 的 OAuth 认证账号是渠道背后的能力来源；它不是 New API 的员工用户，也不应被映射为人员或员工 Token。

## 4. 读取和规范化 New API 渠道

在写入之前先完成完整的只读适配。所有查询都由 `NewApiManagementClient` 在 server 侧发起：

```typescript
type NewApiChannelSnapshot = {
  id: string
  name: string
  type: string | number
  baseUrl: string
  models: string[]
  enabled: boolean | null
  marker: string | null
  createdAt: string | null
  updatedAt: string | null
}
```

适配要求：

- 处理 New API 当前版本的 envelope、分页、空列表和数字/字符串 ID 差异。
- 对关键字段做 schema 校验；响应形状不符合预期时返回 `invalid_response`，不能当成空渠道列表。
- `baseUrl` 统一去掉末尾斜杠，模型去重但不擅自改名。
- 不把密码、渠道 Key、管理 Token、完整渠道对象或原始错误正文返回前端。
- 查询失败时明确区分 `not_configured`、`auth_required`、`unavailable` 和 `invalid_response`。
- 未完成分页时不能开始写入，否则可能把已有渠道误判成不存在。

推荐把“查询”和“写入”拆成两个接口层：

```text
NewApiManagementClient       负责 HTTP、认证、超时、分页和 envelope
NewApiChannelAdapter         负责当前版本字段映射和渠道业务规则
ChannelSyncService            负责预览、幂等匹配、写入和最终验证
```

不要让前端直接调用 `/api/channel`，也不要把浏览器提交的任意 payload 透传给 New API。

## 5. 设计稳定标识和幂等匹配

AI OPS 管理的渠道使用固定 marker：

```text
ai-ops:cpa:codex
```

优先把 marker 写入当前 New API 版本支持的标签、备注或专用字段；如果该版本没有这些字段，则使用明确的名称前缀，并在 AI OPS 自己的数据库中保存 `externalChannelId` 与 marker 的映射。名称只能用于展示，不能单独作为唯一标识。

匹配顺序必须固定：

1. 用 AI OPS 已保存的 `externalChannelId` 查询并校验对象。
2. 找不到时，用 marker 做精确匹配。
3. 只有唯一匹配时才允许更新。
4. 没有匹配时才允许创建一个新渠道。
5. 找到多个 marker 候选时停止并报警，不能按名称、创建时间或 ID 猜一个。
6. 发现未知渠道时只读展示，不删除、不覆盖、不自动归属给 AI OPS。
7. 每次成功写入后保存最终 `externalChannelId`、marker、模型快照、更新时间和 request_id。

同步必须满足：

```text
同一 marker + 同一外部渠道 ID + 同一来源
  -> 更新同一个渠道

重复点击、重试或 server 重启
  -> 不创建第二个 AI OPS CPA 渠道
```

如果保存映射失败但 New API 已经创建成功，下一次同步必须先按 marker 做唯一匹配，不能再次创建。

## 6. 实现当前版本的写入适配器

当前版本的 `NewApiManagementClient` 已提供明确的渠道读写方法，服务端同步服务只接收 CPA 配置和实际模型快照，不透传浏览器 payload：

```text
createChannel(input)
updateChannel(id, input)
updateChannelStatus(id, status)
listChannels(page, pageSize)
```

方法内部必须负责：

- 使用 server-only New API 管理 Token 和可选 `New-Api-User`。
- 统一超时、重试次数和 request_id。
- 校验 HTTP 状态、success envelope 和响应字段。
- 只提交允许的渠道字段，不接受浏览器传入的原始管理 payload。
- 对 Key、Authorization 和完整响应做日志脱敏。
- 把 401/403、404/405、校验失败、超时和连接失败映射为稳定错误码。
- 写入完成后返回脱敏的外部 ID、状态和模型数量。

当前适配器按 New API 官方当前路由和模型字段发起请求，并用测试覆盖方法、路径、envelope、字段归一化和密钥脱敏：

```text
创建渠道
更新渠道
启用/禁用渠道
设置渠道模型
设置渠道上游 Key 和 Base URL
```

如果某项能力在当前版本不存在，适配器应返回“未支持”并停止同步，不要在 AI OPS 本地伪造成功，也不要把一个不完整渠道标记为可用。

渠道 payload 的语义固定为：

| 语义 | 写入要求 |
| --- | --- |
| 名称 | 能识别为 AI OPS 管理的 CPA/Codex 渠道 |
| 类型 | 使用当前版本与 OpenAI 兼容/CPA 上游对应的类型 |
| Base URL | `http://cpa:8317/v1` 或当前 Compose 网络中的等价地址 |
| Key | CPA 客户端 Key，不是 management key 或员工 Token |
| 模型 | CPA 本次真实返回的模型 ID |
| marker | `ai-ops:cpa:codex`，或当前版本支持的等价存储位置 |
| 状态 | 只有 CPA ready 且最终验证通过才允许启用 |
| 超时 | 由 server/渠道适配器统一控制 |

不要把 New API 的请求 Token、AI OPS 管理 Token 或 CPA OAuth 文件内容放入渠道 payload。

## 7. 提供预览、确认和同步接口

渠道同步必须是两阶段操作。建议由 server 提供以下内部接口，具体路由以现有 `app.ts` 的鉴权约定为准：

```text
GET  /api/integrations/new-api/channel/sync/preview
POST /api/integrations/new-api/channel/sync
```

预览接口只读并返回脱敏差异：

```typescript
type NewApiChannelSyncPreview = {
  cpa: {
    state: string
    modelIds: string[]
    baseUrl: string
    checkedAt: string
  }
  target: {
    marker: string
    externalChannelId: string | null
    action: 'create' | 'update' | 'enable' | 'blocked' | 'unchanged'
  }
  changes: string[]
  canApply: boolean
  requestId: string
}
```

执行接口的 server 流程：

1. 校验当前管理员权限和幂等操作 ID。
2. 重新读取 CPA 状态、模型和 New API 渠道，不能直接信任旧预览。
3. 按第 5 节规则解析唯一目标。
4. 计算名称、类型、Base URL、模型、marker 和状态差异。
5. 调用当前版本写入适配器。
6. 创建或更新后重新读取渠道列表，确认最终 `externalChannelId`、模型和状态。
7. 调用 New API 模型/渠道只读接口做一次最终验证。
8. 只有验证通过才返回 succeeded；否则返回 failed/partial，并带 request_id。

接口响应只能包含脱敏结果，例如渠道 ID、模型 ID、状态、动作和时间；不能包含 CPA Key、管理 Token、完整 payload 或上游原始异常。

首次上线建议只允许超级管理员明确点击“同步 CPA 渠道”。未来即使增加自动同步，也必须保留 dry-run/预览和停止写入的开关。

## 8. 状态和失败安全规则

### CPA 未 ready

- 首次同步：阻止创建和启用。
- 已有渠道：不要把旧渠道无条件改写成 ready；显示上次成功同步时间和当前 CPA 异常。
- 是否自动禁用已有渠道必须作为单独的产品策略实现，默认不做猜测性批量修改。

### New API 管理认证失败

- `401/403` 映射为 `auth_required`。
- 不重复重试写请求，不把 Token 发送到浏览器。
- 管理员补充 server 侧配置后，再进行只读探测。

### 写入成功但验证失败

- 保存 New API 返回的 request_id 和脱敏状态。
- 如果当前版本支持禁用，立即禁用本次创建/更新的 AI OPS 渠道。
- 不删除未知渠道，不回滚其他渠道。
- 返回“需要人工复核”，不能显示同步成功。

### 多个匹配对象或字段冲突

- 停止写入并显示候选数量、ID 和脱敏名称。
- 不按名称、更新时间或 ID 自动选择。
- 人工确认 marker 和映射后再继续。

## 9. 最小真实验证

只使用测试环境、一个 CPA 账号和一个真实可用模型完成以下验证：

1. 确认 CPA 状态为 `ready`，模型 ID 来自 CPA 的真实 `/v1/models`。
2. 查看 New API 管理状态，确认管理 Token 只在 server 侧生效。
3. 执行渠道预览，确认 Base URL 是 `http://cpa:8317/v1`，Key 已脱敏，目标 ID 和动作正确。
4. 点击同步，确认 New API 返回的渠道 ID 已保存。
5. 重新查询渠道，确认类型、Base URL、模型、marker 和状态正确。
6. 通过 New API 模型列表确认目标模型存在。
7. 使用一个后续步骤创建的测试员工 Key 发起一次最小请求，确认请求路径是 New API -> CPA，而不是浏览器直连 CPA。
8. 再次执行完全相同的预览和同步，确认仍然只有一个 AI OPS CPA 渠道。
9. 改变 CPA 模型列表或暂时让 CPA 不可用，确认同步会显示差异/阻止写入，不会创建假渠道。
10. 模拟 401、404/405、超时、无效 JSON 和重复 marker，确认系统停止并返回稳定错误码。

只读探针示例：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/status
Invoke-RestMethod http://127.0.0.1:4175/api/integrations/new-api/status
Invoke-RestMethod http://127.0.0.1:4175/api/integrations/new-api/management
docker compose logs --tail=100 server
docker compose logs --tail=100 new-api
```

不要把真实 Token 直接写进 PowerShell 历史、文档、截图或日志。受保护的 New API 查询优先通过 AI OPS server 触发。

## 10. 本步验收

> 实现记录（2026-09-21）：本步的服务端与管理页面已完成。已覆盖 New API 渠道分页读取、创建、更新、启停、CPA ready 阻断、`ai-ops:cpa:codex` 映射、最终复读校验和幂等重放；测试覆盖真实模型快照、重复 marker、认证缺失和密钥脱敏。生产冷启动与真实 Compose 联调仍需在目标部署环境执行。

- [ ] New API 管理适配器能区分服务不可达、未配置、认证失败和响应不兼容。
- [ ] New API 管理 Token 只存在 server 侧，浏览器响应和日志不含 Token。
- [ ] CPA 状态和模型来自本次真实探测，不使用假模型或过期缓存补齐。
- [ ] 渠道 Base URL 使用 Compose 内部 CPA 地址，而不是宿主机 localhost。
- [ ] 渠道使用 CPA 客户端 Key，不是 CPA management key、New API 管理 Token 或员工 Key。
- [ ] 渠道类型和字段与当前 New API 镜像版本实际接口一致。
- [ ] 同步包含预览、明确确认、重新读取和最终验证。
- [ ] `ai-ops:cpa:codex` marker 或等价稳定映射已保存。
- [ ] 重复同步、网络重试和 server 重启不会创建第二个 AI OPS CPA 渠道。
- [ ] 多个候选、字段冲突和写入后验证失败时会停止，不会猜测或误更新。
- [ ] CPA 未认证/不可用时不会创建或启用一个看似成功的渠道。
- [ ] 渠道模型只包含 CPA 实际可用模型。
- [ ] 本步没有导入人员、创建员工 Key、创建分组或删除未知渠道。
- [ ] AI OPS 页面不要求管理员打开 New API 管理网站。
- [ ] 相关单元测试、类型检查、server/web 构建和文档站检查通过。

## 11. 失败处理与回滚

| 失败 | 处理 |
| --- | --- |
| New API 管理接口 401/403 | 检查 server 侧 `NEW_API_ACCESS_TOKEN` 和可选 `NEW_API_USER_ID`，先恢复只读认证 |
| 管理接口 404/405 | 记录当前镜像版本、方法和路径，补版本适配器；不要反复重试写请求 |
| 响应 envelope 或字段变化 | 保存脱敏字段名和状态码，修复 schema；不能把异常响应当成空列表 |
| CPA 未认证、模型为空或不可达 | 回到第 02 步处理 OAuth/CPA，不创建或启用渠道 |
| 找到多个 marker 候选 | 停止自动同步，人工确认唯一对象；不要按名称猜测 |
| 创建后 AI OPS 超时 | 重新按 marker 查询，确认是否已创建；不要直接再次创建 |
| 渠道已写入但最终验证失败 | 若支持则禁用本次 AI OPS 渠道，保留 request_id 和映射，等待人工复核 |
| 误配置了 Base URL 或 Key | 立即禁用该 AI OPS 渠道，修正 server/部署配置后重新预览；不要删除其他渠道 |

回滚优先使用 New API 的禁用能力：

```text
将 marker=ai-ops:cpa:codex 的渠道改为 disabled
```

不要用删除整个 New API 数据卷、删除未知渠道、清空 CPA `auths` 或 `git reset --hard` 作为回滚。保存渠道旧状态和旧 payload 后，才可以在测试环境按相同 marker 恢复；生产恢复必须经过超级管理员确认。

通过后进入 [04｜人员同步](./04-people-sync)。
