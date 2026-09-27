# AI OPS 最终方案文档站

本目录维护 AI OPS 的最终产品和技术基线：多中转站聚合、统一员工 Key、多模态模型调用、员工门户、超级管理员控制台，以及 Codex / WorkBuddy 一键接入。

任何已下线的历史控制面、旧凭据或旧数据都不属于本方案，也不应作为开发或验收依据。

## 本机启动

~~~powershell
npm.cmd ci
npm.cmd run dev
~~~

访问 http://127.0.0.1:4173。

## 验证

~~~powershell
npm.cmd run check
npm.cmd run build
~~~

内容位于 content。新增或删除页面时必须同步更新 .vitepress/pages.mjs；构建会生成与导航白名单一致的 Markdown 下载副本。

不要将凭据、员工数据、运行日志、数据库、备份、媒体原文件或任何完整 Key 放入本目录。
