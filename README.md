# AI OPS 管理平台

AI OPS 是一个面向超级管理员的统一管理平台。CPA 和 New API 随项目一起在 Docker Compose 中启动，由 AI OPS 服务端统一管理；管理员不需要分别打开、登录或配置 CPA/New API 管理网站。

当前固定链路：

```text
超级管理员 → AI OPS → New API Token/渠道 → CPA → Codex
```

## 已冻结的产品边界

- 当前只有一个超级管理员，不建设员工客户端、员工登录或员工自助端。
- 管理员在 AI OPS 导入员工、选择 CPA 实际模型、创建和分发 Key、查看状态与审计。
- 员工最终拿到的是 AI OPS 调用 New API 创建的用户 Token/API Key。
- CPA 客户端 API Key 只用于 New API 配置 CPA 渠道，不能作为员工 Key 分发。
- 一个人员可以有多个 Key，一个模型可以有多个 Key；一个 Key 只能绑定一个人员和一个模型。
- 不使用分组；员工 Key 默认无限额度、永不过期，模型限制、额度和有效期以 New API 为最终来源。
- 人员停用时，AI OPS 必须调用 New API 停用其全部关联 Token。
- 对话审计以 Key 为第一维度，必须保存真实 Prompt 和回复正文；正文默认最多保留 30 天，超级管理员可以复制/导出，操作必须审计。

当前代码仍包含需要清理的本地演示数据和原型页面；“需求已冻结”不等于这些能力已经完成。真实 New API Token 写操作、CPA 渠道同步、正文采集和生产审计需按验收标准实现。

## 文档中心

文档站位于 [`docs-site/`](docs-site/)，重点文档如下：

- [完整需求](docs-site/content/requirements/overview.md)
- [核心功能](docs-site/content/requirements/core.md)
- [实施范围](docs-site/content/requirements/phases.md)
- [验收标准](docs-site/content/requirements/acceptance.md)
- [架构与职责](docs-site/content/technical/architecture.md)
- [安全方案](docs-site/content/technical/security.md)
- [CPA 与 New API 编排](docs-site/content/guides/cpa.md)
- [项目待办](docs-site/content/records/todo.md)

本地运行文档站：

```powershell
cd docs-site
npm.cmd ci
npm.cmd run dev
```

访问 <http://127.0.0.1:4173>。构建和内容检查：

```powershell
npm.cmd run build
npm.cmd run check
```

## Docker 启动

Docker Compose 会一起启动 `web`、`server`、`new-api` 和 `cpa` 四个服务：

```powershell
Copy-Item docker-compose.env.example .env
docker-compose up -d --build
```

Windows 也可以运行根目录的 `start-docker.cmd`。Docker Desktop 需要保持运行。

默认管理入口：<http://127.0.0.1:4174>。

首页“统一入口”会显示这四个 Compose 容器的 health 状态。默认挂载 Docker Engine
socket，以便管理员在服务矩阵中重启整套服务或单个服务；如果只需要查看状态，设置
`AI_OPS_DOCKER_CONTROL=false` 后重新启动 Compose 即可关闭重启能力。

运行数据位置：

- CPA OAuth 和配置：`deploy/cpa/`
- New API 数据：`deploy/new-api/data/`
- AI OPS 平台数据：Docker 持久化卷

这些目录和 `.env` 只用于本机运行，不能提交 Git。New API/CPA 的本机端口仅用于受控调试或健康检查，不是管理员日常入口。

## 配置原则

New API 管理令牌、CPA 管理 Key、CPA 客户端 API Key 和 OAuth 文件只由 AI OPS 服务端读取。管理员在 AI OPS 中查看连接、认证、模型、额度和同步状态；不得把凭据复制到浏览器或上游管理页面。

如果需要官方 OAuth 授权，流程由 AI OPS 发起并回到 AI OPS。CPA 额度读取以当前版本管理适配器返回的真实数据为准；不可读时显示未知，不从 OAuth 文件推算。

## 开发验证

修改文档后在 `docs-site` 目录执行：

```powershell
npm.cmd run build
npm.cmd run check
```

修改业务代码后，还需要按项目实际脚本执行类型检查、测试、Docker 冷启动、依赖停止/恢复、人员停用联动和 Key 单模型限制验证。

## 安全底线

- 不提交 API Key、OAuth Token、认证文件、数据库、日志、备份或含密钥的 `.env`。
- 浏览器不直连 New API/CPA 管理接口，不嵌入或链接其管理页面。
- 不用演示数据冒充真实人员、Token、额度、日志或正文。
- 正文采集必须在真实请求链路完成，历史未采集内容不能伪造补齐。
