# 01｜CPA 服务端真实接入与账号文件管理

## 本步目标

把 CPA 接入收敛到 AI OPS 服务端适配器，并把“上游账号”页重构为 CPA 认证文件工作台，使 AI OPS 能够读取和管理真实的：

- CPA 服务健康状态。
- Codex OAuth 认证账号/认证文件状态。
- 每个认证文件对应的 CPA 可用模型。
- CPA 额度窗口（能读到就显示真实值，读不到就明确显示未知）。
- OAuth 启动、认证文件上传、启用/停用、刷新、下载、设置和删除结果。

本步不创建 New API 渠道、不导入人员、不创建员工 Key。删除、下载、设置和启用状态属于管理员明确触发的 CPA 认证文件操作。

## 前置条件

- [00｜执行前检查与备份](./00-preflight) 已通过。
- 已确认 CPA 和 server 在同一个 Compose 网络中。
- 已确认管理密钥只存在于 server 容器的环境或挂载文件中。
- 已阅读当前 CPA 版本的管理 API 路径；不要根据旧版本页面猜接口。
- 手上有一个可用于测试的 CPA 实例，但不要把真实密钥写入代码或测试输出。

## 1. 当前代码检查

重点阅读以下文件，不要先复制一套新实现：

```text
apps/server/src/cpa-management.ts
apps/server/src/deployment-config.ts
apps/server/src/platform.ts
apps/server/src/upstreams.ts
apps/server/src/app.ts
apps/web/src/views/UpstreamsView.vue
apps/web/src/upstreams-api.ts
```

确认当前实现是否已经具备：

- server 侧 Authorization: Bearer management-key。
- /v0/management/codex-auth-url?is_webui=true。
- /v0/management/get-auth-status。
- /v0/management/auth-files 的列表和上传。
- /v0/management/auth-files/models 的认证文件模型读取。
- Docker 内部地址和宿主机地址的区分。

## 2. 统一凭据来源

把凭据分成四类，并在代码类型上明确区分：

| 凭据 | 用途 | 可否发给浏览器 | 可否发给员工 |
| --- | --- | --- | --- |
| CPA 管理密钥 | 调用 CPA management API | 否 | 否 |
| CPA 客户端 Key | 作为 New API 渠道凭据 | 否 | 否 |
| New API 管理 Token | 创建/修改用户和 Token | 否 | 否 |
| 员工 New API Token | 员工调用 API | 只允许一次性返回 | 是 |

服务端只从部署配置解析前三种凭据。删除或废弃浏览器请求中的以下字段：

```text
managementBaseUrl
managementKey
apiKey
auth file 中的外部管理密钥
```

如果为了兼容旧前端暂时保留字段，服务端必须忽略客户端传入值，并记录迁移告警，而不是使用客户端值。

## 3. 设计 CPA 适配器边界

在 apps/server/src/cpa-management.ts 中形成一个唯一入口，例如：

```typescript
type CpaIntegrationState =
  | 'ready'
  | 'auth_required'
  | 'unavailable'
  | 'invalid_response'
  | 'not_configured'

type CpaUsageWindow = {
  name: string
  used: number | null
  limit: number | null
  remaining: number | null
  resetAt: string | null
  source: 'cpa' | 'unknown'
}

type CpaIntegrationSnapshot = {
  state: CpaIntegrationState
  baseUrl: string
  models: string[]
  authAccounts: Array<{
    id: string
    name: string
    status: string
    lastUsedAt: string | null
  }>
  usageWindows: CpaUsageWindow[]
  checkedAt: string
  errorCode?: string
}
```

适配器至少提供这些服务端方法：

```text
checkManagement()
listAuthAccounts()
listModels()
readUsage()
listAuthFileModels()
setAuthFileStatus()
refreshAuthFile()
readAuthFileSettings()
patchAuthFileSettings()
downloadAuthFile()
deleteAuthFile()
startCodexOAuth()
readCodexOAuthStatus()
uploadAuthFile()
```

要求：

- 所有方法统一超时、错误码和日志字段。
- 日志只记录路径、状态码、request_id 和耗时，不记录 Authorization、OAuth code、Prompt 或回复正文。
- 上游返回未知字段时忽略，不把原始整包透传给浏览器。
- 上游没有额度接口时，usageWindows 返回空数组，并让 UI 明确显示“未知”，不能返回 0。
- 认证过期和服务不可达要区分，方便管理员判断下一步动作。

