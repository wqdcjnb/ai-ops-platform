# 核心功能清单

本文是 AI OPS V2.3 的最小产品范围。AI OPS 只有一个超级管理员入口；CPA 和 New API 随 Docker Compose 一起运行，由 AI OPS 服务端统一接管；CPA 的客户端 API Key 仅用于 New API 渠道，员工接入 Key 固定由 New API 创建和管理；CPA 负责 Codex OAuth、模型和真实账号额度。

| 编号 | 模块 | 最小目标 | 事实源 | 当前状态 |
| --- | --- | --- | --- | --- |
| M01 | 超级管理员 | 单一管理员登录、会话、退出和管理审计 | AI OPS | 已有基础方案，需移除多角色入口 |
| M02 | 人员目录 | 导入并同步 New API 用户，展示 id、username、status、created_at、last_used_at 和管理操作 | New API + AI OPS | 已有导入原型，需接入用户写接口 |
| M03 | New API 连接 | 服务端管理认证、渠道/Token 写操作、健康检查、版本识别和幂等同步；管理员不进入 New API 网站 | New API | 已有只读连接，需补齐渠道与 Token 合约 |
| M04 | CPA 连接 | 通过服务端适配器管理 Codex OAuth、认证账号、模型和额度状态；管理员不进入 CPA 网站 | CPA | OAuth 链路已有，需补真实摘要/额度 |
| M05 | 模型选择 | 读取 CPA 真实模型并校验 New API 可路由性 | CPA + New API | 现有目录含演示数据，需改为真实来源 |
| M06 | Key 管理 | 调用 New API 创建/查询/停用/删除/重新生成和一次性分发员工 Key | New API | 当前仍有本地 SQLite Key，需迁移到 New API Token |
| M07 | Key 关系 | 一 Key 一人员、一模型；人员和模型均可关联多个 Key | AI OPS 映射 + New API Token ID | 现有字段支持部分关系，需固定外部事实源 |
| M08 | Key 策略 | New API Token 无限额度、永不过期、单模型限制 | New API | 当前额度/有效期仍混有本地演示 |
| M09 | Key 日志/对话审计 | 以 Key/Token ID 查询真实请求、Prompt 和回复正文 | New API + 正文采集层 | 当前主要是模拟数据，需改真实读取和加密正文存储 |
| M10 | 同步与安全 | 停用联动、幂等写入、失败不落成功、凭据隔离 | AI OPS + 上游 | 基础安全已有，需覆盖写操作 |

## 必须坚持的规则

- AI OPS 只给超级管理员使用，不提供员工客户端、员工登录或员工自助端。
- AI OPS 是唯一管理入口；New API/CPA 管理网站不属于业务流程，管理员不需要手动打开或配置。
- Docker Compose 启动后，AI OPS 必须自动完成 New API/CPA 健康检查、版本识别、认证状态读取和 CPA 渠道同步；所有结果在 AI OPS 展示。
- 浏览器只访问 AI OPS 前端；New API 管理令牌、CPA 管理 Key 和 OAuth 凭据只能由 AI OPS 服务端适配器使用。
- 员工可以在 AI OPS 中作为人员记录存在，但不是 AI OPS 用户。
- 一个人员可以有多个 Key；一个模型可以有多个 Key。
- 一个 Key 必须且只能绑定一个人员和一个模型。
- 人员停用时，必须调用 New API 停用该人员关联的全部 Token；不能只修改 AI OPS 本地状态。
- 模型选项来自 CPA 的真实 Codex 模型目录，不能使用本地写死别名。
- CPA 客户端 API Key 只用于 New API 创建/配置渠道；不能把渠道 Key 与员工接入 Key 混写。
- 员工 Key 固定采用 New API Token/API Key，由 New API 创建和失效；AI OPS 不在本地生成或校验第二套可调用 Key。
- Key 默认无限额度、永不过期，对应字段按当前 New API 版本设置（目标为 `unlimited_quota=true`）；Codex 账号真实额度从 CPA 读取，不能与 Key 无限额度混为一谈。
- 不使用分组；New API 内部若有默认分组，由其自身配置处理，AI OPS 不暴露或维护分组字段。
- 完整 Key 只在创建/重新生成成功后向超级管理员显示一次，其他位置只显示掩码或外部凭据 ID。
- New API/CPA 不可达或写入失败时，AI OPS 不得把本地操作标记为成功。
- 如果保留请求入口，该入口只能做透明转发、正文采集和 request_id 关联，不得另建 Key、模型权限或额度规则；请求鉴权仍以 New API Token 为准。
- 人员导入必须在既定人员事实源创建/更新对应用户；当前仍按 New API 用户同步，创建所需的初始密码不得展示或进入 AI OPS 日志。
- `last_used_at` 必须从关联 Key 的真实请求日志计算，不能用登录时间或演示时间代替。
- 对话审计必须保存真实 Prompt、上下文、工具调用和回复正文，并能通过内部 Key ID、可用的 Token/凭据 ID 与 request ID 关联。
- 正文必须加密保存，最多保留 30 天（本版默认 30 天），查看、复制和导出行为必须审计，过期正文必须能够删除并留下删除证明。

