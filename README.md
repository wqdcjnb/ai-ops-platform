# AI 运营平台

面向电商运营团队的 AI 接入与用量管理方案。项目计划通过统一网关为每位成员发放独立 API Key，并按人员、用途和模型管理权限、额度与调用记录。

## 当前阶段

仓库目前处于方案设计阶段，第一版只收录已经确认的需求、架构、安全规则、UI 方案与验收标准。业务后台尚未开始开发，文档中标注为“待验证”或“计划开发”的能力不代表已经实现。

已确认的方向：

- 客户端：Codex Desktop、WorkBuddy
- 统一管理：New API
- 正式上游：官方 API
- 实验上游：CLIProxyAPI（CPA），只用于隔离测试
- 本机测试数据库：SQLite
- 管理界面：Vue 3、TypeScript、Vite、Tabler、Pinia、ECharts
- 首批试点：5–10 名运营人员

```text
Codex Desktop / WorkBuddy
          │ 每人独立 API Key
          ▼
       New API
   ┌──────┴────────┐
   ▼               ▼
官方 API 渠道    CPA 实验渠道
正式业务          Pro OAuth 隔离测试
```

## 文档中心

统一文档网页位于 [`docs-site/`](docs-site/)，包括：

- 完整需求和核心功能
- 技术架构、产品技术栈与 Tabler UI 方案
- 客户端兼容性与安全方案
- CPA 使用说明和项目验收标准
- 决策记录、待办事项和更新记录

本机运行：

```powershell
cd docs-site
npm.cmd ci
npm.cmd run dev
```

浏览器访问 <http://127.0.0.1:4173>。构建和内容检查：

```powershell
npm.cmd run build
npm.cmd run check
```

也可以在 Windows 中双击 `docs-site/启动文档中心.cmd`。

## 安全边界

本仓库是公开仓库，不得提交以下内容：

- 官方 API Key、个人 Bearer Key、CPA 管理密钥
- OAuth Token、认证文件、浏览器登录信息
- 数据库文件、备份、运行日志和客户业务数据
- 包含密码或密钥的 `.env`、Compose 覆盖配置和截图

员工只接触 New API 地址及个人 Key。CPA、官方 API Key和 OAuth 凭据由管理员单独保管。

## 项目状态

下一阶段将先完成数据模型、页面信息架构和接口边界设计，再进入可运行原型开发。进度以[项目待办](docs-site/content/records/todo.md)和[方案决策](docs-site/content/records/decisions.md)为准。

