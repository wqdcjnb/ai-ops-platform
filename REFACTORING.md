# 代码重构记录（2026-10-09）

目标：**不改变任何对外行为**，只做结构拆分与死代码清理。

## 原则与做法

- **搬运而非重写**：所有拆分按原文件行区间精确搬运，不改逻辑、不改命名、不改错误文案。
- **覆盖率校验**：拆分后用脚本比对「原文件每一行」是否都出现在新文件集合中，结果为 **0 行丢失**（差异全部是 import 重组和已确认的死代码）。
- **等价性验证**：按 method + path + 注册顺序比对重构前后的全部路由，**53 = 53，顺序完全一致**（Fastify 路由匹配优先级受注册顺序影响，因此顺序也被校验）。
- **保留旧导入路径**：`./platform-db.js`、`./external-providers.js` 保留为 re-export 层，未破坏任何既有 import。

## 拆分结果

### Server（`apps/server/src`）

| 原文件 | 行数 | 拆分后 |
| --- | --- | --- |
| `platform-db.ts` | 1556 | `db/types.ts`(383) + `db/schema.ts`(257) + `db/crypto.ts`(87) + `db/database.ts`(875) + barrel(6) |
| `app.ts` | 1234 | `app.ts`(201，只剩装配与生命周期) + `routes/system.ts` + `routes/external-providers.ts` + `routes/authentication.ts` + `routes/people.ts` + `routes/reporting.ts` + `routes/conversation-audits.ts` + `routes/employee-portal.ts` + `platform-keys.ts`(158) + `http/support.ts` + `http/error-handler.ts` + `http/context.ts` |
| `gateway/routes.ts` | 1032 | `gateway/routes.ts`(344) + `schemas.ts`(149) + `streaming.ts`(212) + `authorization.ts`(74) + `completion.ts`(107) + `protocol.ts`(88) + `audit-capture.ts`(65) + `catalog.ts`(10) |
| `external-providers.ts` | 963 | `external-providers/registry.ts`(584) + `schemas.ts`(191) + `net-guards.ts`(94) + `support.ts`(55) + `modality.ts`(41) + `presets.ts`(14) + barrel |

新增的路由模块统一通过 `ApiRouteContext`（`http/context.ts`）取依赖，注册顺序在 `app.ts` 中显式声明，与原顺序一一对应。

最大单文件由 **1556 行 → 875 行**；server 端源码由 12254 行降至 8493 行（含新增文件的拆分开销）。

### Web（`apps/web/src`）

`<script setup>` 整体抽成 composable，模板与样式一行未改，composable 返回模板需要的全部绑定：

| 视图 | 原行数 | 现状 |
| --- | --- | --- |
| `ExternalProvidersView.vue` | 466 | 216 + `composables/useExternalProvidersView.ts`(262) |
| `UsageView.vue` | 389 | 153 + `composables/useUsageView.ts`(248) |
| `ConversationAuditView.vue` | 331 | 56 + `composables/useConversationAuditView.ts`(275) |
| `PeopleView.vue` | 282 | 78 + `composables/usePeopleView.ts`(216) |

## 死代码清理

- Server：`authErrorSchema`、`authResponseSchema`、`errorResponseSchema`（均未被引用）、`platform-db.ts` 未使用的 `mkdirSync` 导入。
- Web：`ConversationDeleteResponse`、`EmployeePortalKeyIssueResponse`、`ExternalProviderDiscoveryResponse`、`ExternalProviderModelTestResponse`、`fetchConversationAuditsByKey`、`fetchExternalProviderPresets`、`fetchUsage`、`fetchUsageDetail`（全仓零引用）。
- 构建产物：`apps/server/dist` 中 85 个无源码对应的遗留编译文件（codex-*、new-api-*、quota-* 等历史模块），以及 `apps/web/playwright-report`、`test-results`。清理后重新 build。
- 严格模式 `tsc --noUnusedLocals --noUnusedParameters` 现已**零告警**。

## 验证证据

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | server `tsc --noEmit` 0 错误；web `vue-tsc --noEmit` 0 错误 |
| 严格未使用检查 | `tsc --noEmit --noUnusedLocals --noUnusedParameters` | 0 条 |
| 测试 | `npm test` | 12 tests / 4 pass / 0 fail / 8 skipped（与重构前基线完全一致） |
| 路由等价 | 静态路由表比对 | 53 条路由，集合与注册顺序均一致 |
| 代码覆盖率 | 按行比对拆分前后 | 0 行逻辑丢失 |
| 构建 | `npm run build` | server `tsc` 产出 dist；web vite build 成功 |

## 已知限制 / 未做事项

- 未做运行时端到端快照：`buildApp()` 依赖 Redis（`RuntimeCoordinator.initialize()` 需要 `REDIS_URL`），验证环境无可用 Redis，因此改用静态路由表 + 类型 + 测试三重比对替代。上线前建议在真实环境跑一次冒烟（`/health`、`/api/system/status`）。
- Web 端仅拆分了 4 个最大视图；`AuditView.vue`(205)、`EmployeePortalView.vue`(202)、`ModelsView.vue`(181) 未动。
- `ExternalProviderRegistry` 类（584 行）内部未再细分：继续拆分需要把实例方法外移为带显式依赖的模块函数，属于行为风险更高的改动，本次未做。
- 重构前基线 commit：`f8e4806f`（`git diff f8e4806f` 可查看全部改动）。
