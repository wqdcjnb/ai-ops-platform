# AI OPS 部署与交付说明

本文用于将 AI OPS 交付给部署人员、管理员和员工使用。项目默认以 Docker Desktop 运行；首次启动会在本机创建私有 `.env`，其中含管理员密码和加密密钥，**绝不能提交、发送或公开**。

## 运行环境

- Windows 10/11
- 已安装并启动 Docker Desktop（需包含 Docker Compose）
- 员工电脑使用系统自带的 Windows PowerShell 即可；**不需要安装 Node.js**

项目可以放在任意磁盘和任意文件夹。

## 首次启动

1. 解压或克隆项目后，启动 Docker Desktop，等待其状态显示为运行中。
2. 双击项目根目录的 `start-docker.cmd`。
3. 首次运行时，脚本会依次询问访问范围、超级管理员邮箱和密码：
   - 选择“仅本机”时，只能从部署电脑访问。
   - 选择“可信局域网”时，输入服务器的固定局域网 IP 或域名；员工客户端将通过该地址访问模型网关。
   - 选择“公开测试”时，输入公网网页地址和公网网关地址；启动器会绑定 `0.0.0.0`。使用 HTTPS 反向代理时只对外开放代理入口；临时直连测试才转发 `4174`、`4175`。
4. 脚本会创建私有 `.env`、随机加密密钥、数据库密码和管理员账号，构建镜像并启动 `web`、`server`、`postgres`、`redis` 四个服务。
5. 浏览器会打开管理页面，默认地址为 `http://127.0.0.1:4174`；模型网关默认端口为 `4175`。

首次显示的超级管理员密码只会在启动窗口中显示一次，请立即保存到受控密码管理工具中。

## 局域网部署

选择可信局域网后，服务会绑定到 `0.0.0.0`，并把输入的服务器 IP 或域名写入员工网关地址。

- 确保该 IP 或域名在员工电脑上可访问。
- 在 Windows 防火墙或网络设备中仅向可信网段开放 `4174`（管理页面）和 `4175`（网关）。
- 对外网、非受控网络或正式生产环境，请在反向代理后配置 HTTPS，再向员工发放地址。

不要把 `.env` 中的管理员密码、加密密钥、第三方账号凭据或员工平台 Key 发给任何人。

## 临时公开测试

公开测试只适合短期、少量受邀用户验证功能，不等同于生产部署。建议准备一个域名和 HTTPS 反向代理；若直接使用公网 IP 加 HTTP，登录会话和模型请求都可能被窃听。

首次启动选择“公开测试”后，填写：

- 公网网页地址，例如 `https://demo.example.com` 或 `http://公网IP:4174`；
- 公网网关地址，例如 `https://demo.example.com:4175` 或 `http://公网IP:4175`。

如果使用 HTTPS，保持 `.env` 中的 `AI_OPS_COOKIE_SECURE=true`。只有在临时 HTTP 测试时才使用 `false`，并在测试结束后关闭端口、停止服务或恢复本机模式。无论哪种方式，都不要把 PostgreSQL/Redis 端口暴露到公网。

公开测试还需要：

1. 配置 HTTPS 反向代理入口，或仅在临时直连测试时开放 `4174`、`4175`；
2. 把 `.env` 中的 `AI_OPS_PUBLIC_GATEWAY_BASE_URL` 设置成用户真正能访问的网关地址；
3. 使用超级管理员登录后配置第三方账号和模型，再把员工页面地址发给测试人员；
4. 测试结束后执行 `stop-docker.cmd`，并撤销端口映射和防火墙规则。

## 从测试环境迁移到正式部署

仓库只保存通用代码、配置示例与说明。服务器真实 IP、正式域名、管理员凭据和密钥均写在部署机器的私有 `.env`，不需要改业务代码或提交到 GitHub。本机测试成功不等于已完成生产验收。

### 正式部署需要调整什么

