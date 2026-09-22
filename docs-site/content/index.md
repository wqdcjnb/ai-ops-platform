# AI 运营平台文档中心

<div class="hero-label">TEAM AI / 从需求到落地</div>
<p class="hero-lead">让每位运营人员获得合适的 AI 能力，让每一次调用都有归属、额度和成本记录。</p>

::: tip 当前阶段 · 文档整理与接入验证
当前主链路：超级管理员 → AI OPS → New API Token/渠道 → CPA → Codex。CPA 和 New API 随 Docker Compose 一起启动，AI OPS 是唯一管理入口；业务链路及各项能力需按验收标准逐项验证。
:::

<div class="cards">
<div class="card"><small>01 / REQUIREMENTS</small><strong><a href="/requirements/core">明确要做什么 →</a></strong><p>八个核心模块、一期范围与验收条件。</p></div>
<div class="card"><small>02 / ARCHITECTURE</small><strong><a href="/technical/architecture">理解系统如何协作 →</a></strong><p>客户端、管理网关与账号适配层的职责。</p></div>
<div class="card"><small>03 / WORKSPACE</small><strong><a href="/portal">打开本机后台 →</a></strong><p>经过检查的服务入口与最近可用状态。</p></div>
<div class="card"><small>04 / DELIVERY</small><strong><a href="/requirements/phases">按阶段开始开发 →</a></strong><p>里程碑、任务顺序、交付物与阶段门禁。</p></div>
</div>

## 项目目标

- 只为超级管理员提供人员、模型、Key 和审计管理。
- 一个 Key 只绑定一个人员和一个模型；不使用分组。
- CPA OAuth、渠道 Key、New API 对象和员工最终接入 Key 分层管理。
- 按 Key 查看真实请求、Prompt 和回复正文，正文最多保留 30 天。
- 不要求管理员打开或登录 New API/CPA 管理网站；所有管理读写、健康检查和同步都在 AI OPS 内完成。

## 状态约定

| 状态 | 含义 |
| --- | --- |
| 已验证 | 有本机检查或验收记录，只覆盖记录所述范围 |
| 项目声明 | 来自上游项目说明，尚未在当前部署验证 |
| 计划开发 | 已提出的需求，未完成实现 |
| 待验证 | 需要实际请求、权限或故障测试确认 |
| 待配置 | 尚未确认部署地址或接入参数 |

## 当前需要确定

New API 当前部署版本的 Token 永不过期字段、停用接口差异，以及真实正文采集的具体改造点。参见[项目待办](/records/todo)。

## 阅读顺序

[核心功能](/requirements/core) → [实施范围](/requirements/phases) → [架构与职责](/technical/architecture) → [验收标准](/requirements/acceptance)。

每页顶部可以下载对应 Markdown 原文。后续文档在此维护，历史交付文件仍保留。
