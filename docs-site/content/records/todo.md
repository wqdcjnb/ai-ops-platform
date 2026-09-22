# 项目待办

## 已完成的文档收口

- [x] 固定 AI OPS 为唯一管理入口和单一超级管理员模式。
- [x] 固定 CPA/New API 随 Docker Compose 启动，管理员不需要进入上游管理网站。
- [x] 区分 CPA OAuth、CPA 客户端 API Key、New API 渠道和 New API 员工 Token。
- [x] 固定一 Key 一人员一模型、无分组、无限额度、永不过期和停用联动。
- [x] 固定按 Key 查看真实 Prompt/回复正文，最多保留 30 天并支持超级管理员复制/导出审计。
- [x] 删除与当前范围无关的客户端、独立网关和旧页面文档。

## 近期开发顺序

> 2026-09-21 已收口第 03 步：New API 渠道适配器、CPA 实时模型快照、预览/确认同步、marker 映射、最终校验、幂等重放和 Models 页面入口已落地。待办中的人员同步、员工 Token 和真实请求审计继续按后续步骤推进。

- [ ] 固定并封装 New API 当前版本的用户、Token、渠道、日志接口合约。
- [ ] 固定 New API Token 的永不过期、无限额度、单模型限制和停用字段。
- [ ] 实现 AI OPS 服务端 New API/CPA 适配器：健康、版本、认证、错误映射和幂等写入。
- [ ] 在 AI OPS 内完成 CPA OAuth 状态、账号、模型和真实额度读取。
- [ ] 通过 AI OPS 自动校验/创建 New API 的 CPA 渠道，不依赖 New API 管理页面。
- [ ] 将人员导入同步到 New API 用户，完成 `id`、`username`、`status`、`created_at`、`last_used_at` 和管理列。
- [ ] 将本地演示 Key 迁移/隔离，改为 New API Token 创建、一次性显示、停用、删除和重新生成。
- [ ] 实现人员停用到全部 New API Token 的可靠联动和部分失败重试。
- [ ] 在 New API 请求处理边界采集真实 Prompt、上下文、工具调用、流式回复和失败状态。
- [ ] 建立加密正文存储、30 天清理、删除证明以及超级管理员查看/复制/导出审计。
- [ ] 按内部 `key_id`、New API `token_id`、CPA 渠道 ID 和 `request_id` 对齐日志与审计。
- [ ] 完成 Compose 冷启动、依赖停止/恢复、配置漂移和升级回滚验收。

## 发布前门禁

- [ ] 浏览器不存在 New API/CPA 管理链接、iframe 或直连请求。
- [ ] 上游管理凭据、OAuth、完整 Key 和正文不出现在浏览器普通响应、日志或 Git。
- [ ] New API/CPA 不可达时显示真实故障状态，不显示演示成功。
- [ ] 所有写操作具备幂等键，重复提交不生成重复 Token 或渠道。
- [ ] 真实 Prompt/回复可以按 Key 查看，且正文不超过 30 天。
- [ ] 通过 `npm.cmd run build` 和 `npm.cmd run check`，并完成关键业务端到端验收。
