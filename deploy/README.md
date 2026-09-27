# 部署说明

最终容器拓扑只有 AI OPS `server` 与 `web`。所有第三方中转站都作为管理员在运行后的“第三方账号”页面中配置的受控上游，不作为本仓库的 Compose 服务、挂载目录或环境变量凭据。

部署前：

1. 将根目录 `docker-compose.env.example` 复制为被 Git 忽略的 `.env`。
2. 设置强管理员密码、`AI_OPS_KEY_ENCRYPTION_SECRET` 与 `AI_OPS_AUDIT_ENCRYPTION_SECRET`。
3. 设置员工设备可访问的 `AI_OPS_PUBLIC_GATEWAY_BASE_URL`。
4. 默认可在管理台接入公共 HTTPS 第三方服务；如需限制可接入范围，再在 `AI_OPS_EXTERNAL_PROVIDER_ALLOWED_HOSTS` 填写精确主机名白名单。
5. 运行 `docker compose up --build`，随后从 `http://127.0.0.1:4174` 登录。

持久卷 `platform-data` 保存员工、Key 摘要、审计数据和加密后的第三方账号注册表。备份该卷前先保护加密密钥；没有相同密钥无法恢复受保护内容。
