# 分步实施手册

这组文档把 AI OPS 的改造拆成可以单独执行、单独验收的步骤。每次只执行一份手册，确认本步骤的验收条件全部通过后，再进入下一份。

## 固定目标

最终系统只有一个操作入口：AI OPS 管理平台，使用者是超级管理员。

CPA 和 New API 作为随项目一起启动的内部服务：

- CPA 保存 Codex OAuth 认证账号、模型和真实额度信息。
- New API 保存渠道、人员、Token/API Key、模型限制、额度和有效期。
- AI OPS 负责统一编排，不要求管理员打开 CPA 或 New API 的管理网站。
- 员工不登录 AI OPS，也没有单独的员工客户端。
- 发给员工的是 New API 创建的 Token/API Key，不是 CPA 的管理密钥或 CPA 渠道密钥。

## 执行顺序

| 编号 | 独立手册 | 目标 |
| --- | --- | --- |
| 00 | [执行前检查与备份](./00-preflight) | 记录当前状态，确认容器、数据目录和测试基线 |
| 01 | [CPA 服务端真实接入](./01-cpa-connection) | 让 AI OPS 通过服务端适配器读取和操作 CPA |
| 02 | [CPA Codex OAuth 登录](./02-cpa-oauth) | 在 AI OPS 中发起 OAuth，并把认证结果落回 CPA |
| 03 | [New API 渠道同步](./03-new-api-channel) | 用 CPA 的真实渠道凭据创建或更新 New API 渠道 |
| 04 | [人员同步](./04-people-sync) | 把 New API 用户映射为 AI OPS 的人员数据 |
| 05 | [New API 员工 Key](./05-new-api-key) | 创建一对一绑定人员和模型的 New API Token |
| 06 | [停用与生命周期联动](./06-lifecycle) | 人员停用时联动停用全部关联 Key |
| 07 | [真实 Prompt/回复审计](./07-audit) | 在请求边界保存真实正文，并按 Key 查询 |
| 08 | [清理与发布](./08-cleanup-release) | 删除或下线旧的演示链路，完成冷启动验收 |
| 09 | [日常操作手册](./09-daily-runbook) | 给超级管理员一份可重复执行的工作流程 |

## 全局规则

1. 所有写操作都从 AI OPS 服务端发起。浏览器只调用 AI OPS 的 /api/*，不得让浏览器携带 CPA 管理密钥、CPA 客户端 Key 或 New API 管理 Token。
2. OAuth 过程中可以短暂打开官方 Codex 授权页面，这是认证协议的必要跳转；CPA 和 New API 的管理网站不属于日常操作入口。
3. CPA 管理密钥、CPA 客户端 Key、New API 管理 Token、员工 New API Token 是四种不同凭据，不能混用，也不能展示给员工。
4. 不确定的 CPA 额度显示为“未知”，禁止用假数字、缓存旧数字或本地演示数冒充真实额度。
5. 一个 Key 必须且只能绑定一个人员和一个模型；一个人员可以有多个 Key，一个模型也可以有多个 Key。
6. 默认策略为无限额度、永不过期；仍然要把字段显式写入 New API，不能只依赖界面默认值。
7. 每个写入动作必须具备幂等键或稳定外部 ID，重复执行不能产生重复渠道、重复人员或重复 Key。
8. 第一次只使用一个测试人员、一个测试模型、一个测试 Key。通过后再批量操作。
9. 在第 08 步之前，不删除生产数据、旧表、旧路由或旧容器；先禁用或加开关，确认新链路可回退。
10. Token 只由管理员在本地环境文件或 Docker Secret 配置，不提交 Git，不写入文档和数据库日志。

## 每一步的固定执行模板

每份手册都按下面的顺序执行：

1. 阅读“前置条件”，确认上一阶段验收通过。
2. 先执行只读检查命令，保存命令输出。
3. 按“改造内容”修改代码或配置。
4. 启动受影响的服务，执行“验证命令”。
5. 在 AI OPS 界面完成本阶段的最小真实操作。
6. 对照“验收标准”逐条打勾。
7. 记录失败现象、请求 ID、容器日志和回滚结果。
8. 只有验收全部通过，才进入下一份手册。

建议每一步保存一个记录文件，例如：

```text
docs-site/content/implementation/runs/2026-09-20-step-01.md
```

记录中不要写入任何 Token、OAuth code、Prompt 正文或回复正文；正文审计测试只记录脱敏的 request_id 和结果。

## 通用环境检查

以下命令可以在每一步开始前执行：

```powershell
docker compose config --services
docker compose ps
Invoke-RestMethod http://127.0.0.1:4175/health
Invoke-RestMethod http://127.0.0.1:4175/api/platform/status
```

如果项目端口或环境文件不同，以项目根目录的 docker-compose.yml、.env 和本地运行说明为准。不要把真实密钥直接写进命令行历史。

## 完成标志

全部手册完成后，管理员应该能够只在 AI OPS 中完成以下流程：

1. 查看 CPA 是否已登录、有哪些模型和真实额度。
2. 从 AI OPS 发起 Codex OAuth，必要时完成一次官方授权。
3. 把 CPA 渠道同步到 New API。
4. 导入或选择 New API 中的人员。
5. 为某个人创建一个只允许单一模型的 New API Key。
6. 复制一次性 Key 给员工。
7. 按 Key 查看真实 Prompt 和回复正文，默认保留最多 30 天。
8. 停用人员，并确认其全部 Key 立即失效。

任何一步仍需要管理员手动登录 CPA 或 New API 管理网站，都说明对应步骤没有完成。
