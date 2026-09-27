# Codex 与 WorkBuddy 接入

员工对外只使用一个模型：`ai-ops`（显示名 `AI OPS`）。底层账号、原始模型和上游凭据均不会写入客户端配置。

## 1. 接入方式

员工门户只有一个“导入配置”入口：

| 客户端 | 动作 | 结果 |
| --- | --- | --- |
| Codex | 调用本机 AI OPS 客户端连接器，先检测登录状态再直接写入配置 | 更新当前用户的 `~/.codex/config.toml` 和 `AI_OPS_TOKEN` 用户环境变量 |
| WorkBuddy | 调用同一个本机 AI OPS 客户端连接器 | 更新当前用户的 `~/.workbuddy/models.json` |

两种操作都只新增或更新 AI OPS Provider，绝不删除客户端的其他 Provider、项目设置或对话记录。浏览器不下载 TOML/JSON，也不把 Key 放入 URL 或下载目录。

## 2. Codex 直接配置

Codex 的自定义 Provider 必须写在用户级 `~/.codex/config.toml`，而不是项目内 `.codex/config.toml`；项目级文件不能覆盖机器本地 Provider 相关设置。Codex 支持自定义 Provider 的 `base_url`、`env_key`、`requires_openai_auth` 和 Responses 协议。[OpenAI 官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)

员工打开导入弹窗时，连接器会执行只读的 `codex login status` 检测，并仅向门户返回以下粗粒度状态：

| 状态 | 门户提示与行为 |
| --- | --- |
| 已登录 | 直接加入 AI OPS Provider；现有 Codex 对话和官方账号配置不受影响 |
| 未登录 | 仍可直接配置 AI OPS，因为其使用员工自己的平台 Key；不会创建虚拟身份 |
| 未检测到 Codex | 仍可写入用户级配置；安装或打开 Codex 后生效 |
| 状态未知 | 不阻断配置，提示员工重新打开 Codex 后确认 |

连接器不会读取、上传、替换或生成 Codex `auth.json`，也不会模拟 OpenAI/ChatGPT 登录。若员工还要使用官方 OpenAI 服务，仍应使用自己的真实登录方式；AI OPS 的自定义 Provider 则由独立平台 Key 鉴权。

写入后的核心配置如下，其中 `<gateway-base-url>` 由平台填入，且会规范为 `/v1`：

~~~toml
# 写入用户级 ~/.codex/config.toml；保留其他既有设置。
model = "ai-ops"
model_provider = "ai-ops"

[model_providers.ai-ops]
name = "AI OPS"
base_url = "<gateway-base-url>/v1"
env_key = "AI_OPS_TOKEN"
requires_openai_auth = false
wire_api = "responses"
request_max_retries = 0
stream_max_retries = 0
~~~

写入流程按以下顺序执行：

1. 读取当前用户级配置；如已有文件，创建带时间戳的备份。
2. 仅更新顶层 `model`、`model_provider` 和 `[model_providers.ai-ops]` 段，其他 TOML 段保留。
3. 以原子替换方式写回配置。
4. 将当前员工的完整平台 Key 写入当前 Windows 用户的 `AI_OPS_TOKEN` 环境变量；它不会回传到浏览器响应、普通日志或配置文本。
5. 提醒员工重新打开 Codex，使新进程读取新环境变量与配置。

连接器不会主动关闭正在运行的 Codex，因此不会中断或删除现有对话。重新打开后，新发起的 Codex 会话默认使用 `ai-ops`；已有会话的模型切换能力仍由 Codex 版本决定。

## 3. 本机客户端连接器

在安装 AI OPS 的电脑上启动一次连接器：

~~~powershell
npm run connector:local
~~~

Windows 本地部署建议直接运行项目根目录的 `start-docker.cmd`；它会在打开门户前自动检查并启动该连接器。若连接器不可用，员工门户会提示本机配置服务不可达，而不会误报 Key 或模型问题。

连接器只监听 `http://127.0.0.1:4176`，默认只接受来自 `http://127.0.0.1:4174` 或 `http://localhost:4174` 的浏览器请求。其接口仅限于：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 本机启动检查，不返回密钥或配置 |
| `GET` | `/v1/codex/status` | 检测安装与登录状态，不读取账号资料 |
| `POST` | `/v1/codex/configure` | 直接写入 Codex AI OPS Provider |
| `POST` | `/v1/workbuddy/configure` | 直接写入 WorkBuddy AI OPS 模型 |

员工点击客户端按钮时，页面把当前 Key 和 AI OPS 网关地址发送给本机回环连接器；Key 不进入 URL、下载目录或服务端普通日志。接口响应不回传完整 Key、本机路径、配置正文、Codex 账号信息或 `auth.json` 内容。

若员工门户部署在公司域名而不是本机 `4174` 端口，启动连接器前将该门户完整来源加入白名单。例如门户为 `https://aiops.example.com`：

~~~powershell
$env:AI_OPS_WORKBUDDY_CONNECTOR_ORIGINS = 'https://aiops.example.com'
npm run connector:local
~~~

连接器仍只监听本机回环地址，白名单只用于确认发起写入请求的门户页面，不会把员工 Key 暴露给局域网或公网。

## 4. WorkBuddy 直接配置

WorkBuddy 使用其本机自定义模型配置路径；AI OPS 不再下载 JSON。[WorkBuddy 模型配置说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)

连接器更新的是：

~~~text
~/.workbuddy/models.json
└─ AI OPS
   ├─ id: ai-ops
   ├─ url: <gateway-base-url>/v1/chat/completions
   └─ apiKey: 当前员工的平台 Key
~~~

写入策略：

1. 仅移除或替换已有的 AI OPS 条目，保留其他自定义模型。
2. 如果存在活动配置，先生成时间戳备份，再原子替换配置文件。
3. 如果只有旧的 `models.json.bak`，则以它为基础恢复非 AI OPS 模型，再写入正确的 `ai-ops` 条目。
4. 不读取、不迁移、不删除 `.workbuddy/workbuddy.db`、工作区或任何对话缓存。

## 5. 多模态与客户端边界

导入配置固定的是模型身份与鉴权方式，不承诺客户端天然拥有所有媒体 UI：

| 使用位置 | 适合能力 | 当前边界 |
| --- | --- | --- |
| Codex | 文本、代码和工具调用 | 使用 Responses Provider；未提供视频工作台 |
| WorkBuddy | 文本、代码和其版本支持的 OpenAI 兼容能力 | AI OPS 先注册为稳定的聊天/工具调用模型 |
| 标准 API | 文本、图片、视频、语音 JSON 端点 | 同一 Key 和 `ai-ops` |

无论使用哪个客户端，网关都会通过并发的轻量探测选择一个最快健康候选，再只提交一次真实请求。客户端不会接触底层路由过程。

## 6. 对话连续性

导入或更新 Provider 不删除、重置或迁移 Codex / WorkBuddy 的既有配置和会话文件。已有对话留在各自客户端；网关路由、Key 轮换和故障回退都不会主动清除它们。

“平台保存调用审计”与“第三方客户端能在任意设备完整恢复历史 UI”不是同一能力。完整跨设备会话恢复仍需要稳定线程 ID、完整 turn 持久化和客户端历史恢复协议，不能把当前审计日志误称为聊天备份。
