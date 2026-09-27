# 会话连续性与记录

## 1. 当前交付与最终要求

当前交付已保证：导入 Codex / WorkBuddy Provider 配置不会删除、重置或迁移本机对话文件；中转站切换、Key 轮换和网关重启不会主动清除客户端的本地历史。当前服务端还保存调用与对话审计，供受控排障使用。

跨设备、跨客户端的完整会话恢复尚未作为当前版本已交付能力。下面定义的是必须单独验收的最终连续性方案；在完成稳定会话 ID、完整 Turn 持久化、流式检查点和客户端同步协议前，不能把审计记录称为聊天备份。

员工通过 Codex、WorkBuddy、媒体工作台或标准 API 使用AI OPS时，对话记录不能因为切换中转站、轮换 Key、更新连接器、重启网关、客户端离线或员工更换电脑而丢失。

平台不能只依赖客户端本地历史文件。AI OPS 必须成为会话记录的权威持久化层；客户端历史是本地体验缓存，而不是唯一副本。

## 2. 两层连续性

| 层级 | 要保证什么 | 实现方式 |
| --- | --- | --- |
| 记录不丢失 | 每条用户输入、助手输出、工具调用、附件引用和失败状态可恢复 | 平台级加密会话存储、幂等事件、备份和恢复 |
| 对话可续接 | 员工在同一或受支持的另一客户端中继续同一上下文 | 稳定 conversation_id、客户端线程映射、历史加载和上下文重建 |

“保存记录”和“在任意第三方客户端原样显示历史 UI”不是同一件事。对于已认证支持的 Codex 和 WorkBuddy 版本，连接器必须实现线程映射和续接验证；若某个客户端版本不支持历史导入、线程标识或必要接口，它可以保留平台记录，但不能被标记为满足“原生无丢失续接”的受支持版本。

## 3. 会话数据模型

~~~text
Conversation
  ├─ conversation_id
  ├─ employee_id
  ├─ title / status / created_at / updated_at
  ├─ client bindings
  └─ ordered turns

Turn
  ├─ turn_id / request_id / idempotency_key
  ├─ user message
  ├─ assistant stream checkpoints
  ├─ tool calls and tool results
  ├─ input and output asset references
  ├─ terminal state
  └─ ai-ops routing summary

ClientBinding
  ├─ device_id
  ├─ client_type and version
  ├─ client_thread_id when available
  └─ last_sync_cursor
~~~

会话和 Turn 采用追加式事件记录。编辑或删除以新事件表达，不直接破坏既有审计顺序；员工删除会话时执行受控软删除和最终清除流程。

## 4. 写入时序：先保留输入，再发送请求

~~~mermaid
sequenceDiagram
  participant C as 客户端
  participant G as AI OPS 网关
  participant S as 会话存储
  participant U as 中转站
  C->>G: 输入、conversation_id、幂等键
  G->>S: 持久写入用户 Turn
  S-->>G: 已确认
  G->>U: 调用AI OPS路由
  U-->>G: 流式片段
  G-->>C: 立即转发片段
  G->>S: 追加片段检查点
  G->>S: 写入最终状态与元数据
~~~

用户输入在向上游发送前必须完成耐久写入，避免系统崩溃导致“用户已经发送但平台没有记录”。助手流式输出可按小批次异步写入，以避免延迟首 Token；但必须设置短检查点间隔，并在完成、取消、断开或异常时立即冲刷未落盘片段。

如果连接在流式过程中断：

- 已收到的用户输入和助手片段仍保存在 Turn 中。
- Turn 状态显示 interrupted，而不是伪装为成功或删除。
- 员工可从门户或支持恢复的客户端查看并重新开始后续追问。
- 网关不得为了补齐记录而无提示地重新向上游发送同一请求。

## 5. AI OPS的路由与上下文

员工所有请求都使用AI OPS。AI OPS可在内部为文本、代码、图片、视频和音频选择不同中转站的原始模型，但会话上下文必须保持平台自己的规范格式。

路由切换时：

