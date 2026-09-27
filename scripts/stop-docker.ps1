[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDirectory = Split-Path -Parent $scriptDirectory
$composePath = Join-Path $projectDirectory 'docker-compose.yml'

function Invoke-AiOpsCompose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeArguments)
  & cmd.exe /d /c 'docker compose version >NUL 2>NUL'
  if ($LASTEXITCODE -eq 0) { & docker compose @ComposeArguments } elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { & docker-compose @ComposeArguments } else { throw 'Docker Compose 不可用。' }
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose 命令执行失败。' }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '未找到 Docker。' }
Push-Location $projectDirectory
try {
  # Deliberately omit -v: the platform database and encrypted provider
  # registry stay intact for the next start.
  Invoke-AiOpsCompose -f $composePath down
  Write-Host 'AI OPS 已停止；数据卷仍被保留。' -ForegroundColor Green
} finally {
  Pop-Location
}
