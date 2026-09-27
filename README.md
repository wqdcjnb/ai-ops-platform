# AI OPS 多中转站统一模型网关

AI OPS 面向一个超级管理员和多个员工。管理员接入多个已授权的 OpenAI 兼容中转站；员工只获得一个平台 Key，并且只看见一个虚拟模型：**AI OPS**（API ID：`ai-ops`）。

AI OPS可路由文本、代码、图片、视频和语音接口。网关在健康缓存过期时并发探测多个候选中转站（默认 3 个，可配 2–8），选择最快成功站点后只执行一次真实生成请求；不会以并发竞速方式重复发送员工的提示词或媒体任务。

~~~text
员工 / Codex / WorkBuddy
          │ 平台 Key + ai-ops
          ▼
AI OPS OpenAI 兼容网关
          │ 并发测速、路由、限流、熔断、审计
          ▼
多个已授权第三方中转站
~~~

## 当前功能

- 员工可用真实姓名、邮箱和密码注册；登录后首次创建一个 Key，并可自行重置。
- 超级管理员通过“人员信息管理”启停、删除员工、重置密码为 `123456`，或主动重置员工 Key；管理员不能创建员工账号。
- “第三方账号”保存服务地址和加密凭据、健康度、最后同步时间及已选模型数量；管理员先获取模型列表、可一键全选或逐项选择，并可在保存前查看可用性与延迟测试结果。文本、图片、视频和语音候选在服务端分组，单一 `ai-ops` 会按调用端点选择匹配组。
- 员工门户通过本机连接器直接写入 Codex 与 WorkBuddy 配置；两者都只新增或更新 AI OPS Provider，不删除或重置已有对话。Codex 会先检测登录状态，但 AI OPS 自定义 Provider 不需要伪造或使用 OpenAI/ChatGPT 身份。
- Codex 使用自定义 Provider、`requires_openai_auth = false` 与 `ai-ops`，因此是否登录 OpenAI/ChatGPT 账号不影响接入 AI OPS。

## 本地启动

1. 复制 [apps/server/.env.example](apps/server/.env.example) 为 `apps/server/.env.local`，填写管理员密码和两项加密密钥。
2. 在管理员界面添加第三方账号并同步模型。默认可接入公共 HTTPS 服务；如需收紧部署范围，可用 `AI_OPS_EXTERNAL_PROVIDER_ALLOWED_HOSTS` 配置精确主机白名单。
3. 启动开发环境：

~~~powershell
npm run dev:server
npm run dev:web
~~~

在需要从员工门户直接接入 Codex 或 WorkBuddy 的电脑上，额外启动本机连接器：

~~~powershell
npm run connector:local
~~~

它只监听 `127.0.0.1:4176`，只更新当前 Windows 用户的 Codex/WorkBuddy AI OPS 条目；不会读取 `auth.json`、不会改写会话文件。

容器部署只包含 AI OPS 的 `server` 和 `web` 两个服务；复制 [docker-compose.env.example](docker-compose.env.example) 为本地 `.env` 后执行 `docker compose up --build`。

Windows 本地一键启动请使用 `start-docker.cmd`。它会在打开员工门户前检查并启动仅监听本机回环地址的本地客户端连接器，因此“直接接入 Codex”与“导入 WorkBuddy”都会直接修改配置而不会下载文件。

## 文档

详细最终方案在 [docs-site](docs-site/)：

1. [产品需求与边界](docs-site/content/product/requirements.md)
2. [总体架构](docs-site/content/technical/architecture.md)
3. [网关与并发测速](docs-site/content/technical/gateway.md)
4. [多模态路由](docs-site/content/technical/multimodal.md)
5. [Codex / WorkBuddy 接入与对话连续性](docs-site/content/technical/connectors.md)
6. [交付验收](docs-site/content/delivery/acceptance.md)

## 验证

~~~powershell
npm run typecheck
npm test
~~~

不要把真实中转站凭据、员工 Key、密码或加密密钥提交到 Git。
