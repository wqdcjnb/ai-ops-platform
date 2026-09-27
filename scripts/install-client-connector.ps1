[CmdletBinding()]
param(
  [string]$WebOrigin
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$connectorLauncher = Join-Path $scriptDirectory 'start-workbuddy-connector.ps1'

if ([string]::IsNullOrWhiteSpace($WebOrigin)) {
  $WebOrigin = Read-Host '请输入 AI OPS 页面地址（直接回车使用 http://127.0.0.1:4174）'
  if ([string]::IsNullOrWhiteSpace($WebOrigin)) { $WebOrigin = 'http://127.0.0.1:4174' }
}

try {
  & $connectorLauncher -WebOrigin $WebOrigin -Restart
  if ($LASTEXITCODE -ne 0) { throw '本机配置连接器启动失败。' }
  Write-Host ''
  Write-Host '本机配置连接器已准备好。回到员工门户后，点击“直接接入 Codex”或“导入 WorkBuddy”。' -ForegroundColor Green
  Write-Host '它只在导入配置时需要；配置完成后可关闭，不会影响已经写入的 AI OPS 配置。' -ForegroundColor Cyan
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
