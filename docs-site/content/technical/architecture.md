# 总体架构

## 1. 分层原则

AI OPS 采用控制面与数据面分离的架构。控制面可以较慢但必须可靠、可审计；数据面必须位于请求热路径上，并以低延迟、隔离故障和稳定流式输出为优先目标。

下图是最终可横向扩展的部署边界。当前版本已交付 SQLite 控制面、统一 Key、第三方账号目录、`ai-ops`、并发健康探测和 JSON 多模态转发；PostgreSQL、Redis、对象存储、独立媒体作业服务及跨设备会话同步属于后续横向扩展，不应被误认为当前已经启用。

~~~mermaid
flowchart TB
  subgraph Control[控制面]
    A[超级管理员控制台]
    I[身份与员工服务]
    P[中转站与凭据管理]
    C[AI OPS目录]
    R[路由策略与预算]
    O[监控、告警、审计]
  end
  subgraph Data[数据面]
    G[边缘 API 网关]
    AU[Key 鉴权与配额]
    RT[实时路由器]
    AD[供应商适配器]
    J[媒体作业服务]
  end
  subgraph State[状态与数据]
    DB[(PostgreSQL)]
    RE[(Redis)]
    OS[(对象存储和 CDN)]
  end
  E[员工客户端 / API] --> G
  G --> AU --> RT --> AD
  G --> J
  A --> I
  A --> P
  A --> C
  A --> R
  P --> C
  C --> DB
  R --> RE
  AU --> RE
  RT --> RE
  J --> OS
  I --> DB
  O --> DB
  AD --> U[已授权中转站]
~~~

## 2. 组件职责

| 组件 | 职责 | 不承担的职责 |
| --- | --- | --- |
| 员工门户 | 注册、登录、Key 状态、客户端接入、媒体工作台、个人用量 | 保存上游凭据、决定上游路由 |
| 管理控制台 | 中转站、模型、策略、员工、预算、监控与审计 | 在浏览器直连上游或保存完整 Key |
| 身份服务 | 员工身份、角色、会话、设备授权、密码安全 | 中转站转发 |
| 目录服务 | 同步和归一化上游模型、生成AI OPS能力与路由表 | 在请求热路径上即时扫描所有站点 |
| API 网关 | 员工 Key 鉴权、协议入口、流式回传、统一错误 | 保存上游明文凭据 |
| 路由器 | 为模型和模态选择健康站点，重试、回退、熔断 | 对不兼容模型做无提示替换 |
| 供应商适配器 | 将统一请求变成具体中转站协议，归一化响应 | 对员工暴露上游 URL |
| 媒体作业服务 | 图片、视频、音频的异步提交、状态、取消、回调和资产交付 | 阻塞文本网关等待长任务 |
| 连接器服务 | 设备授权、配置模板、版本兼容矩阵与状态回传 | 在网页中直接修改本机文件 |

## 3. 两条关键请求路径

### 3.1 文本与代码热路径

1. 客户端携带员工统一 Key 请求网关。
2. 网关在本地缓存中校验 Key 状态、员工状态、速率和预算。
3. 健康快照过期时，路由器并发探测一个有上限的候选样本；最先成功的 `/models` 响应获胜，其余探测立即取消。快照有效时直接按延迟和失败次数选择。
4. 适配器只向获胜站点建立上游连接并发送一次真实请求。
5. 首个流式片段一到达，网关立即转发给客户端。
6. 系统异步记录计量、路由、延迟和结果元数据，不阻塞响应。

### 3.2 媒体任务路径

1. 员工使用同一 Key 调用 `/v1/images/generations`、`/v1/videos` 或 `/v1/audio/speech`；未填模型时网关补为 `ai-ops`。
2. 网关用与文本相同的并发健康竞速选择一个中转站，再只提交一次 JSON 请求。
3. 网关保持中转站的同步结果或异步任务响应语义，并将响应中的模型名归一为 `ai-ops`。
4. 平台记录请求元数据；对话客户端的本地历史不会因站点选择、失败回退或 Key 轮换被清除。

图片编辑 multipart 上传、音频转写、大文件资产托管、平台统一 job ID、回调和对象存储交付，属于下一阶段的媒体作业服务。它们必须以幂等任务模型实现，不能通过重复转发真实生成请求来“加速”。

## 4. 目标规模的数据模型

| 实体 | 关键字段 | 用途 |
| --- | --- | --- |
| User | id、role、real_name、email、status | 超级管理员与员工身份 |
| ApiKey | id、user_id、prefix、hash、status、last_used_at | 员工唯一有效 Key |
| DeviceEnrollment | user_id、client_type、one_time_code、expires_at、status | 一键客户端接入 |
| Provider | 名称、区域、地址、认证引用、status | 中转站连接 |
| ProviderModel | provider_id、native_model_id、capabilities、protocol | 上游实际模型 |
| UnifiedModel | id=ai-ops、display_name=AI OPS、capabilities、visibility | 唯一员工可见的自定义模型 |
| UnifiedRoute | capability、provider_model_id、priority、policy | AI OPS能力到站点的内部映射 |
| HealthSample | route_id、ttft、latency、success、rate_limit、inflight | 路由评分输入 |
| UsageRecord | user_id、key_id、model、modality、usage、cost | 用量与成本归集 |
| Conversation | conversation_id、employee_id、状态、标题、客户端绑定 | 员工对话的权威记录 |
| ConversationTurn | turn_id、conversation_id、request_id、消息、检查点、状态 | 可恢复的输入、输出和工具事件 |
| MediaJob | job_id、model、status、route、input_asset、output_asset | 长时多模态任务 |
| AuditEvent | actor、action、target、result、metadata | 管理与安全审计 |

密码摘要、完整 Key、上游凭据、设备令牌和媒体原始内容不应出现在普通查询视图或普通日志字段中。当前 Key 表保存哈希与用于同一幂等签发的加密材料，管理列表和管理员 API 不会返回完整 Key。完整跨设备会话存储是目标扩展，不能把当前审计记录误称为它。

## 5. 状态存储与缓存

- PostgreSQL 保存身份、目录版本、路由配置、作业事实、计量、预算和审计。
- Redis 保存 Key 状态镜像、限流计数、活跃并发、熔断状态、短时路由健康快照和会话。
- 对象存储保存上传输入、图片、视频、音频和缩略图；CDN 只服务短时授权后的内容。
- 目录同步结果发布为带版本号的不可变快照。网关热路径只读最近完整快照，绝不等待同步任务完成。

## 6. 部署与故障边界

控制面与数据面可横向独立扩展。文本网关应部署在靠近员工和主要中转站网络的位置；媒体工作进程可独立伸缩，不影响文本首 Token。

故障隔离要求：

- 某一中转站失效只影响关联路由，不能让整个网关阻塞。
- 视频队列积压不能吞掉文本、图片或登录服务的工作进程。
- Redis 不可用时不能放行已撤销 Key；应按安全策略降级为只允许可验证的短时本地缓存或拒绝新请求。
- 对象存储异常不能阻碍文本请求；仅让媒体作业停在可重试状态。
- 控制台或目录同步故障不能改变已发布路由快照。

## 7. 实施边界

已下线的历史控制面不属于本产品的数据面。管理控制台和公开网关只暴露本方案中的人员、第三方账号、模型目录与统一网关入口；历史记录不能参与目录、鉴权或路由。