| 项目 | 正式部署要求 |
| --- | --- |
| 网页与网关地址 | 将 `AI_OPS_PUBLIC_WEB_BASE_URL`、`AI_OPS_PUBLIC_GATEWAY_BASE_URL` 改成用户可达的正式 HTTPS 域名。已有客户端需重新导入更新后的网关地址。 |
| HTTPS 与登录 | 为正式域名配置有效证书，并设置 `AI_OPS_COOKIE_SECURE=true`；`false` 仅用于 HTTP 测试。 |
| 网页服务 | 当前 Docker `web` 使用 `vite preview`，只适合测试。正式部署需使用 Nginx/Caddy 托管 `apps/web/dist`，为前端路由提供 `index.html` 回退，并将同域 `/api/` 原样代理到 server。不能只在预览服务前套 HTTPS 就视为完成生产改造。[Vite 部署说明](https://vite.dev/guide/static-deploy)明确区分了预览服务与生产服务器。 |
| 网关代理 | 独立网关域名转发到 server 的 `4175`；保留路径、查询参数及鉴权头，关闭流式响应缓冲，代理超时应覆盖应用的请求时限。 |
| 监听与开放端口 | 若反向代理运行在同一宿主机，设置 `AI_OPS_BIND_ADDRESS=127.0.0.1`，对外只开放 HTTPS 入口（按证书方案需要开放 HTTP）。数据库和 Redis 保持 Docker 内网访问。 |
| 管理员与密钥 | 全新正式环境生成独立管理员密码、两组加密密钥以及 PostgreSQL/Redis 密码，不能复用测试凭据。`AUTH_ADMIN_*` 只负责新库初始化，不会改写已有管理员。 |
| 存储与备份 | 使用持久卷，安排异机加密备份并做实际恢复演练；监控磁盘、健康接口、证书和数据库状态。 |
| 容量与来源 IP | 按实际并发、上游配额、长请求与流式请求压测。当前 Fastify 没有配置 `trustProxy`，登录限流看到的是代理 IP；放量前需按实际代理链配置受信任代理并验证，不能无条件信任外部 `X-Forwarded-For`。 |

下面仅是“反向代理与应用在同一宿主机”的配置片段，域名均为占位符，不是可直接上线的完整 `.env`：

```dotenv
AI_OPS_BIND_ADDRESS=127.0.0.1
AI_OPS_WEB_PORT=4174
AI_OPS_GATEWAY_PORT=4175
AI_OPS_PUBLIC_WEB_BASE_URL=https://ops.example.com
AI_OPS_PUBLIC_GATEWAY_BASE_URL=https://gateway.example.com
AI_OPS_COOKIE_SECURE=true
AI_OPS_CORS_ORIGINS=
```

网页按同域 `/api/` 访问时通常不需额外跨域配置。确有额外浏览器来源时，将其精确写入 `AI_OPS_CORS_ORIGINS`，用逗号分隔；它不是任意网站的开放访问开关。如果代理运行在 Docker 内，应通过共享 Docker 网络连接 `server:4175`，不能把宿主机回环地址当成容器内的 server。

全新正式环境可参考 `docker-compose.env.example` 创建私有 `.env` 并替换所有占位密码/密钥，再启动服务。Windows 上也可先运行 `start-docker.cmd -PrepareOnly` 生成配置，设置正式域名及 HTTPS 后再启动。已有测试数据若要迁移，按下文“备份与恢复”携带原加密密钥及数据库凭据；不要直接用新随机密钥连接旧数据。测试账号随数据库一并恢复时，需要另行修改数据库中的管理员凭据，仅修改 `.env` 不会更改它。

### 代码发布边界

提交源代码、`docker-compose.yml`、配置示例、启动脚本与文档。`.env`、`.env.local`、真实证书私钥、备份、数据库文件及 Docker 数据卷仅在部署环境保存。Git 已忽略这些本机配置与运行数据，不要使用 `git add -f` 强制提交。

启动器显式以 UTF-8 读取与写入 `.env`，防止 Windows PowerShell 5.1 在补充配置时反复损坏中文。旧文件若有同名项，读取采用最后一项；更新该项时会移除重复项。已损坏的数据库名称需要单独修复，启动器不会自动覆盖已有账号。

## 日常操作

| 操作 | 使用方式 | 说明 |
| --- | --- | --- |
| 启动或升级 | 双击 `start-docker.cmd` | 默认会重新构建并启动服务。 |
| 停止服务 | 双击 `stop-docker.cmd` | 只停止容器，保留数据库和第三方账号加密配置。 |
| 创建备份 | 双击 `backup-docker.cmd` | 在 `backups/` 创建带时间戳的数据归档。 |
| 员工导入配置 | 在员工门户点击“导入 Codex”或“导入 WorkBuddy” | 自动写入 AI OPS，已有模型和对话不会被删除。 |

## 员工最简使用流程

员工只需要完成以下流程：

1. 注册或登录员工账号。
2. 点击“申请 Key”。
3. 点击“导入 Codex”或“导入 WorkBuddy”。

首次在一台电脑上导入时，员工门户会自动打开本机 AI OPS 助手；若该电脑未安装助手，页面会显示“下载并运行一次安装助手”。该安装包只需运行一次，不需要管理员权限，也不需要安装 Node.js。之后员工每次只需点击导入按钮。

管理员也可以将员工门户提供的 `AI-OPS-助手安装.cmd` 预装到受管电脑。预装后，员工从注册/登录到导入均无需额外本机操作。

导入时浏览器只交给本机助手一个五分钟内有效、只能使用一次的配置请求；员工 Key 不会放进下载链接、浏览器历史或手工配置步骤中。助手仅新增 AI OPS 配置，且会先备份已有 Codex 或 WorkBuddy 模型配置；不会读取或删除既有对话记录。

## 存储与首次升级

目录仍为 `apps/server`、`apps/web` 和 `scripts`，未拆分项目或更换前端框架。

| 服务 | 保存什么 | Docker 持久卷 |
| --- | --- | --- |
| PostgreSQL 18 | 人员、登录会话、员工 Key、第三方账号、模型目录、用量、审计和加密对话正文 | `postgres-v2-data` |
| Redis 8 | 共享并发额度、请求限流、账号健康与熔断状态 | `redis-v2-data` |
| server 的原数据目录 | 升级前 SQLite/JSON 和迁移备份，仅供回退 | 原 `platform-data` |

实际卷名带 Compose 项目前缀。PostgreSQL/Redis 只在内部 Docker 网络通信，**没有向主机映射 5432/6379 端口**。原有名称为 `postgres-data` 的卷不会被本次升级使用或覆盖。不要执行 `docker compose down -v`，它会删除本项目的数据卷。

升级现有部署：保留原 `.env`、`platform-data`、旧镜像和源码备份，再运行 `start-docker.cmd`。启动器只补充缺失的 PostgreSQL/Redis 随机密码，不更换加密密钥。首次启动执行：

1. 在原数据目录内创建一致性 SQLite 快照、复制加密第三方账号 JSON。
2. 在事务中导入人员、Key、会话、用量及审计，核对每张表数量、恢复序列、检查 Key 可解密。
3. 将第三方账号逐行导入 PostgreSQL，保持凭据加密，记录独立迁移标记。
4. 后续启动只读 PostgreSQL，不会反复导入旧文件。原文件保留但不再更新。

只支持已经完成最终版表结构清理的旧库。发现非空且没有迁移标记的目标库、无法解密的 Key 或不兼容数据时停止启动，不覆盖目标数据。首次迁移前要暂停员工调用，并确保没有另一份旧版服务还在写同一 SQLite/JSON 文件。

升级保留原员工 Key、账号、有效会话和已保存记录，不要求员工重新导入客户端。正常的到期会话清理与既有 30 天日志/正文保留策略仍会执行。旧源码不能直接连接新数据库；回退需要先停止新版写入，再恢复旧镜像、原 `.env` 和原数据卷。**回退到旧 SQLite 不包含升级后新增的数据**，生产切换后如要回退应先备份 PostgreSQL 并制定反向迁移方案。

## 备份与恢复

双击 `backup-docker.cmd`，在 `backups/ai-ops-时间戳/` 生成：

- `platform.dump`：PostgreSQL 一致性在线备份，包含第三方账号，不是复制运行中的数据库文件。
- `legacy-data.tar.gz`：原数据目录的迁移/回退资料。
- `.env`：原加密密钥与数据库凭据，**此文件包含明文秘密**。
- `manifest.json`：时间、文件大小及 SHA-256 校验值。

脚本使用 `pg_restore --list` 校验备份目录，备份失败会报错；完整可恢复性仍需定期在独立数据库做实际还原演练。备份目录被 Git 忽略，但并未额外加密，需保存在受控位置并另做离机加密备份。当前不自动安排每日备份或删除旧备份，部署人员应安排周期任务并监控磁盘。

恢复到**新机器或确认无数据的空数据库**：

1. 恢复项目与备份中的原始 `.env`，先只启动数据库：`docker compose up -d postgres redis`。
2. 将备份传入容器：`docker compose cp "备份目录/platform.dump" postgres:/tmp/ai-ops-restore.dump`。
3. 执行 `docker compose exec -T postgres pg_restore -U ai_ops -d ai_ops --no-owner --no-acl --exit-on-error --single-transaction /tmp/ai-ops-restore.dump`。
4. 成功后运行 `start-docker.cmd`；验证人员、Key、第三方账号与审计，再开放员工访问。临时文件可用 `docker compose exec -T postgres rm -f /tmp/ai-ops-restore.dump` 删除。

不要在非空库直接恢复，也不要加 `--clean` 或删除旧卷试错。若机器只安装独立 Compose 命令，把以上 `docker compose` 替换为 `docker-compose`。Redis 不存主业务数据，无需从备份恢复；重建后限流窗口/健康状态重新积累，先确认旧实例已停止接收请求。

`.env` 中的加密密钥必须与数据匹配。已有卷却丢失 `.env` 时不要重新生成密钥，应恢复原文件，否则员工 Key 和第三方凭据无法解密。修改 `.env` 的数据库密码并不会自动修改已有 PostgreSQL 用户密码。

## 并发与路由配置

下列值是起始保护参数，不是已经证明的最大承载量。在 `.env` 中调整后重新运行启动器：

| 参数 | 默认值 | 作用 |
| --- | ---: | --- |
| `AI_OPS_DB_POOL_SIZE` | 20 | 每个 server 的 PostgreSQL 连接数 |
| `AI_OPS_GATEWAY_CONCURRENCY` | 200 | 所有 server 合计的模型调用并发上限 |
| `AI_OPS_EMPLOYEE_CONCURRENCY` | 4 | 单员工模型调用并发上限，重置 Key 不绕过该限制 |
| `AI_OPS_PROVIDER_CONCURRENCY` | 12 | 单第三方账号并发上限 |
| `AI_OPS_EMPLOYEE_RPM` | 120 | 单员工每分钟模型请求上限 |
| `AI_OPS_MAX_WAITING` | 100 | 每实例同时等待并发额度的请求上限 |
| `AI_OPS_RELAY_PROBE_FANOUT` | 3 | 轻量模型目录探测并发，范围 2–8 |
| `AI_OPS_RELAY_MAX_ATTEMPTS` | 3 | 文本请求最多尝试次数，含首个请求，最大 8 |
| `AI_OPS_GATEWAY_TIMEOUT_MS` | 60000 | 整次模型请求的时间预算，包括路由与重试 |

共享额度满时最多短暂等待 1 秒，然后返回 429，Redis 不可用时拒绝新调用而不是取消限额。后台轮转并行探测，优先参考共享健康状态、实际响应耗时和账号负载；不是每条请求都访问全部账号。探测 `/models` 只代表基础连通性，不等同于生成速度。真实生成不做多站竞速；流式内容已输出后不重试，图片/视频/语音生成不自动重试，避免重复任务或计费。

流式日志按秒限频检查点写入，单请求片段缓冲有上限，输出按客户端接收速度转发。进程异常退出时最后一个检查点后的片段可能缺失；达到片段上限会标记截断，不承诺宕机时正文零丢失。人员和模型分析改为数据库分组汇总，不再把全部历史请求拉回服务端进行统计。

500 人注册使用与 500 条长请求同时执行不是一回事。当前 Compose 仍是单机单 server，没有自动扩容、数据库主从或跨主机容灾。后续可以增加 server 副本及负载均衡，但总连接池要小于 PostgreSQL 连接额度，HTTPS/代理还需正确配置流式超时和转发 IP。正式放量前按实际模型时长、上游配额、带宽和机器规格压测，再调整上述限额。

## 检查与验证

- `/health`：同时检查 PostgreSQL 与 Redis；不可用返回 503，Docker 健康检查使用此接口。
- `/api/system/status`：仅超级管理员可读，包含数据库连接池、Redis 状态、等待数、进程内存与运行时长，不返回凭据。
- `docker compose ps`：检查四个服务状态；容器异常退出自动重启，但 `unhealthy` 本身不会触发 Docker 自动重启，需部署方监控告警。
- `npm run typecheck`、`npm run build`、`npm test`：静态检查、构建与测试。完整存储测试需单独提供 `TEST_DATABASE_URL`/`TEST_REDIS_URL`，不要指向线上；测试会建删自己的 PostgreSQL schema，并写入测试 Redis 键。
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/tests/start-docker.test.ps1`：在独立临时文件中验证启动器 UTF-8 读写、重复配置和 HTTP/HTTPS 设置，不接触实际 `.env` 或 Docker 数据。
- 当前没有自动执行真实第三方模型的付费压测。迁移测试、模拟上游流式测试不能代替生产容量验收。

## 常见问题

- **提示未找到 Docker 或 Docker Compose：** 安装并启动 Docker Desktop 后重试。
- **服务启动后网页打不开：** 检查 Docker Desktop 是否正常运行，并确认 `4174` 端口未被其他程序占用。
- **局域网员工无法访问：** 检查服务器 IP、Windows 防火墙规则、网段连通性，以及 `.env` 中的 `AI_OPS_PUBLIC_GATEWAY_BASE_URL` 是否为员工可访问的地址。
- **启动时提示已有数据卷但 `.env` 缺失：** 从备份恢复原来的 `.env`；不要直接新建一个配置文件。

## 交付清单

交付给部署人员：项目目录、本文档、Docker Desktop 安装要求和受控方式保存的 `.env` / 备份文件。

交付给普通员工：管理页面地址和个人账号。若未由管理员统一预装助手，员工首次导入时从门户下载并运行一次 `AI-OPS-助手安装.cmd`；不要交付 `.env`、备份文件、第三方中转站凭据或其他员工的 Key。
