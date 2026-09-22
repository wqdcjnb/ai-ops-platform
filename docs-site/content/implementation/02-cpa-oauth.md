# 02｜CPA Codex OAuth 登录

## 本步目标

让超级管理员在 AI OPS 中发起 Codex OAuth，并由 CPA 保存认证结果。日常流程不进入 CPA 管理网站；只有 OAuth 协议要求时，才短暂打开官方授权页面。

完成后，AI OPS 能够：

- 判断 CPA 是否已有可用 Codex 认证账号。
- 从 AI OPS 发起登录。
- 在服务端保存 OAuth state 和过期时间。
- 轮询或回调确认认证结果。
- 认证成功后刷新模型和额度状态。

## 前置条件

- [01｜CPA 服务端真实接入](./01-cpa-connection) 已通过。
- CPA management API 可访问。
- 已确认当前 CPA 版本的 OAuth 地址和状态接口。
- 已确认认证文件目录是持久化挂载。
- 已准备一个可测试的 Codex OAuth 账号。
- 超级管理员已登录 AI OPS。

## 1. 先判断是否需要登录

AI OPS 打开 CPA 页面时先调用：

```text
GET /api/integrations/cpa/status
```

按服务端规范化结果展示：

| 状态 | UI 行为 | 管理员动作 |
| --- | --- | --- |
| ready | 显示已认证、模型和额度 | 可以进入下一步 |
| auth_required | 显示未认证 | 点击开始 Codex 登录 |
| unavailable | 显示 CPA 不可达 | 检查容器和网络 |
| invalid_response | 显示版本/响应不兼容 | 查看 request_id 和日志 |
| not_configured | 显示未配置 | 补全本地部署配置 |

如果已经有可用认证账号，不要每次打开页面都重新 OAuth。只有管理员明确点击“重新登录”时才启动新的流程。

## 2. 设计服务端 OAuth 会话

OAuth state 必须由 AI OPS server 生成和保存，不要由浏览器自行拼接。建议保存以下信息：

```typescript
type CpaOAuthSession = {
  id: string
  provider: 'codex'
  stateHash: string
  status: 'created' | 'waiting' | 'succeeded' | 'failed' | 'expired'
  createdAt: string
  expiresAt: string
  completedAt: string | null
  errorCode: string | null
}
```

要求：

- state 只保存哈希或不可逆关联值。
- 有效期建议 10 分钟左右，具体以 CPA 当前实现为准。
- 一次 state 只能使用一次。
- 超时后不能继续接受回调。
- 数据库或内存重启后，过期 session 必须自然失效。
- 不在浏览器、URL、普通日志中打印 OAuth code、access token 或 refresh token。

如果当前项目还没有 OAuth session 表，可以先使用服务端短期存储，但必须给出过期清理策略；不要把 state 放在前端 localStorage。

## 3. 启动登录流程

推荐内部接口：

```text
POST /api/integrations/cpa/oauth/start
```

请求只包含 provider，示例：

```json
{
  "provider": "codex"
}
```

服务端步骤：

1. 检查当前 CPA 状态，确认不是未配置或不可达。
2. 生成 session_id 和 state。
3. 调用 CPA 的 Codex auth URL 接口。
4. 校验 CPA 返回的是允许的官方授权地址。
5. 保存 session，状态改为 waiting。
6. 返回短时授权地址和 session_id。

响应中可以返回：

```json
{
  "sessionId": "opaque-session-id",
  "authorizationUrl": "https://official.example/authorize",
  "expiresAt": "2026-09-20T12:10:00Z"
}
```

不要返回：

- CPA management key。
- CPA 客户端 Key。
- 原始上游响应。
- access token、refresh token 或 OAuth code。
- 不受允许域名限制的任意跳转地址。

如果当前 CPA 返回的是本地回调地址，前端只负责打开或提示管理员完成官方授权；回调接收和凭据落盘仍由 CPA/server 处理。

## 4. 前端交互

AI OPS 页面只需要：

