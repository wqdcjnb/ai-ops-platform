# 客户端兼容性

::: warning 待验证
当前没有员工客户端。以下仅作为未来外部客户端使用 New API 员工 Token/API Key 时的兼容性验证清单，不能当作已支持承诺；管理员日常不需要打开 New API/CPA 管理网站。
:::

| 能力 | Codex Desktop（未来外部客户端） | WorkBuddy（未来外部客户端） |
| --- | --- | --- |
| 自定义 Provider 与独立 Key | 待验证 | 待验证 |
| 普通对话、流式返回 | 待验证 | 待验证 |
| Responses / Chat Completions 路由 | CPA 连接器原生转发 `/v1/responses`；按客户端版本验证 | CPA 连接器原生转发 `/v1/responses`；按客户端版本验证 |
| Function Calling | 待验证 | 待验证 |
| MCP 与内置工具 | 按具体工具验证 | 按具体工具验证 |
| 长任务与取消 | 待验证 | 待验证 |
| 重启与记录恢复 | 待验证 | 待验证 |
| 多上游账号切换 | 待验证 | 待验证 |
| 图片、音频和 Embedding | 另配支持渠道后验证 | 另配支持渠道后验证 |

## 验证方法

记录客户端版本、New API 版本、CPA 版本、适配器版本、实际接口、模型与测试日期。客户端请求应直接使用 New API 员工 Token/API Key；AI OPS 只负责管理和审计，不在请求链路中复制第二套鉴权。先普通问答，再测试带参数的工具调用及结果回传，最后测试长任务、取消、故障和重启。

不要仅修改 URL 路径来假设完成协议转换。会话粘性是调度策略，不等于对话历史保存，也不保证账号失效后可无损恢复。两个客户端的历史记录不会因共用网关而自动同步。

## 参考

- [WorkBuddy 模型配置](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)
- [CPA 官方配置示例](https://github.com/router-for-me/CLIProxyAPI/blob/main/config.example.yaml)
- [CPA Codex OAuth 说明](../guides/cpa.md)
- [New API 项目](https://github.com/QuantumNous/new-api)
