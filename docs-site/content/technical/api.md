# 统一 API 契约

## 1. 公共入口

AI OPS 对外提供一个稳定 Base URL、一把员工 Key 和唯一模型 ID：`ai-ops`。客户端永远调用 AI OPS 网关，不直接调用中转站。

~~~text
Authorization: Bearer <employee-key>
Base URL: https://<你的网关地址>/v1
Model: ai-ops
~~~

完整 Key 可由 Key 所有者在自己的已认证门户中显示、复制或导入；它不会出现在管理员接口、URL、浏览器持久化存储或普通日志。网关会验证 Key 与员工状态，并将请求内部路由到一个已启用的中转站；外部响应中的模型名会归一回 `ai-ops`。

## 2. 已交付端点

| 路径 | 方法 | 用途 | 模型规则 |
| --- | --- | --- | --- |
| `/v1/models` | GET | 读取公开模型目录 | 只返回 `ai-ops` |
| `/v1/chat/completions` | POST | OpenAI Chat Completions 兼容的对话与代码 | 必须为 `ai-ops` |
| `/v1/responses` | POST | Responses 风格文本与代码 | 必须为 `ai-ops` |
| `/v1/images/generations` | POST | JSON 图片生成 | 省略时默认 `ai-ops` |
| `/v1/videos` | POST | JSON 视频请求 | 省略时默认 `ai-ops` |
| `/v1/audio/speech` | POST | JSON 语音合成 | 省略时默认 `ai-ops` |

`/v1/models` 只提供兼容客户端所需的最小模型记录：

~~~json
{
  "object": "list",
  "data": [
    {
      "id": "ai-ops",
      "object": "model",
      "created": 0,
      "owned_by": "ai-ops-relay"
    }
  ]
}
~~~

管理员模型目录是另一套控制面数据：它列出中转站同步到的原始模型和来源标签，但不等于员工可选择的模型列表。

## 3. 选站与安全回退

对于上述每一条请求，网关会在健康快照过期时同时探测有上限的一组中转站的 `/models` 端点。首个成功探测者获胜，其他未完成探测会被取消。默认并发探测数为 3，可配置范围为 2 至 8。

探测完成后，网关只向一个获胜中转站提交真实请求。图片、视频和语音也遵守这个规则；不会用重复提交生成任务的方式比较速度。若真实调用在上游确认执行前发生连接失败、超时、429 或可识别的 5xx，网关可依次尝试其他候选。流式响应在已经发出可见内容后不会静默重跑。

完整逻辑见 [网关路由与低延迟](/technical/gateway)。

## 4. 文本与代码

Chat Completions 和 Responses 均支持 `ai-ops`。流式请求保持 SSE 透传：网关收到第一个上游片段后立即转给客户端，而不会先缓冲完整回答。上游的原始模型名会被改写为 `ai-ops`。

Codex Provider 配置使用 Responses 协议，并声明：

~~~toml
model = "ai-ops"
model_provider = "ai-ops"

[model_providers.ai-ops]
base_url = "https://<你的网关地址>/v1"
env_key = "AI_OPS_TOKEN"
requires_openai_auth = false
wire_api = "responses"
~~~

因此调用 AI OPS 模型不依赖用户是否登录 Codex / ChatGPT 账号。

## 5. 图片、视频与语音

三个媒体端点当前接收并转发 JSON。它们保留所选中转站返回的同步结果或异步任务响应结构，但会把其中的 `model` 字段归一为 `ai-ops`（若该字段存在）。

这意味着：

- 网关可以统一鉴权、选站、限流、审计和隐藏上游凭据。
- 上游视频服务若返回自己的任务 ID，客户端应按该服务已兼容的响应语义处理；平台尚未创建独立的 AI OPS job ID 或轮询端点。
- 图片编辑 multipart、`/v1/audio/transcriptions`、文件上传、`/v1/jobs/*`、资产下载和统一回调不在当前公开 API 中。

后续媒体任务服务必须新增明确的幂等键、平台 job ID、状态查询与取消端点；在实现前，不应假称这些端点存在。

## 6. 错误与排障

网关错误使用安全的统一错误体，包含可供排查的请求标识。客户端不应把中转站返回的凭据、原始 URL 或内部模型名显示给最终用户。

客户端可以对短暂容量/网络问题做带退避的有限重试；对图片、视频和其他可能计费的请求，后续支持幂等键前尤其要避免自行并发重发。网关已经在安全条件下进行一次内部候选回退，因此客户端不应高频盲目重试。

## 7. 兼容范围

“OpenAI 兼容”只表示已列端点和字段以兼容方式转发，不表示复制所有第三方专有功能。任何不能在多个中转站之间安全统一的能力，都应明确标记为未支持或作为后续平台扩展，而不是伪造成功响应。