## 明确排除的旧能力

- AI OPS 自己生成、存储或验证的本地 Key。
- New API/CPA 独立管理页面作为日常操作入口；相关管理动作必须收敛到 AI OPS 服务端适配器。
- 本地公司、部门、人员、用途或 Key 额度扣减。
- 软额度、临时额度、并发预留、额度审批和周期重置。
- 分组管理、用途路由、模型别名、备用路由和供应商切换。
- 多角色 RBAC、员工自助、员工后台登录和通知渠道。
- 官方 API、Ollama、非 Codex Provider。
- 本地演示人员、演示 Key、模拟额度、模拟调用和合成对话正文。
- 具有独立业务权限的本地网关；正文采集代理只能作为 New API/CPA 的受控透明入口存在。

## New API Token 最小字段

创建或更新时至少处理：

- `name`：包含人员可识别信息，但不包含完整 Key 或 OAuth 内容；
- `model_limits_enabled`：固定为真；
- `model_limits`：只能有一个 CPA 真实模型 ID；
- `unlimited_quota`：固定为真；
- `expired_time`：使用当前 New API 版本的永不过期表示；
- 启用/停用状态：以 New API 返回为准。

不向管理员暴露 `group`、跨分组重试或本地模型别名字段。CPA 客户端 API Key 不属于本字段集合，只能作为 New API 渠道的内部上游凭据。

## 数据来源边界

- CPA auth file 是 Codex 上游认证凭据。
- CPA 客户端 API Key 是 New API 渠道凭据，不默认作为员工 API Key。
- New API 用户 Token 是员工最终接入对象，由 AI OPS 调用 New API 创建并分发。
- CPA 账号额度是上游账号池状态，可能被多个 Key 共享。
- 当前部署可通过 CPA 管理 `api-call` 代理读取 Codex usage 和 reset credits；如果当前版本/上游接口不能返回额度，页面必须显示未知/不可读，不从 OAuth 文件内容推算。

## 运行链路

```text
超级管理员 -- 管理会话 --> AI OPS
AI OPS -- 人员/凭据绑定 --> New API -- CPA 客户端 API Key 配置渠道 --> CPA -- Codex OAuth --> Codex
AI OPS -- 读取模型/账号/额度 --> CPA
```

## 统一管理接口边界

AI OPS 服务端至少需要为前端提供以下统一能力；前端不直接暴露或转发上游管理接口：

- `dependency/health`：AI OPS、New API、CPA 和 Docker 依赖的健康、版本、延迟和状态原因；
- `dependency/sync`：幂等校验/创建 CPA 渠道、刷新模型目录、刷新账号与额度摘要；
- `people`：导入、查询、更新和停用 New API 用户；
- `keys`：创建、查询、停用、删除、重新生成 New API Token，并返回掩码和一次性明文；
- `audit`：按内部 Key ID 与 New API `token_id` 查询真实日志和正文审计；
- `cpa/auth`、`cpa/models`、`cpa/usage`：在服务端代理 CPA OAuth 状态、模型目录和真实额度查询。

每个写操作都必须携带幂等键、记录上游响应摘要和同步时间；超时或部分成功时返回可恢复状态，不得让前端自行重试造成重复 Key 或重复渠道。

## 人员最小字段

| 字段 | 规则 |
| --- | --- |
| `id` | 使用 New API 用户 ID |
| `username` | 导入的用户名/姓名 |
| `status` | 与 New API 用户状态同步 |
| `created_at` | New API 用户创建时间 |
| `last_used_at` | 关联最终接入 Key 最新真实请求时间 |
| `management` | 编辑、查看 Key、查看审计、停用等页面操作列 |

## 对话审计最小范围

- 第一筛选维度是内部 Key ID；能够取得时展示 Token ID 或 CPA 凭据/渠道 ID。
- 可从 Key 反查人员和模型。
- 至少展示请求时间、模型、状态、请求 ID、耗时和 Token 用量等元数据。
- 必须展示真实 Prompt、上下文、工具调用和回复正文，包括流式响应拼接结果。
- 正文与元数据分离加密保存；普通日志不得写入正文、Authorization Header、完整 Key 或 OAuth 内容。
- 只有超级管理员可查看、复制和导出正文，查看/复制/导出原因、目标 Key 和 request ID 必须进入管理审计；导出不得包含凭据或认证 Header。
- 正文最多保留 30 天，本版默认保存 30 天，到期自动删除并留下删除证明。
- New API 普通日志接口不提供正文时，必须增加请求链路采集层，不能回退到合成数据。