1. 显示“开始 Codex 登录”按钮。
2. 点击后请求 start 接口。
3. 在新窗口或当前标签打开官方授权地址。
4. 页面显示“等待授权完成”。
5. 每隔几秒查询一次服务端状态，或等待服务端回调。
6. 成功后关闭授权窗口（若浏览器允许）并刷新 CPA 状态。
7. 失败、取消、过期时显示可重试按钮。

状态查询接口：

```text
GET /api/integrations/cpa/oauth/status?sessionId=opaque-session-id
```

状态查询必须只允许当前超级管理员访问，并校验 session 属于当前管理员。

不要让页面直接调用 CPA management API，也不要把 CPA 管理网站作为“登录入口”展示给管理员。

## 5. 认证文件上传作为备用路径

如果当前 CPA 支持认证文件导入，可保留 AI OPS 的“导入认证文件”能力。处理流程：

1. 浏览器通过 multipart 上传到 AI OPS server。
2. server 限制大小、扩展名和 MIME 类型。
3. server 不把文件写到公开静态目录。
4. server 将文件转发给 CPA 的 auth-files 接口。
5. CPA 返回成功后，server 删除临时文件。
6. server 刷新认证状态和模型列表。
7. 日志只记录文件哈希、大小、request_id，不记录文件正文。

注意：

- 认证文件是高敏感凭据，不能写 Git、前端构建产物或普通业务日志。
- 失败时确认临时文件已清理。
- 上传成功后不要再把文件内容返回浏览器。
- 如果当前产品不需要导入文件，可以只实现 OAuth，保留接口占位。

## 6. 最小真实验证

用一个真实测试账号完成以下流程。

### 6.1 已认证路径

- CPA 中已有认证文件。
- 打开 AI OPS。
- 页面显示 ready。
- 模型列表与 CPA 实际可用模型一致。
- 不会自动弹出授权页。

### 6.2 首次登录路径

- 使用没有认证文件的测试环境。
- 点击“开始 Codex 登录”。
- 只打开官方授权页面。
- 完成授权后回到 AI OPS。
- 状态从 waiting 变为 succeeded 或 ready。
- 刷新页面和重启 server 后，认证仍然存在。

### 6.3 失败路径

逐一验证：

- 用户取消授权。
- 授权地址过期。
- CPA 返回 401/403。
- CPA 容器短暂停止。
- 状态查询超过 session 有效期。
- 重复使用同一个 session_id。

每种失败都应得到可理解的提示，不能显示 access token 或原始异常堆栈。

## 7. 检查容器中的持久化结果

认证成功后，确认 CPA 认证目录发生了预期变化：

```powershell
docker compose exec cpa sh -lc "find / -maxdepth 4 -type f 2>/dev/null | grep -E 'auth|codex' | head -50"
docker compose restart cpa
docker compose ps
```

如果容器没有 sh 或路径不同，使用镜像支持的 shell 和已确认的挂载路径。不要用全盘搜索输出认证文件正文。

重启后再次调用：

```powershell
Invoke-RestMethod http://127.0.0.1:4175/api/integrations/cpa/status
```

预期仍是 ready，或至少能读到认证账号，不应退回 auth_required。

## 8. 本步验收

- [ ] 超级管理员能从 AI OPS 发起 Codex OAuth。
- [ ] CPA/New API 管理网站不是日常入口。
- [ ] 只有官方授权页面可能被打开。
- [ ] OAuth state 由 server 生成、限时、一次性使用。
- [ ] OAuth code、access token、refresh token 不出现在日志和 API 响应。
- [ ] 成功后认证结果由 CPA 持久化。
- [ ] 重启 CPA 后认证仍可用。
- [ ] 已认证时不重复要求登录。
- [ ] 失败、过期、取消和服务不可达状态可区分。
- [ ] 模型和额度页面刷新后仍来自真实 CPA 数据。

## 9. 回滚

OAuth 流程代码失败时：

1. 停止新的 OAuth start 路由或关闭前端按钮。
2. 保留已有 CPA 认证目录，不删除认证文件。
3. 恢复上一版 server/web。
4. 用已经存在的认证账号继续只读检查。

```powershell
docker compose stop server web
docker compose up -d server web
```

不要为了回滚删除整个 deploy/cpa/auths 目录。通过后进入 [03｜New API 渠道同步](./03-new-api-channel)。
