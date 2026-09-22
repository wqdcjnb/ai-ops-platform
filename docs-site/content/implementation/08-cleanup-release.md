# 08｜清理与发布

## 本步目标

在前面所有真实链路通过后，清理无用的演示代码、旧入口和重复配置，发布一个只保留核心能力的版本。

这是唯一允许进行删除/下线动作的阶段。删除前必须有第 00 步备份，并且每一项都经过清单确认。

## 前置条件

- [07｜真实 Prompt/回复审计](./07-audit) 已通过。
- 已完成一个测试人员、一个模型、至少一个 Key 的全流程。
- 人员停用联动测试通过。
- 审计正文和 30 天清理测试通过。
- 已保存所有真实数据备份和构建产物。
- 已确认没有正在运行的迁移、导入、OAuth 或审计清理任务。

## 1. 建立清理清单

先用只读命令盘点：

```powershell
rg -n "demo|mock|seed|fake|fixture|TODO|group|role|gateway|CPA|New API" apps packages deploy docs-site
rg --files apps packages | Sort-Object
git status --short
```

逐项分类：

| 分类 | 处理 |
| --- | --- |
| 生产必需代码 | 保留并补测试 |
| 兼容适配代码 | 保留，注明上游版本 |
| 本地演示数据 | 删除或改为测试 fixture |
| 未使用页面/路由 | 先禁用，再删除 |
| 旧本地人员/Key 数据表 | 先迁移或只读，再删除 |
| 敏感配置样例 | 只保留变量名，不保留真实值 |
| CPA/New API 管理网站链接 | 删除日常导航 |
| 旧分组/角色逻辑 | 按需求删除，不影响超级管理员登录 |
| 未完成实验代码 | 移出运行时，不要隐藏成成功逻辑 |

不要看到关键词就直接删；逐个确认 import、路由、Compose 挂载和数据库迁移关系。

## 2. 需要保留的核心模块

最终运行时至少保留：

```text
超级管理员认证
CPA 服务端适配器
CPA Codex OAuth
CPA 模型和真实额度读取
New API 管理适配器
CPA -> New API 渠道同步
New API 人员同步
New API Token 创建/查询/禁用
人员停用 -> 全部 Key 停用
按 Key 的真实 Prompt/回复审计
30 天正文保留和清理
Docker Compose 启动和健康检查
```

不属于当前范围、可删除或下线：

```text
员工登录 AI OPS
员工自助注册
员工独立客户端
分组管理
多角色权限体系
CPA/New API 管理网站跳转
本地演示 Key 生成
本地假额度和假用量
未接入真实来源的统计图
```

如果某个旧模块仍被页面引用，先改为明确的“未启用”状态，再移除引用。

## 3. 路由和权限清理

检查 server 路由表和 web 菜单：

```text
apps/server/src/app.ts
apps/web/src/router/
apps/web/src/layout/
apps/web/src/api/
```

最终允许：

- 超级管理员登录。
- CPA 状态、OAuth、认证文件操作。
- 渠道同步。
- 人员同步与管理。
- Key 创建、查看、禁用。
- 按 Key 审计和正文导出。
- 系统健康和配置状态。

最终不应出现：

- 员工登录入口。
- CPA 管理网站外链。
- New API 管理网站外链。
- “分组”菜单。
- 依赖本地 seed 数据的菜单。
- 暴露管理 Token 的配置页。

逐个访问菜单路由，确认刷新、直接访问和未授权状态都正确。

## 4. Docker 配置收敛

检查 docker-compose.yml：

```powershell
docker compose config
docker compose config --services
```

确认：

- cpa、new-api、server、web 都有明确健康检查或启动依赖。
- CPA auths、New API 数据库/数据目录是持久化卷。
- server 只通过内部服务名访问 CPA/New API。
- 宿主机端口默认绑定本机，不无意暴露管理端口。
- 管理密钥只通过环境或 Secret 注入。
- web 构建产物不包含任何服务端 Token。
- 镜像标签可追溯，发布前记录实际 digest 或版本。
- 不依赖手动打开上游网站完成启动。

不要在清理阶段随意升级 CPA 或 New API 镜像；版本升级另开手册并重新执行第 01 到第 07 步的契约测试。

## 5. 删除和下线顺序

推荐顺序：

1. 关闭旧菜单入口。
2. 关闭旧写路由，只保留迁移提示或只读历史。
3. 停止写入旧本地演示表。
4. 确认新链路读写稳定。
5. 备份旧表和旧文件。
6. 删除未引用代码。
7. 删除无用依赖和环境变量。
8. 更新文档和导航。
9. 构建并冷启动验证。
10. 最后再考虑物理删除旧数据。

每次删除只做一个小批次，便于定位回归。

## 6. 完整验收

### 冷启动

```powershell
docker compose down
docker compose up -d
docker compose ps
Invoke-RestMethod http://127.0.0.1:4175/health
```

如果生产数据卷不允许停止，使用等价的测试 Compose 项目完成冷启动，不要在生产上执行破坏性命令。

### 核心流程

1. 超级管理员登录 AI OPS。
2. 查看 CPA ready。
3. 必要时发起官方 Codex OAuth。
4. 同步 CPA 渠道到 New API。
5. 同步一个 New API 人员。
6. 创建单人员/单模型 Key。
7. 发送测试请求。
8. 按 Key 查看 Prompt/回复。
9. 停用人员。
10. 确认所有 Key 失效。
11. 确认历史审计仍可查。

### 代码检查

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build --workspace @ai-ops/server
npm.cmd run build --workspace @ai-ops/web
Push-Location docs-site
npm.cmd run build
npm.cmd run check
Pop-Location
```

## 7. 发布记录

发布记录至少包括：

- Git commit 和镜像版本。
- Compose 配置摘要，不含秘密。
- 数据库迁移版本。
- CPA/New API 版本。
- 健康检查结果。
- 核心流程结果。
- 已知限制，例如 CPA 暂时无法提供真实额度。
- 回滚镜像和数据库备份位置。

## 8. 回滚

发布失败时：

1. 停止新 server/web，不删除数据卷。
2. 恢复上一版镜像或代码。
3. 保持 CPA 认证目录、New API 渠道和 Token 数据。
4. 重新检查人员、Key 和审计可读性。
5. 暂时关闭新写入口，避免新旧版本同时写同一对象。
6. 记录失败 request_id 和迁移版本。

不要用删除卷、重置 Git 或清空数据库作为常规回滚。

完成后进入 [09｜日常操作手册](./09-daily-runbook)。
