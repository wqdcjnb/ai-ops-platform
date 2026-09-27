# AI OPS 统一模型网关

AI OPS 让员工使用一个平台 Key 和一个模型 ID：`ai-ops`。管理员维护第三方账号与模型目录；网关负责路由、故障切换、审计和多模态请求分发。

## 一键 Docker 启动

安装并启动 Docker Desktop 后，双击根目录的 `start-docker.cmd`。首次运行会创建私有 `.env`、随机加密密钥和超级管理员账号，然后自动启动管理页面。

详细交付、局域网、员工 Codex / WorkBuddy 配置、备份与升级说明见 [DEPLOYMENT.md](DEPLOYMENT.md)。

> 不要把 `.env`、`backups/`、Docker 数据卷、第三方账号凭据或员工 Key 发给其他人。

## 开发验证

~~~powershell
npm run typecheck
npm test
~~~
