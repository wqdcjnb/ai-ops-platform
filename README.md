# AI OPS 统一模型网关

AI OPS 让员工注册/登录后申请一个平台 Key，并一键导入 Codex 或 WorkBuddy。管理员维护第三方账号与模型目录；网关负责路由、故障切换、审计和多模态请求分发。

## 一键 Docker 启动

安装并启动 Docker Desktop 后，双击根目录的 `start-docker.cmd`。首次运行会创建私有 `.env`、随机加密密钥和超级管理员账号，然后自动启动管理页面。

数据库已升级为 Docker 中的 PostgreSQL 18；Redis 8 负责共享并发额度、限流和站点健康状态。第三方账号与加密凭据同样存入 PostgreSQL。旧版本首次升级会备份并自动迁移 SQLite/JSON 数据，员工 Key 和登录入口不变。两种数据库均使用持久卷，默认不开放主机端口。

员工首次在一台电脑上安装轻量 AI OPS 助手后，后续只需点击“导入 Codex”或“导入 WorkBuddy”；无需安装 Node.js，也不会覆盖已有对话。详细交付、局域网、备份与升级说明见 [DEPLOYMENT.md](DEPLOYMENT.md)。

> 不要把 `.env`、`backups/`、Docker 数据卷、第三方账号凭据或员工 Key 发给其他人。

## 本地构建验证

~~~powershell
npm run typecheck
npm run build
npm test
~~~

完整数据库集成测试需要专用的 `TEST_DATABASE_URL` 与 `TEST_REDIS_URL`，未设置时只运行纯逻辑测试，绝不使用线上连接。容量参数、迁移回退及备份恢复见部署文档。
