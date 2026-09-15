# 依赖基线

::: info 当前状态
前端与 BFF 的第一批依赖已安装并写入根目录 `package-lock.json`。目前只完成依赖和工作区初始化，业务页面、接口和数据库尚未开始实现。
:::

## 工作区结构

```text
ai-ops-platform/
├─ apps/
│  ├─ web/       # Vue 运营控制台
│  └─ server/    # Fastify BFF
├─ docs-site/    # VitePress 文档中心
├─ package.json
└─ package-lock.json
```

根目录使用 npm workspaces 管理 `apps/*`。文档中心继续保留独立锁文件，避免业务应用升级影响已经稳定运行的文档站。

## 前端依赖

| 分类 | 依赖 | 用途 |
| --- | --- | --- |
| 框架 | Vue、Vue Router | 页面、路由和组件运行时 |
| 状态 | Pinia | 登录态、筛选条件和服务状态 |
| UI | Tabler Core、Tabler Icons Vue | 管理后台布局、组件和图标 |
| 图表 | ECharts | 用量、成本、成功率和延迟图表 |
| 校验 | Zod | 表单数据和接口响应校验 |
| 构建 | Vite、TypeScript、Vue TSC | 开发服务、构建和类型检查 |
| 测试 | Vitest、jsdom、Playwright | 组件、逻辑和端到端流程测试 |

## BFF 依赖

| 分类 | 依赖 | 用途 |
| --- | --- | --- |
| 服务框架 | Fastify | 聚合 New API 与 CPA 管理接口 |
| 浏览器边界 | `@fastify/cors` | 限制允许访问 BFF 的控制台来源 |
| 安全响应头 | `@fastify/helmet` | 设置常用浏览器安全响应头 |
| 限流 | `@fastify/rate-limit` | 管理接口的基础请求频率限制 |
| 数据校验 | Zod、Fastify Type Provider Zod | 请求、响应和第三方接口数据校验 |
| 开发 | TypeScript、tsx、Node 类型 | 类型检查、本地运行和构建 |
| 测试 | Vitest | 数据转换、权限和路由测试 |

浏览器仍然不能直接持有 New API 或 CPA 管理密钥。BFF 将在服务端读取凭据，并只向前端返回平台定义的脱敏数据。

## 版本与安装规则

- Node.js 支持范围为 22 至 24，npm 最低版本为 10。
- 精确安装结果由根目录 `package-lock.json` 固定，部署和 CI 使用 `npm ci`。
- `esbuild` 是当前唯一获准运行安装脚本的包，用于 Vite 和 tsx 的本地构建能力。
- 暂不添加 ORM、Redis、MySQL、PostgreSQL、登录框架或消息队列。
- 新增依赖前需要说明用途；可以使用平台能力或 Node.js 标准库时，不重复引入包。

## 当前验证结果

- npm 工作区依赖树可正常解析。
- Vite、tsx 和 esbuild 本地命令可执行。
- 没有未审核的依赖安装脚本。
- `npm audit` 当前报告 0 个已知漏洞。
- `node_modules` 和构建产物均被 Git 忽略。

依赖可安装不代表业务功能已经完成。开始页面和接口开发后，还需要执行类型检查、单元测试、端到端测试以及生产构建。