- 规范化后的上下文由平台保存，不依赖某个中转站的私有会话 ID。
- 下一条请求根据目标原始模型的上下文窗口、工具能力和模态限制，由会话服务裁剪或摘要。
- 任何摘要、裁剪或附件省略必须在 Turn 元数据中可追溯，并让员工知道上下文可能被压缩。
- 对于必须保真、不能摘要的对话，平台应在接近窗口限制时明确拒绝继续或要求员工创建新会话，不能静默丢弃消息。

## 6. Codex 与 WorkBuddy 的连接器要求

连接器配置和升级时必须保护现有客户端记录：

1. 读取并备份目标客户端的配置，不删除或重建其历史目录。
2. 不覆盖 Codex 的本地历史文件，也不清空 WorkBuddy 的本地线程缓存。
3. 为每个受支持客户端线程建立 client_thread_id 到 conversation_id 的映射。
4. 请求中优先传递稳定的 conversation_id 或客户端支持的等价线程信息。
5. 在客户端没有可用线程标识时，由连接器或网关建立新的平台会话绑定，并保留完整请求序列。
6. 连接器重装、Key 轮换和设备更换后，可以从平台恢复会话目录和继续使用的上下文。

Codex 官方文档说明其本地状态可包含 history.jsonl，且 app-server 面向丰富客户端集成提供会话历史能力；这些能力可用于本地连接器的安全同步与恢复，但平台的权威记录仍需独立保存。[OpenAI Docs：高级配置](https://learn.chatgpt.com/docs/config-file/config-advanced) [OpenAI Docs：Codex App Server](https://learn.chatgpt.com/docs/app-server)

## 7. Codex 无 OpenAI 账号接入

AI OPS的 Codex 接入不能依赖员工登录 OpenAI/ChatGPT 账号。连接器应为 aiops 自定义 Provider 配置网关地址和命令式短时令牌，并将默认模型固定为 ai-ops。

官方文档表明：自定义 Provider 的 OpenAI 身份验证默认是关闭的；在活动 Provider 不要求 OpenAI 身份验证时，Codex 可以在没有 OpenAI 凭据的情况下运行。连接器验收必须实际验证这种无账号模式，而不是只验证已登录 ChatGPT 的机器。[OpenAI Docs：认证](https://learn.chatgpt.com/zh-Hans/docs/auth) [OpenAI Docs：Codex App Server](https://learn.chatgpt.com/docs/app-server)

必须区分两个场景：

| 场景 | 最终要求 |
| --- | --- |
| 员工已登录 OpenAI/ChatGPT | aiops Provider 仍只调用 AI OPS，不使用该账号作为模型调用凭据 |
| 员工未登录 OpenAI/ChatGPT | 受支持的 Codex CLI、IDE 或 app-server 模式使用 aiops Provider 和设备令牌完成调用 |

如果某个特定 Codex 桌面版本在启动前强制要求登录自身产品账号，则该版本不能仅凭 Provider 配置满足“无账号接入”。它必须在连接器兼容矩阵中标为不支持无账号模式，并提供已验证的 CLI、IDE 或本地 app-server 路径；不得对员工虚假宣称该桌面版本已经支持。

## 8. 恢复、备份与保留

会话记录按 employee_id 进行逻辑隔离，并至少具备：

- 主数据库高可用或可靠备份。
- 定期加密备份和可验证恢复演练。
- 资产与会话引用的一致性检查。
- 基于 cursor 的增量同步，避免重装连接器时重复导入。
- 明确的员工删除、管理员合规删除和保留期策略。

默认策略应是在员工账户有效期间保留会话，以满足“不丢失”。缩短、清除或导出内容属于明确的组织数据策略，必须告知员工、记录审计并支持恢复窗口；不能由缓存淘汰、日志轮转或中转站失效悄悄删除。

## 9. 验收场景

1. 员工在 Codex 发起流式对话，断网后重新连接，平台仍显示已持久化输入和已输出部分。
2. 路由从一个中转站切到另一个中转站后，下一轮对话仍携带正确、可追溯的上下文。
3. 员工轮换 Key、更新连接器或更换设备后，可在门户找到并恢复该会话。
4. Codex 本地未登录 OpenAI 账号时，仍能通过 aiops Provider 调用AI OPS。
5. 配置 Codex 或 WorkBuddy 时，原有本地历史文件和非 AI OPS 对话不被删除。
6. 不支持线程恢复的客户端版本不会被标记为会话连续性已认证。
