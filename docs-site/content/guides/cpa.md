# CLIProxyAPI 本地体验安装

::: info 资料来源与验证状态
本页从历史交付文档整理。部署情况以[常用入口](/portal)的最新检查为准；业务功能描述属于需求或项目声明，未完成端到端验证。
:::



- 管理面板：http://127.0.0.1:8317/management.html
- 管理密钥、客户端 Key 和 Base URL：见同目录「登录信息.txt」。
- 启动：双击「启动.cmd」。停止：双击「停止.cmd」。
- 接入 Codex Pro：双击「Codex账号登录.cmd」，在 OpenAI 官方页面完成授权。当前安装没有导入任何账号。

本机部署使用官方 Windows amd64 发布版 7.3.2，并已校验 SHA-256。服务仅监听 127.0.0.1，不允许远程管理，没有注册 Windows 服务或开机启动。

管理面板使用官方 Management Center 1.23.1，已校验发布资产 SHA-256。安装检查已通过：模型接口、管理页面和管理 API 均返回 HTTP 200。未登录账号前，模型数量显示为 0 属正常现象。

CLIProxyAPI 支持多个客户端 API Key，但原生 Key 没有单独金额/Token 配额。本方案由 New API 负责人员、独立 Key、模型权限、额度和用量统计；CPA 只负责 Pro OAuth 实验渠道与协议适配。

`settings.json`、`config.yaml`、`登录信息.txt` 和 `auths` 含凭证，请勿公开、上传或提交仓库。