## 4. 对齐当前 CPA API

以当前部署版本实际响应为准，逐项抓取并固定类型校验：

| 能力 | 当前候选路径 | 结果要求 |
| --- | --- | --- |
| 网关模型探针 | GET /v1/models | 只用于连接状态，不作为某个认证文件的模型列表 |
| 认证文件列表 | GET /v0/management/auth-files | 只返回必要的 id、名称、状态、账号、文件大小、时间、请求记录 |
| 单文件模型 | GET /v0/management/auth-files/models?name=... | 返回该认证文件实际可用模型，不使用假模型 |
| 单文件额度 | POST /v0/management/api-call | 由 CPA 代发 Codex `/backend-api/wham/usage`，只规范化窗口和套餐 |
| OAuth 地址 | GET /v0/management/codex-auth-url?is_webui=true | 返回一次性/短时授权地址 |
| OAuth 状态 | GET /v0/management/get-auth-status | 返回明确状态，不把 code 暴露给前端 |
| 认证文件上传 | POST /v0/management/auth-files | 服务端验证响应后才报告成功 |
| 启用/停用 | PATCH /v0/management/auth-files/status | 修改指定文件的 disabled 状态 |
| 刷新凭证 | POST /v0/management/auth-files/refresh | 触发 CPA 热加载/刷新 |
| 设置 | PATCH /v0/management/auth-files/fields | 只提交前缀、代理、权重、备注等安全字段 |
| 下载 | GET /v0/management/auth-files/download?name=... | 仅管理员明确点击时代理下载，不在列表响应中返回正文 |
| 删除 | DELETE /v0/management/auth-files | 以 names 数组删除指定文件 |
| 管理 API 探针 | CPA 当前管理 API | 记录版本、状态码、延迟 |

额度读取使用 CPA 的 `api-call` 代理 Codex usage 接口。AI OPS 只保存以下规范化字段：套餐、窗口使用/剩余百分比、重置时间、可用 credits 数量和检查时间；不会把原始 usage 响应透传给浏览器。

如果 CPA 当前版本没有稳定的额度窗口字段：

1. 保留窗口为空或字段为未知。
2. 不从本地调用次数、New API 余额或缓存值推导 CPA 额度。
3. 页面仍保留“点击此处刷新额度”，失败时显示 CPA 返回的错误，不把失败伪装成 0%。

如需捕获真实请求/回复，先确认 CPA 或 New API 的请求边界是否提供正文。不要在本步把所有流量复制到第二个代理，避免重复计费和重复请求。

## 5. 暴露 AI OPS 内部接口

当前页面使用的 AI OPS 内部接口位于 `apps/server/src/app.ts`：

```text
GET    /api/upstreams/cpa/auth-files
GET    /api/upstreams/cpa/auth-files/models?name=...
GET    /api/upstreams/cpa/auth-files/settings?name=...
GET    /api/upstreams/cpa/auth-files/detail?name=...
GET    /api/upstreams/cpa/auth-files/download?name=...
PATCH  /api/upstreams/cpa/auth-files/status
POST   /api/upstreams/cpa/auth-files/refresh
PATCH  /api/upstreams/cpa/auth-files/settings
POST   /api/upstreams/cpa/auth-files/quota
DELETE /api/upstreams/cpa/auth-files
POST   /api/upstreams/cpa/oauth-url
POST   /api/upstreams/cpa/oauth-status
POST   /api/upstreams/cpa/auth-files
```

接口约束：

- 只接受 AI OPS 会话和 CSRF/鉴权要求。
- 不接受管理密钥、客户端 Key、上游完整 URL 作为业务参数。
- 返回规范化状态，不返回上游 Authorization、Cookie、OAuth code、原始异常堆栈。
- 所有写请求返回 request_id，便于在容器日志中定位。
- 文件列表只返回安全摘要；`auth_index`、`id_token`、文件路径和认证文件正文不会进入列表或设置响应。
- 设置页的 INFO 与 JSON 预览由 CPA 当前认证文件实时生成；JSON 预览保留字段结构，但 `access_token`、`refresh_token`、`id_token`、密钥和授权头统一显示为 `[REDACTED]`。
- 下载是独立的管理员明确操作，服务端只代理 CPA 的文件字节，不写入 AI OPS 日志或数据库。
- OAuth 入口不展示 CPA 管理网站日常链接；页面只提供 OAuth、上传和账号文件操作。

