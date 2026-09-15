# AI 运营平台文档中心

该目录是项目方案文档的维护主版本。页面内容来自 `content/`，不包含服务凭据、部署私密配置或运行日志。

## 本机启动

```powershell
npm.cmd ci
npm.cmd run dev
```

访问 <http://127.0.0.1:4173>。Windows 用户也可双击 `启动文档中心.cmd`。

## 验证

```powershell
npm.cmd run build
npm.cmd run check
```

`check` 会检查批准页面边界、内部链接、常见凭据格式、构建页面和 Markdown 下载副本。

完整维护规则见[文档站使用与维护](content/guides/maintenance.md)。

