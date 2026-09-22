# 00｜执行前检查与备份

## 本步目标

在不改变业务数据的前提下，确认当前 Docker、代码、数据目录和测试基线可用，并留下可回退的记录。

本步不创建人员、不创建渠道、不创建 Key、不登录 OAuth，也不删除任何文件。

## 前置条件

- 当前目录是项目根目录：D:\Project\ai-ops-platform。
- Docker Desktop 已启动。
- 你知道当前使用的本地端口和环境文件位置。
- 如果工作区有其他未提交改动，已经知道它们属于谁；本步不会覆盖这些改动。

## 1. 记录 Git 和目录状态

在项目根目录执行：

```powershell
git status --short
git diff --name-only
git branch --show-current
Get-ChildItem -Force
Get-ChildItem -Force deploy
Get-ChildItem -Force apps
Get-ChildItem -Force docs-site
```

把输出保存到本地运行记录中，但不要把环境文件内容复制进记录。

检查重点：

- 是否存在与本次改造无关的未提交文件。
- 是否有未提交的数据库迁移、Docker 配置或认证文件变更。
- 是否存在 deploy/cpa/auths、New API 数据目录和 Compose 配置。
- 当前分支是否是预期分支。

## 2. 检查 Compose 配置

先做纯校验：

```powershell
docker compose config --services
docker compose config --quiet
docker compose ps
```

预期至少看到以下服务名或项目当前等价服务：

- cpa
- new-api
- server
- web

如果 docker compose config --quiet 失败，先修复 YAML、变量或挂载路径，不要继续后续步骤。

确认关键路径是否存在：

```powershell
Test-Path deploy/cpa/config.yaml
Test-Path deploy/cpa/.env
Test-Path deploy/cpa/auths
Test-Path deploy/new-api
Test-Path docker-compose.yml
```

如果某个路径不存在，记录“未配置”，不要用空文件伪造生产配置。

## 3. 备份运行数据

按照当前项目的实际持久化目录做副本。先确认目录，不要直接对整个工作区递归复制：

```powershell
Get-ChildItem -Force deploy/cpa
Get-ChildItem -Force deploy/new-api
Get-ChildItem -Force data -ErrorAction SilentlyContinue
Get-ChildItem -Force apps/server -Filter *.db -Recurse -ErrorAction SilentlyContinue
```

建议把备份放到项目外、带日期的目录，例如：

```powershell
$backupDir = "D:\Project\ai-ops-platform-backup-2026-09-20"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
```

然后只复制已经确认属于持久化数据的目录。示例：

```powershell
Copy-Item -LiteralPath deploy/cpa/auths -Destination (Join-Path $backupDir "cpa-auths") -Recurse -Force
```

New API 数据目录和数据库文件的复制方式必须根据实际 Compose volume 决定。复制前先执行：

```powershell
docker compose config
```

不要备份或提交包含明文 Token 的 .env 到 Git；备份目录应设置本机访问权限。

## 4. 启动当前基线

如果服务本来已经运行，先只读检查；如果没有运行，再启动：

```powershell
docker compose up -d
docker compose ps
```

检查健康状态：

```powershell
Invoke-RestMethod http://127.0.0.1:4175/health
Invoke-RestMethod http://127.0.0.1:4175/api/platform/status
```

如果端口不是 4175，使用 docker compose port server container-port 查出映射后替换。

查看最近日志：

```powershell
docker compose logs --tail=100 server
docker compose logs --tail=100 cpa
docker compose logs --tail=100 new-api
```

记录：

- 服务是否启动成功。
- CPA、New API、server 是否能互相解析。
- 是否已经有认证账号、渠道或人员。
- 是否有启动时迁移或连接错误。

## 5. 运行代码基线

在项目根目录执行项目已有的检查：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build --workspace @ai-ops/server
npm.cmd run build --workspace @ai-ops/web
```

如果某个脚本不存在，先用 Get-Content package.json 和各 workspace 的 package.json 确认实际脚本，不要临时创建一个同名空脚本来掩盖问题。

文档站单独检查：

```powershell
Push-Location docs-site
npm.cmd run build
npm.cmd run check
Pop-Location
```

## 6. 本步验收

以下条件全部满足才算通过：

- [ ] Compose 配置可解析。
- [ ] cpa、new-api、server、web 的实际服务状态已记录。
- [ ] CPA 认证目录和 New API 持久化目录已确认或明确标记为未配置。
- [ ] 已完成可恢复的本地备份。
- [ ] server health 和 platform status 有响应。
- [ ] 现有 typecheck、测试和构建结果已记录。
- [ ] 没有因为本步删除或覆盖任何业务数据。
- [ ] 没有把任何真实凭据写进 Git 或运行记录。

## 7. 失败处理

常见问题：

| 现象 | 处理 |
| --- | --- |
| Compose 变量缺失 | 查看实际 .env 和 Compose 变量引用，补本地配置后重跑 docker compose config --quiet |
| CPA 容器不健康 | 查看 docker compose logs cpa，确认挂载文件和端口，不要先重建认证目录 |
| New API 容器不健康 | 查看数据卷、数据库和启动日志，先保证数据可恢复 |
| server 无法访问 | 查看 server 环境变量和容器网络，确认 CPA_*、NEW_API_* 地址使用服务名 |
| 测试原本就失败 | 保存失败前后的同一输出，标记为基线问题，不要在本步顺手修改业务逻辑 |

## 8. 回滚

本步原则上没有业务变更。若启动过程需要停止服务，可执行：

```powershell
docker compose stop
```

不要执行以下命令，除非你已经明确知道影响并获得单独授权：

```text
docker compose down -v
git reset --hard
git clean -fd
```

完成后再进入 [01｜CPA 服务端真实接入](./01-cpa-connection)。
