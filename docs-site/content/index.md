# AI 运营平台文档中心

<div class="hero-label">TEAM AI / 从需求到落地</div>
<p class="hero-lead">让每位运营人员获得合适的 AI 能力，让每一次调用都有归属、额度和成本记录。</p>

::: tip 当前阶段 · 文档整理与接入验证
已确定候选架构：Codex Desktop / WorkBuddy → New API → CPA → 上游服务。本文档站已实现知识整理；业务链路及各项能力需按验收标准逐项验证。
:::

<div class="cards">
<div class="card"><small>01 / REQUIREMENTS</small><strong><a href="/requirements/core">明确要做什么 →</a></strong><p>八个核心模块、一期范围与验收条件。</p></div>
<div class="card"><small>02 / ARCHITECTURE</small><strong><a href="/technical/architecture">理解系统如何协作 →</a></strong><p>客户端、管理网关与账号适配层的职责。</p></div>
<div class="card"><small>03 / WORKSPACE</small><strong><a href="/portal">打开本机后台 →</a></strong><p>经过检查的服务入口与最近可用状态。</p></div>
<div class="card"><small>04 / DELIVERY</small><strong><a href="/technical/development-steps">按步骤开始开发 →</a></strong><p>里程碑、任务顺序、交付物与阶段门禁。</p></div>
</div>

## 项目目标

- 每名员工独立身份与 API Key，按业务用途分配模型。
- 控制人员和团队预算，观察请求量、Token 和费用。
- 保留各客户端任务使用体验，验证升级、重启和切换后的连续性。
- 上游凭据集中管理，员工仅持有可撤销的内部令牌。

## 状态约定

| 状态 | 含义 |
| --- | --- |
| 已验证 | 有本机检查或验收记录，只覆盖记录所述范围 |
| 项目声明 | 来自上游项目说明，尚未在当前部署验证 |
| 计划开发 | 已提出的需求，未完成实现 |
| 待验证 | 需要实际请求、权限或故障测试确认 |
| 待配置 | 尚未确认部署地址或接入参数 |

## 当前需要确定

试点人数、部门名单、各人员预算、按 Token 还是金额分配、上游服务来源，以及告警接收方式。参见[项目待办](/records/todo)。

## 阅读顺序

[核心功能](/requirements/core) → [实施范围](/requirements/phases) → [架构与职责](/technical/architecture) → [开发实施步骤](/technical/development-steps) → [验收标准](/requirements/acceptance)。

每页顶部可以下载对应 Markdown 原文。后续文档在此维护，历史交付文件仍保留。
