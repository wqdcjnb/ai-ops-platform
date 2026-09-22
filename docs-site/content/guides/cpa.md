# CPA 与 New API 的项目内编排

::: info 使用边界
CPA、New API、AI OPS 由根目录 `docker-compose.yml` 一起启动。管理员日常只使用 AI OPS；本页说明内部依赖关系和故障排查，不要求打开 CPA 或 New API 管理网站。
:::

## 运行关系

```text
AI OPS（唯一管理入口）
  ├─ 服务端适配器 → New API（人员、员工 Token、渠道、日志）
  │                    └─ CPA 客户端 API Key → CPA
  └─ 服务端适配器 → CPA（OAuth、账号、模型、额度）
                         └─ Codex OAuth → Codex
```

- Docker Compose 负责启动、依赖顺序和 healthcheck。
- CPA 的 `auths`、配置和日志使用持久化挂载；容器重启不应删除认证目录。
- New API 数据库和 CPA 认证文件属于运行时数据，必须保持在 Git 忽略范围。
- CPA/New API 的管理端口即使绑定到本机，也只用于受控调试或健康检查，不是业务入口。

## 在 AI OPS 内完成接入

1. 启动整套 Compose 服务，等待 AI OPS 首页显示 New API、CPA 和 Docker 状态。
2. 在 AI OPS 的 CPA 页面选择一种入口：发起浏览器 Codex OAuth，或直接选择其他电脑导出的 `~/.codex/auth.json`。也兼容 CPA 已生成的 Codex JSON 文件；不需要进入 CPA 管理面板。
3. 上传 Codex CLI 文件时，AI OPS 只在服务端内存中把 `auth_mode + tokens` 转成 CPA 所需的 `type: codex` 文件，再交给 CPA 热加载。只有 `OPENAI_API_KEY` 的 API-key 登录不是 OAuth 账号池凭据，会被明确拒绝。
4. 导入或 OAuth 完成后，AI OPS 使用 CPA 返回的 `auth_index` 代理 Codex `wham/usage` 进行真实认证验证；页面区分“验证通过”“已接入但等待 CPA”“验证失败”和“验证暂不可用”，不把 Token 返回给浏览器。
5. AI OPS 服务端从 CPA 读取认证账号、真实模型目录和可用额度摘要。字段暂不可读时显示“未知/暂不可读”，不从 OAuth 文件内容推算。
6. AI OPS 服务端读取 CPA 客户端 API Key，通过 New API 管理接口幂等校验或创建 CPA 渠道。管理员不手动复制 CPA Key，也不在 New API 页面配置渠道。
7. 模型在 AI OPS 中选择；创建员工 Key 时由 AI OPS 调用 New API 创建 Token/API Key，并写入一个人员和一个模型、无限额度、永不过期。
8. AI OPS 只向超级管理员一次性显示员工 Key；CPA 客户端 Key、CPA 管理 Key 和 OAuth 文件不进入分发流程。
9. 后续人员停用、Key 停用、重新生成、日志查询和正文审计都在 AI OPS 完成。

## 统一状态与恢复

AI OPS 应显示以下状态，而不是让管理员猜测上游页面是否正常：

| 状态 | 含义 | 管理员动作 |
| --- | --- | --- |
| `starting` | Compose 已启动，依赖尚未就绪 | 等待或刷新 AI OPS |
| `ready` | 连接、认证和渠道同步均通过 | 正常使用 |
| `auth_required` | CPA OAuth 未完成或已失效 | 在 AI OPS 重新发起认证 |
| `degraded` | 依赖离线、超时或额度暂不可读 | 查看 AI OPS 错误原因，恢复后重试 |
| `sync_failed` | 渠道、人员或 Token 同步失败 | 在 AI OPS 执行幂等重试，不手动进入上游后台 |

停止或重启 New API/CPA 后，AI OPS 必须重新探测并恢复状态。恢复操作不能重复创建渠道或员工 Token；部分成功要显示成功/失败对象清单。

## 凭据边界

| 凭据 | 保存方 | 用途 | 是否分发给员工 |
| --- | --- | --- | --- |
| Codex OAuth 认证文件 | CPA 持久化目录 | 访问 Codex | 否 |
| CPA 客户端 API Key | CPA/服务端配置 | New API 创建或更新 CPA 渠道 | 否 |
| New API 渠道配置 | New API | 把请求转发给 CPA | 否 |
| New API 员工 Token/API Key | New API | 员工未来调用入口 | 是，仅一次性向超级管理员展示 |

任何管理令牌、OAuth、刷新令牌和完整 Key 都不能进入浏览器普通响应、日志、截图或 Git。

## 正文审计注意事项

New API 普通日志可能只有 Token、模型、时间、用量和状态。要在 AI OPS 按 Key 查看真实 Prompt 和回复正文，必须在 New API 真实请求处理链路采集入站和出站内容，并关联 `token_id`、内部 `key_id` 和 `request_id`。流式、失败、中断和工具调用都要保存真实状态；正文加密保存，默认最多 30 天，超级管理员查看/复制/导出均记录审计。

如果历史请求没有正文记录，AI OPS 必须明确显示“无正文记录”，不能根据 Token 用量或示例文本补齐。

## 故障排查顺序

1. 先看 AI OPS 首页的依赖状态、版本和最近错误。
2. 确认 Compose 容器和 healthcheck 状态；不要先打开上游管理网站修改数据。
3. 在 AI OPS 执行重新探测或幂等同步，观察渠道差异和响应摘要。
4. 如果是 OAuth 失效，在 AI OPS 重新发起认证；不要上传未经平台校验的认证文件到浏览器或 Git。
5. 如果额度接口字段不兼容，保留“额度暂不可读”状态并记录适配器版本，不能伪造额度。