浏览器端 `UpstreamsView.vue` 现在以认证文件卡片为主，只保留：

- CPA 连接状态。
- 模型列表。
- 认证账号列表。
- 真实额度/未知状态和“点击此处刷新额度”。
- 每个账号的请求成功/失败记录和文件大小/更新时间。
- “模型”“下载”“设置”“删除”和绿色/灰色“启用”开关。
- “开始 Codex 登录”和“上传到 AI OPS”入口。

删除或隐藏：

- 手动填写 CPA 管理 URL。
- 手动填写管理密钥。
- 顶部四张与账号文件无关的摘要卡片。
- 旧的本地模拟验证、模拟告警入口和无法对应 CPA 实际数据的模型面板。
- 跳转 CPA 管理网站的日常操作链接。

## 6. 编写探针和契约测试

至少覆盖：

- CPA 返回 200 且模型列表有效。
- CPA 返回 401/403 时变成认证错误，不泄露密钥。
- CPA 返回 404/405 时变成能力不可用，不把系统标记为已连接。
- CPA 超时/断网时变成 unavailable。
- JSON 结构变化时变成 invalid_response。
- 没有额度字段时 UI 显示未知而不是 0。
- 启用文件的开关为绿色，停用文件的开关为灰色，状态更新后重新读取 CPA 列表。
- 模型按钮读取当前认证文件的 CPA 模型列表，而不是使用页面静态模型或网关假数据。
- 下载、设置、刷新、删除和额度刷新都有明确的加载/错误状态。
- 重复调用状态查询没有写入副作用。
- 日志中不存在 Bearer、OAuth code、CPA client key 等敏感值。

可使用伪造的本地 HTTP fixture，不要在测试中调用真实生产账号。

## 7. 启动并验证

修改后重建受影响服务：

```powershell
docker compose up -d --build server web
docker compose ps
docker compose logs --tail=100 server
```

调用 AI OPS 接口：

```powershell
Invoke-RestMethod http://127.0.0.1:4175/health
Invoke-RestMethod http://127.0.0.1:4175/api/platform/status
Invoke-RestMethod http://127.0.0.1:4175/api/integrations/cpa/status
```

再打开 AI OPS 页面，确认只通过 AI OPS 看到 CPA 状态。此时不要点击会创建渠道或 Key 的按钮；本步骤只验证 CPA 连接。

## 8. 本步验收

- [ ] 浏览器不再提交 CPA 管理密钥和客户端 Key。
- [ ] server 能从部署配置访问 CPA management API。
- [ ] AI OPS 能显示每个 CPA 认证文件的真实模型列表。
- [ ] 已存在的 CPA 认证账号能被 AI OPS 识别。
- [ ] CPA 不可用、未认证、响应异常三种状态能区分。
- [ ] 额度能读到时显示真实来源；读不到时显示“未知”而不是 0。
- [ ] 认证文件卡片显示请求记录、文件大小、更新时间和 CPA 实时来源。
- [ ] 启用/停用、刷新 OAuth、下载、设置、删除和模型读取都调用对应 CPA 管理接口。
- [ ] 启用状态为绿色，未启用状态为灰色。
- [ ] AI OPS 页面不要求管理员打开 CPA 管理网站。
- [ ] 日志和 API 响应没有泄露敏感凭据。
- [ ] 现有单元测试、类型检查和 server/web 构建通过。
- [ ] 没有创建 New API 渠道或员工 Key。

## 9. 失败处理与回滚

| 失败 | 处理 |
| --- | --- |
| CPA 地址错误 | 修正 server 容器内的 CPA 配置，重启 server |
| 管理密钥无效 | 在本地部署配置更新，不在浏览器页面输入 |
| 管理 API 路径不兼容 | 记录实际状态码和响应形状，增加版本适配，不硬编码假成功 |
| 模型接口成功但额度窗口不存在 | 保持额度未知，不把窗口填成 0，继续 OAuth 和认证文件管理 |
| 前端仍出现旧配置输入框 | 先禁用提交逻辑，再删除 UI，避免旧客户端继续发送敏感字段 |

本步的安全回滚是恢复上一版 server/web 镜像或代码，不清空 CPA 认证目录：

```powershell
docker compose stop server web
docker compose up -d server web
```

通过后进入 [02｜CPA Codex OAuth 登录](./02-cpa-oauth)。
